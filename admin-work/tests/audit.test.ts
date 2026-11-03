import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { verifyAuditChain, writeAudit } from "@/lib/audit";
import { addListItem, updateListItem, updateSetting } from "@/lib/services/lists";
import { makeUser } from "./helpers";

describe("سجل التدقيق وحماية قاعدة البيانات", () => {
  it("القيود متسلسلة بالتجزئة والسلسلة سليمة", async () => {
    const a = await makeUser("ADMIN");
    await prisma.$transaction((tx) => writeAudit(tx, { actor: a, action: "test.one", entityType: "Test", after: { x: 1, password: "secret" } }));
    await prisma.$transaction((tx) => writeAudit(tx, { actor: a, action: "test.two", entityType: "Test" }));
    const last = await prisma.auditLog.findFirstOrThrow({ where: { action: "test.one" } });
    expect((last.after as Record<string, unknown>).password).toBe("[محجوب]");
    expect((await verifyAuditChain(prisma)).ok).toBe(true);
  });

  it("قاعدة البيانات ترفض تعديل أو حذف أو تفريغ سجل التدقيق", async () => {
    await expect(prisma.auditLog.updateMany({ data: { action: "tampered" } })).rejects.toThrow();
    await expect(prisma.auditLog.deleteMany({})).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe(`TRUNCATE "AuditLog"`)).rejects.toThrow();
    expect(await prisma.auditLog.count({ where: { action: "tampered" } })).toBe(0);
  });

  it("السجل الزمني للطلبات إلحاقي، ورقم الهاتف لا يتكرر، ونسبة الإنجاز بين 0 و100", async () => {
    const r = await prisma.request.create({ data: { number: "REQ-T-1", receivedAt: new Date(), applicantName: "مقدم", type: "INQUIRY", description: "وصف" } });
    await prisma.requestEvent.create({ data: { requestId: r.id, kind: "created", toStatus: "NEW" } });
    await expect(prisma.requestEvent.deleteMany({ where: { requestId: r.id } })).rejects.toThrow();
    await prisma.person.create({ data: { fullName: "أ", normalizedName: "ا", phone: "07700000001" } });
    await expect(prisma.person.create({ data: { fullName: "ب", normalizedName: "ب", phone: "07700000001" } })).rejects.toThrow();
    // بعد الحذف الناعم يُسمح بإعادة استخدام الرقم
    await prisma.person.updateMany({ where: { phone: "07700000001" }, data: { deletedAt: new Date() } });
    await prisma.person.create({ data: { fullName: "ب", normalizedName: "ب", phone: "07700000001" } });
    const p = await prisma.person.findFirstOrThrow({ where: { deletedAt: null, phone: "07700000001" } });
    await expect(
      prisma.task.create({ data: { number: "TSK-T-1", title: "مهمة", assigneeId: p.id, dueDate: new Date(), progress: 150 } }),
    ).rejects.toThrow();
  });

  it("القوائم المرجعية والإعدادات للمدير فقط، وتمنع التكرار وتحترم الحدود", async () => {
    const admin = await makeUser("ADMIN");
    const c = await makeUser("COORDINATOR", ["people.view"]);
    await expect(addListItem(c, "authority", "وزارة الاختبار")).rejects.toThrow();
    const row = await addListItem(admin, "authority", "وزارة الاختبار");
    await expect(addListItem(admin, "authority", "وزارة الاختبار")).rejects.toThrow(/موجود/);
    await expect(addListItem(admin, "region", "بغداد")).rejects.toThrow(/موجود/);
    await updateListItem(admin, "authority", row.id, { name: "وزارة الاختبار", isActive: false });
    expect((await prisma.authority.findUniqueOrThrow({ where: { id: row.id } })).isActive).toBe(false);
    await expect(updateSetting(admin, "people.staleDays", 1)).rejects.toThrow();
    await expect(updateSetting(c, "people.staleDays", 30)).rejects.toThrow();
    await updateSetting(admin, "people.staleDays", 30);
    expect((await prisma.setting.findUniqueOrThrow({ where: { key: "people.staleDays" } })).value).toBe(30);
    expect(await prisma.auditLog.count({ where: { action: "setting.update" } })).toBe(1);
  });
});
