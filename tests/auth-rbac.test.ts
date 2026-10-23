import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { authenticate, changeOwnPassword, revokeSessionByToken, validateSession, hashToken } from "@/lib/auth/service";
import { inScope, violationScopeWhere } from "@/lib/rbac/actor";
import { SYSADMIN_FORBIDDEN, SYSTEM_ROLES } from "@/lib/rbac/catalog";
import { createUser, setRolePermissions, updateUser } from "@/lib/services/users";
import { makeOffice, makeUser } from "./helpers";

describe("المصادقة والجلسات", () => {
  it("دخول ناجح ينشئ جلسة صالحة، والخروج يلغيها", async () => {
    const { user } = await makeUser(["REGISTRAR"]);
    const { token } = await authenticate({ username: user.username, password: "TestPassword123", ip: "10.0.0.1" });
    const s = await validateSession(token);
    expect(s?.actor.id).toBe(user.id);
    // يُخزَّن تجزئة الرمز فقط
    expect(await prisma.session.count({ where: { tokenHash: token } })).toBe(0);
    expect(await prisma.session.count({ where: { tokenHash: hashToken(token) } })).toBe(1);
    await revokeSessionByToken(token, s!.actor);
    expect(await validateSession(token)).toBeNull();
  });

  it("رسالة موحدة للمستخدم غير الموجود وكلمة المرور الخاطئة", async () => {
    const { user } = await makeUser(["REGISTRAR"]);
    const a = await authenticate({ username: "no-such-user", password: "x" }).catch((e) => e.message);
    const b = await authenticate({ username: user.username, password: "wrong" }).catch((e) => e.message);
    expect(a).toBe(b);
  });

  it("قفل الحساب بعد 5 محاولات فاشلة حتى مع كلمة المرور الصحيحة", async () => {
    const { user } = await makeUser(["REGISTRAR"]);
    for (let i = 0; i < 5; i++) await authenticate({ username: user.username, password: "bad" }).catch(() => null);
    await expect(authenticate({ username: user.username, password: "TestPassword123" })).rejects.toThrow(/مقفل/);
    const failures = await prisma.auditLog.count({ where: { action: "auth.login_failed", entityId: user.id } });
    expect(failures).toBeGreaterThanOrEqual(5);
  });

  it("الحساب المعطل لا يدخل والجلسة القائمة تسقط", async () => {
    const { user } = await makeUser(["REGISTRAR"]);
    const { token } = await authenticate({ username: user.username, password: "TestPassword123" });
    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
    expect(await validateSession(token)).toBeNull();
    await expect(authenticate({ username: user.username, password: "TestPassword123" })).rejects.toThrow(/معطل/);
  });

  it("انتهاء الجلسة بعد الخمول", async () => {
    const { user } = await makeUser(["REGISTRAR"]);
    const { token } = await authenticate({ username: user.username, password: "TestPassword123" });
    await prisma.session.update({ where: { tokenHash: hashToken(token) }, data: { lastSeenAt: new Date(Date.now() - 61 * 60_000) } });
    expect(await validateSession(token)).toBeNull();
  });

  it("تغيير كلمة المرور ينهي الجلسات الأخرى", async () => {
    const { user } = await makeUser(["REGISTRAR"]);
    const s1 = await authenticate({ username: user.username, password: "TestPassword123" });
    const s2 = await authenticate({ username: user.username, password: "TestPassword123" });
    const v1 = (await validateSession(s1.token))!;
    await changeOwnPassword(v1.actor, v1.sessionId, { current: "TestPassword123", next: "BrandNewPass2026" });
    expect(await validateSession(s1.token)).not.toBeNull();
    expect(await validateSession(s2.token)).toBeNull();
  });
});

