import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createReferenceItem, referenceItemSchema, updateReferenceItem } from "@/lib/services/reference";
import { completeInput, makeUser } from "./helpers";
import { createDraft } from "@/lib/services/violations";

describe("القوائم المرجعية", () => {
  it("مدير النظام يضيف نوع مخالفة ويعطله فيختفي من النماذج الجديدة، وموظف التسجيل لا يملك ذلك", async () => {
    const { actor: admin } = await makeUser(["SYSADMIN"]);
    const { actor: reg } = await makeUser(["REGISTRAR"]);
    const input = referenceItemSchema.parse({ list: "violationType", code: "ref-t1", nameAr: "نوع مرجعي للاختبار" });
    expect(input.code).toBe("REF-T1");
    await expect(createReferenceItem(reg, input)).rejects.toThrow(/صلاحية/);
    const id = await createReferenceItem(admin, input);
    await updateReferenceItem(admin, "violationType", id, { isActive: false });
    expect((await prisma.violationType.findUniqueOrThrow({ where: { id } })).isActive).toBe(false);
    await expect(createDraft(reg, await completeInput({ violationTypeId: id }))).rejects.toThrow(/معطل/);
    expect(await prisma.auditLog.count({ where: { entityType: "violationType", entityId: id } })).toBe(2);
  });

  it("المكتب يتطلب محافظة ورمزاً", async () => {
    const { actor: admin } = await makeUser(["SYSADMIN"]);
    await expect(createReferenceItem(admin, referenceItemSchema.parse({ list: "office", nameAr: "مكتب بلا محافظة", code: "NOGOV" }))).rejects.toThrow(/المحافظة/);
    await expect(createReferenceItem(admin, referenceItemSchema.parse({ list: "office", nameAr: "مكتب بلا رمز" }))).rejects.toThrow(/الرمز/);
  });
});
