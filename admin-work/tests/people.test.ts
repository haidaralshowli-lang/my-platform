import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { normalizeArabicName, normalizePhone } from "@/lib/text";
import {
  computeDataStatus,
  createPerson,
  deletePerson,
  duplicatePairs,
  findSimilar,
  listPeople,
  markDistinct,
  mergePeople,
  peopleFilterSchema,
  restorePerson,
  updatePerson,
} from "@/lib/services/people";
import { commitImport, exportPeople, previewImport } from "@/lib/services/people-excel";
import { peopleIndicators } from "@/lib/services/dashboard";
import { COORDINATOR_DEFAULTS, type Actor } from "@/lib/rbac";
import { makeUser } from "./helpers";

let admin: Actor;
let coord: Actor;
let baghdad: number;
let basra: number;

beforeAll(async () => {
  admin = await makeUser("ADMIN");
  coord = await makeUser("COORDINATOR", [...COORDINATOR_DEFAULTS]);
  baghdad = (await prisma.region.findUniqueOrThrow({ where: { name: "بغداد" } })).id;
  basra = (await prisma.region.findUniqueOrThrow({ where: { name: "البصرة" } })).id;
});

describe("توحيد النصوص والهاتف", () => {
  it("يوحّد الهمزات والتاء المربوطة والتشكيل والمسافات", () => {
    expect(normalizeArabicName("  أحمـــد   عَلِيّ  ")).toBe(normalizeArabicName("احمد علي"));
    expect(normalizeArabicName("فاطمة")).toBe(normalizeArabicName("فاطمه"));
    expect(normalizeArabicName("مصطفى")).toBe("مصطفي");
  });
  it("يوحّد أرقام الهاتف العراقية ويرفض غير الصالحة", () => {
    expect(normalizePhone("+964 770 123 4567")).toBe("07701234567");
    expect(normalizePhone("٠٧٧٠١٢٣٤٥٦٧")).toBe("07701234567");
    expect(normalizePhone("7701234567")).toBe("07701234567");
    expect(normalizePhone("")).toBeNull();
    expect(() => normalizePhone("12345")).toThrow();
  });
  it("يحتسب حالة البيانات", () => {
    expect(computeDataStatus({ regionId: 1, followUpOwnerId: "x", needsUpdate: false })).toBe("COMPLETE");
    expect(computeDataStatus({ regionId: null, followUpOwnerId: "x", needsUpdate: false })).toBe("INCOMPLETE");
    expect(computeDataStatus({ regionId: 1, followUpOwnerId: "x", needsUpdate: true })).toBe("NEEDS_UPDATE");
  });
});