describe("الصلاحيات ونطاق الاطلاع", () => {
  it("مدير النظام لا يملك صلاحيات المصادقة الرسمية", () => {
    for (const p of SYSADMIN_FORBIDDEN) expect(SYSTEM_ROLES.SYSADMIN.permissions).not.toContain(p);
    expect(SYSTEM_ROLES.SYSADMIN.permissions).not.toContain("violation.view");
  });

  it("موظف التسجيل لا يملك المصادقة النهائية", async () => {
    const { actor } = await makeUser(["REGISTRAR"]);
    expect(actor.permissions.has("approval.final_registration")).toBe(false);
    expect(actor.permissions.has("violation.create")).toBe(true);
  });

  it("نطاق المكتب يمنع الاطلاع على مكتب آخر، والمركزي يرى الجميع", async () => {
    const o1 = await makeOffice("T-BSR", "BSR");
    const o2 = await makeOffice("T-DQR", "DQR");
    const { actor: local } = await makeUser(["REGISTRAR"], { officeCode: "T-BSR" });
    const { actor: chair } = await makeUser(["CHAIRMAN"], { officeCode: "HQ" });
    expect(inScope(local, { governorateId: o1.governorateId, officeId: o1.id })).toBe(true);
    expect(inScope(local, { governorateId: o2.governorateId, officeId: o2.id })).toBe(false);
    expect(violationScopeWhere(local)).toEqual({ officeId: o1.id });
    expect(chair.scope).toBe("CENTRAL");
    expect(violationScopeWhere(chair)).toEqual({});
  });

  it("المستخدم بلا صلاحية اطلاع لا يرى أي مخالفة", async () => {
    const { actor } = await makeUser(["SYSADMIN"]);
    expect(violationScopeWhere(actor)).toEqual({ id: "__none__" });
  });

  it("لا يمكن منح دور مدير النظام صلاحية مصادقة", async () => {
    const { actor } = await makeUser(["SYSADMIN"]);
    const { actor: other } = await makeUser(["SENIOR_MGMT"]);
    // منفذ لا يحمل دور SYSADMIN لكنه يملك roles.manage
    other.permissions.add("roles.manage");
    const role = await prisma.role.findUniqueOrThrow({ where: { code: "SYSADMIN" } });
    await expect(setRolePermissions(other, role.id, ["users.manage", "closure.approve"])).rejects.toThrow(/مدير النظام/);
    // ولا يعدل أحد صلاحيات دور يحمله
    await expect(setRolePermissions(actor, role.id, ["users.manage"])).rejects.toThrow(/تحمله/);
  });

  it("لا يعدل المستخدم أدواره بنفسه، ومن لا يملك users.manage لا ينشئ حسابات", async () => {
    const { actor, user } = await makeUser(["SYSADMIN"]);
    const chairRole = await prisma.role.findUniqueOrThrow({ where: { code: "CHAIRMAN" } });
    const sysRole = await prisma.role.findUniqueOrThrow({ where: { code: "SYSADMIN" } });
    await expect(
      updateUser(actor, user.id, { fullName: user.fullName, scope: "OFFICE", officeId: user.officeId, roleIds: [sysRole.id, chairRole.id] }),
    ).rejects.toThrow(/بنفسه/);
    const { actor: registrar } = await makeUser(["REGISTRAR"]);
    await expect(
      createUser(registrar, { username: "hacker1", fullName: "مستخدم", scope: "CENTRAL", roleIds: [chairRole.id] }),
    ).rejects.toThrow(/صلاحية/);
  });

  it("إنشاء مستخدم يولد كلمة مرور مؤقتة ويُلزم بتغييرها ويسجل في التدقيق", async () => {
    const { actor } = await makeUser(["SYSADMIN"]);
    const role = await prisma.role.findUniqueOrThrow({ where: { code: "TECHNICAL" } });
    const hq = await prisma.office.findUniqueOrThrow({ where: { code: "HQ" } });
    const { id, tempPassword } = await createUser(actor, { username: `tech${Date.now()}`, fullName: "موظف فني", scope: "OFFICE", officeId: hq.id, roleIds: [role.id] });
    const u = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(u.mustChangePassword).toBe(true);
    expect(u.passwordHash).not.toContain(tempPassword);
    const log = await prisma.auditLog.findFirst({ where: { action: "user.created", entityId: id } });
    expect(log).not.toBeNull();
    expect(JSON.stringify(log?.after)).not.toContain(tempPassword);
  });
});
