import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { authenticate, validateSession } from "@/lib/auth/service";
import { COORDINATOR_DEFAULTS, effectivePermissions } from "@/lib/rbac";
import { createUser, resetUserPassword, setUserActive, updateUser } from "@/lib/services/users";
import { makeUser, PASSWORD } from "./helpers";

describe("الأدوار والصلاحيات", () => {
  it("المدير يملك كل الصلاحيات، والمنسق لا يحصل على صلاحية إدارية حتى لو خُزنت في قاعدة البيانات", () => {
    expect(effectivePermissions("ADMIN", []).has("users.manage")).toBe(true);
    const p = effectivePermissions("COORDINATOR", ["people.view", "users.manage", "audit.view", "requests.close", "bogus"]);
    expect([...p]).toEqual(["people.view"]);
  });

  it("المدير ينشئ حساب منسق بالصلاحيات الافتراضية وكلمة مرور مؤقتة", async () => {
    const admin = await makeUser("ADMIN");
    const { user, tempPassword } = await createUser(admin, { username: "Coord.One", fullName: "المنسق الأول", role: "COORDINATOR" });
    expect(user.username).toBe("coord.one");
    expect(user.permissions.sort()).toEqual([...COORDINATOR_DEFAULTS].sort());
    expect(user.mustChangePassword).toBe(true);
    const { actor } = await authenticate({ username: "coord.one", password: tempPassword });
    expect(actor.mustChangePassword).toBe(true);
    await expect(createUser(admin, { username: "coord.one", fullName: "مكرر", role: "COORDINATOR" })).rejects.toThrow(/مستخدم مسبقاً/);
  });

  it("لا يجوز منح المنسق صلاحيات إدارية", async () => {
    const admin = await makeUser("ADMIN");
    await expect(createUser(admin, { username: "coord.two", fullName: "منسق", role: "COORDINATOR", permissions: ["users.manage"] })).rejects.toThrow(/إدارية/);
    const c = await makeUser("COORDINATOR", ["people.view"]);
    await expect(updateUser(admin, c.id, { fullName: "منسق", permissions: ["audit.view"] })).rejects.toThrow(/إدارية/);
  });

  it("المنسق لا يستطيع إنشاء مدير أو أي حساب، ولا تعديل حساب المدير", async () => {
    const admin = await makeUser("ADMIN");
    const c = await makeUser("COORDINATOR", [...COORDINATOR_DEFAULTS]);
    await expect(createUser(c, { username: "evil.admin", fullName: "مدير آخر", role: "ADMIN" })).rejects.toThrow();
    await expect(createUser(c, { username: "evil.coord", fullName: "منسق آخر", role: "COORDINATOR" })).rejects.toThrow();
    await expect(updateUser(c, admin.id, { fullName: "تغيير", permissions: [] })).rejects.toThrow();
    await expect(setUserActive(c, admin.id, false, "محاولة")).rejects.toThrow();
    await expect(resetUserPassword(c, admin.id)).rejects.toThrow();
    // حتى لو مُنح المنسق users.manage بالعبث المباشر بقاعدة البيانات، تُسقطها الصلاحيات الفعلية
    await prisma.user.update({ where: { id: c.id }, data: { permissions: ["users.manage"] } });
    const { actor } = await authenticate({ username: c.username, password: PASSWORD });
    await expect(createUser(actor, { username: "evil.three", fullName: "مدير", role: "ADMIN" })).rejects.toThrow();
  });

  it("تعديل الصلاحيات يسجل القيمة السابقة والجديدة في سجل التدقيق", async () => {
    const admin = await makeUser("ADMIN");
    const c = await makeUser("COORDINATOR", ["people.view", "people.create"]);
    await updateUser(admin, c.id, { fullName: "منسق معدل", permissions: ["people.view"] });
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "user.update", entityId: c.id } });
    expect((log.before as { permissions: string[] }).permissions).toEqual(["people.view", "people.create"]);
    expect((log.after as { permissions: string[] }).permissions).toEqual(["people.view"]);
    expect(JSON.stringify([log.before, log.after])).not.toMatch(/argon2|passwordHash/);
  });

  it("تعطيل الحساب يتطلب سبباً ويُنهي جلساته، ولا يعطل المدير نفسه", async () => {
    const admin = await makeUser("ADMIN");
    const c = await makeUser("COORDINATOR");
    const { token } = await authenticate({ username: c.username, password: PASSWORD });
    await expect(setUserActive(admin, c.id, false, "")).rejects.toThrow(/سبب/);
    await setUserActive(admin, c.id, false, "انتهاء التكليف");
    expect(await validateSession(token)).toBeNull();
    await expect(setUserActive(admin, admin.id, false, "تجربة")).rejects.toThrow(/بنفسك/);
  });

  it("لا يمكن تعطيل آخر مدير نشط (حاجز إضافي ضد السباق بين جلستين)", async () => {
    await prisma.user.updateMany({ where: { role: "ADMIN" }, data: { isActive: false } });
    const last = await makeUser("ADMIN");
    // مدير آخر عُطّل حسابه للتو لكن طلبه كان قيد التنفيذ
    const stale = await makeUser("ADMIN");
    await prisma.user.update({ where: { id: stale.id }, data: { isActive: false } });
    await expect(setUserActive(stale, last.id, false, "اختبار")).rejects.toThrow(/آخر حساب مدير/);
  });

  it("إعادة تعيين كلمة المرور تُبطل القديمة وتفرض التغيير", async () => {
    const admin = await makeUser("ADMIN");
    const c = await makeUser("COORDINATOR");
    const { tempPassword } = await resetUserPassword(admin, c.id);
    await expect(authenticate({ username: c.username, password: PASSWORD })).rejects.toThrow();
    const { actor } = await authenticate({ username: c.username, password: tempPassword });
    expect(actor.mustChangePassword).toBe(true);
  });

  it("لا يعيد المدير تعيين كلمة مروره بنفسه من إدارة المستخدمين (كانت كلمته المؤقتة تضيع بإنهاء جلسته)", async () => {
    const admin = await makeUser("ADMIN");
    await expect(resetUserPassword(admin, admin.id)).rejects.toThrow(/تغيير كلمة المرور/);
    await expect(authenticate({ username: admin.username, password: PASSWORD })).resolves.toBeDefined();
  });
});