describe("إدارة الأشخاص", () => {
  it("المنسق يضيف شخصاً برقم تسلسلي تلقائي وحالة محتسبة، ويُسجَّل في التدقيق", async () => {
    const p = await createPerson(coord, { fullName: "كريم حسن جابر", phone: "07800000001", regionId: baghdad, followUpOwnerId: coord.id });
    expect(p.serial).toBeGreaterThan(0);
    expect(p.dataStatus).toBe("COMPLETE");
    expect(await prisma.auditLog.count({ where: { action: "person.create", entityId: p.id } })).toBe(1);
  });

  it("يمنع تكرار الهاتف، ويمنع الاسم المطابق إلا بتأكيد صريح", async () => {
    await createPerson(coord, { fullName: "سلمى عادل ناصر", phone: "07800000002" });
    await expect(createPerson(coord, { fullName: "شخص آخر تماماً", phone: "+9647800000002" })).rejects.toThrow(/الهاتف/);
    await expect(createPerson(coord, { fullName: "سلمي عادل ناصر" })).rejects.toThrow(/بالاسم نفسه/);
    const twin = await createPerson(coord, { fullName: "سلمى عادل ناصر", confirmDistinct: true });
    // تعديل السجل لاحقاً لا يطلب التأكيد مجدداً لأن الزوج محفوظ كشخصين مختلفين
    await updatePerson(coord, twin.id, { fullName: "سلمى عادل ناصر", regionId: baghdad });
    // الزوج المؤكد لا يظهر في مراجعة التكرار
    const pairs = await duplicatePairs();
    expect(pairs.some((x) => x.aId === twin.id || x.bId === twin.id)).toBe(false);
  });

  it("يكتشف الأسماء المتشابهة ويعرضها للمراجعة", async () => {
    const a = await createPerson(coord, { fullName: "عبد الرحمن محمود العبيدي" });
    const b = await createPerson(coord, { fullName: "عبدالرحمن محمود العبيدى" });
    const similar = await findSimilar("عبد الرحمن محمود العبيدي", { excludeId: a.id });
    expect(similar.map((s) => s.id)).toContain(b.id);
    const pairs = await duplicatePairs();
    expect(pairs.some((x) => [x.aId, x.bId].includes(a.id) && [x.aId, x.bId].includes(b.id))).toBe(true);
    await markDistinct(coord, a.id, b.id);
    expect((await duplicatePairs()).some((x) => [x.aId, x.bId].includes(a.id) && [x.aId, x.bId].includes(b.id))).toBe(false);
  });

  it("التعديل يسجل القيم السابقة والجديدة ويعيد احتساب الحالة", async () => {
    const p = await createPerson(coord, { fullName: "نور الهدى سامي" });
    expect(p.dataStatus).toBe("INCOMPLETE");
    const u = await updatePerson(coord, p.id, { fullName: "نور الهدى سامي", regionId: basra, followUpOwnerId: admin.id });
    expect(u.dataStatus).toBe("COMPLETE");
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "person.update", entityId: p.id } });
    expect((log.before as { regionId: number | null }).regionId).toBeNull();
    expect((log.after as { regionId: number }).regionId).toBe(basra);
  });

  it("الحذف والاستعادة والدمج للمدير فقط، والدمج ينقل المهام ويكمل الحقول", async () => {
    const keep = await createPerson(admin, { fullName: "حيدر جاسم كاظم", regionId: baghdad });
    const dup = await createPerson(admin, { fullName: "حيدر جاسم كاظم", phone: "07800000003", followUpOwnerId: coord.id, engagementLevel: "HIGH", confirmDistinct: true });
    const task = await prisma.task.create({ data: { number: "TSK-TEST-1", title: "مهمة", assigneeId: dup.id, dueDate: new Date() } });
    await expect(mergePeople(coord, keep.id, dup.id)).rejects.toThrow();
    await expect(deletePerson(coord, keep.id, "خطأ")).rejects.toThrow();
    const merged = await mergePeople(admin, keep.id, dup.id);
    expect(merged.phone).toBe("07800000003");
    expect(merged.followUpOwnerId).toBe(coord.id);
    expect(merged.engagementLevel).toBe("HIGH");
    expect(merged.dataStatus).toBe("COMPLETE");
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).assigneeId).toBe(keep.id);
    const gone = await prisma.person.findUniqueOrThrow({ where: { id: dup.id } });
    expect(gone.deletedAt).not.toBeNull();
    expect(gone.mergedIntoId).toBe(keep.id);
    await expect(restorePerson(admin, dup.id)).rejects.toThrow(/دُمج/);

    await expect(deletePerson(admin, keep.id, "")).rejects.toThrow(/سبب/);
    await deletePerson(admin, keep.id, "إدخال خاطئ");
    expect((await listPeople(peopleFilterSchema.parse({ q: "حيدر جاسم" }))).rows.some((r) => r.id === keep.id)).toBe(false);
    await restorePerson(admin, keep.id);
    expect((await listPeople(peopleFilterSchema.parse({ q: "حيدر جاسم" }))).rows.some((r) => r.id === keep.id)).toBe(true);
  });

  it("البحث بالرقم التسلسلي والهاتف والاسم بصيغ مختلفة، والفلاتر", async () => {
    const p = await createPerson(coord, { fullName: "إسراء فاضل", phone: "07800000004", regionId: basra });
    const by = async (q: Record<string, string>) => (await listPeople(peopleFilterSchema.parse(q))).rows.map((r) => r.id);
    expect(await by({ q: String(p.serial) })).toContain(p.id);
    expect(await by({ q: "0000004" })).toContain(p.id);
    expect(await by({ q: "اسراء" })).toContain(p.id);
    expect(await by({ region: String(basra), status: "INCOMPLETE" })).toContain(p.id);
    expect(await by({ owner: "none", q: "اسراء" })).toContain(p.id);
    expect(await by({ status: "COMPLETE", q: "اسراء" })).not.toContain(p.id);
  });

  it("السجل الذي لم يُحدَّث منذ مدة يظهر ضمن «تحتاج إلى تحديث» في اللوحة والفلتر", async () => {
    const p = await createPerson(coord, { fullName: "مرتضى قديم التحديث", regionId: basra, followUpOwnerId: coord.id });
    const before = await peopleIndicators();
    await prisma.$executeRaw`UPDATE "Person" SET "updatedAt" = now() - interval '400 days' WHERE id = ${p.id}::uuid`;
    const after = await peopleIndicators();
    expect(after.needsUpdate).toBe(before.needsUpdate + 1);
    expect((await listPeople(peopleFilterSchema.parse({ status: "needs" }))).rows.map((r) => r.id)).toContain(p.id);
    expect(after.total).toBe(await prisma.person.count({ where: { deletedAt: null } }));
  });
});

async function workbook(rows: (string | number)[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("الأشخاص");
  ws.addRow(["الاسم الكامل", "رقم الهاتف", "المحافظة أو المنطقة", "مسؤول المتابعة (اسم المستخدم)", "مستوى التفاعل", "متاح للتعاون (نعم/لا)", "بانتظار التحديث (نعم/لا)", "ملاحظات إدارية"]);
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("الاستيراد والتصدير", () => {
  it("يفحص الملف صفاً صفاً ويستورد السليم فقط", async () => {
    await createPerson(admin, { fullName: "موجود مسبقاً للاستيراد", phone: "07800000010" });
    const buf = await workbook([
      ["علي ناجي سلمان", "07800000011", "بغداد", coord.username, "مرتفع", "نعم", "لا", "ملاحظة"],
      ["زينب كريم", "", "بابل", "", "", "", "", ""],
      ["", "07800000012", "", "", "", "", "", ""],
      ["رقم مكرر", "07800000010", "", "", "", "", "", ""],
      ["محافظة خاطئة", "", "باريس", "", "", "", "", ""],
      ["موجود مسبقاً للاستيراد", "", "", "", "", "", "", ""],
      ["علي ناجي سلمان", "07800000013", "", "", "", "", "", ""],
      ["هاتف خاطئ", "123", "", "", "", "كلا", "", ""],
    ]);
    const preview = await previewImport(coord, buf, false);
    expect(preview.fileRows).toBe(8);
    expect(preview.ok).toBe(2);
    expect(preview.nameMatches).toBe(1);
    expect(preview.errors).toBe(5);
    const before = await prisma.person.count();
    const { created } = await commitImport(coord, buf, "test.xlsx", false);
    expect(created).toBe(2);
    expect(await prisma.person.count()).toBe(before + 2);
    const ali = await prisma.person.findFirstOrThrow({ where: { phone: "07800000011" } });
    expect(ali.regionId).toBe(baghdad);
    expect(ali.followUpOwnerId).toBe(coord.id);
    expect(ali.engagementLevel).toBe("HIGH");
    expect(ali.availableForWork).toBe(true);
    expect(ali.dataStatus).toBe("COMPLETE");
    expect(await prisma.auditLog.count({ where: { action: "person.import" } })).toBe(1);
    // الاستيراد مرة ثانية لا يكرر شيئاً
    const again = await previewImport(coord, buf, false);
    expect(again.ok).toBe(0);
    // الأرقام المسجلة تُرفض حتى مع السماح بالأسماء المطابقة
    const allowed = await previewImport(coord, buf, true);
    expect(allowed.rows.find((r) => r.fullName === "علي ناجي سلمان")?.status).toBe("error");
  });

  it("يرفض الملفات غير Excel ومن لا يملك الصلاحية", async () => {
    await expect(previewImport(coord, Buffer.from("name,phone\nx,y"), false)).rejects.toThrow(/Excel/);
    const viewer = await makeUser("COORDINATOR", ["people.view"]);
    await expect(previewImport(viewer, await workbook([]), false)).rejects.toThrow();
    await expect(exportPeople(viewer, peopleFilterSchema.parse({}))).rejects.toThrow();
  });

  it("التصدير يحترم الفلاتر ويُسجَّل في التدقيق", async () => {
    const { buf, count } = await exportPeople(coord, peopleFilterSchema.parse({ region: String(basra) }));
    expect(count).toBe(await prisma.person.count({ where: { deletedAt: null, regionId: basra } }));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets[0].rowCount).toBe(count + 1);
    expect(await prisma.auditLog.count({ where: { action: "person.export" } })).toBeGreaterThan(0);
  });
});
