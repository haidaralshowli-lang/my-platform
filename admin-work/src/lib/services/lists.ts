import { z } from "zod";
import { prisma, type Tx } from "@/lib/db";
import { writeAudit, type AuditContext } from "@/lib/audit";
import { AppError, notFound } from "@/lib/errors";
import { assertCan, type Actor } from "@/lib/rbac";
import { SETTING_LIMITS, type SettingKey } from "@/lib/settings";

/// القوائم المرجعية: المحافظات/المناطق، والجهات المختصة
export type ListKind = "region" | "authority";
export type ListItem = { id: number; name: string; isActive: boolean };

export const LIST_LABELS: Record<ListKind, string> = { region: "المحافظات والمناطق", authority: "الجهات المختصة" };
const ENTITY: Record<ListKind, string> = { region: "Region", authority: "Authority" };

const nameSchema = z.string().trim().min(2, "الاسم قصير جداً").max(120, "الاسم طويل جداً");

// واجهة موحدة للجدولين لأن لهما الحقول نفسها
function repo(tx: Tx, kind: ListKind) {
  return {
    byId: (id: number): Promise<ListItem | null> =>
      kind === "region" ? tx.region.findUnique({ where: { id } }) : tx.authority.findUnique({ where: { id } }),
    byName: (name: string, exceptId?: number): Promise<ListItem | null> => {
      const where = { name: { equals: name, mode: "insensitive" as const }, ...(exceptId ? { id: { not: exceptId } } : {}) };
      return kind === "region" ? tx.region.findFirst({ where }) : tx.authority.findFirst({ where });
    },
    create: (name: string): Promise<ListItem> => (kind === "region" ? tx.region.create({ data: { name } }) : tx.authority.create({ data: { name } })),
    update: (id: number, data: { name: string; isActive: boolean }): Promise<ListItem> =>
      kind === "region" ? tx.region.update({ where: { id }, data }) : tx.authority.update({ where: { id }, data }),
  };
}

export async function addListItem(actor: Actor, kind: ListKind, rawName: string, ctx?: AuditContext) {
  assertCan(actor, "lists.manage");
  const name = nameSchema.parse(rawName);
  return prisma.$transaction(async (tx) => {
    const r = repo(tx, kind);
    if (await r.byName(name)) throw new AppError("هذا الاسم موجود مسبقاً", "CONFLICT");
    const row = await r.create(name);
    await writeAudit(tx, { actor, action: `${kind}.create`, entityType: ENTITY[kind], entityId: String(row.id), after: row, ctx });
    return row;
  });
}

export async function updateListItem(actor: Actor, kind: ListKind, id: number, input: { name: string; isActive: boolean }, ctx?: AuditContext) {
  assertCan(actor, "lists.manage");
  const name = nameSchema.parse(input.name);
  return prisma.$transaction(async (tx) => {
    const r = repo(tx, kind);
    const before = await r.byId(id);
    if (!before) throw notFound();
    if (await r.byName(name, id)) throw new AppError("هذا الاسم موجود مسبقاً", "CONFLICT");
    const after = await r.update(id, { name, isActive: input.isActive });
    await writeAudit(tx, { actor, action: `${kind}.update`, entityType: ENTITY[kind], entityId: String(id), before, after, ctx });
    return after;
  });
}

export async function listItems(kind: ListKind): Promise<ListItem[]> {
  return kind === "region"
    ? prisma.region.findMany({ orderBy: [{ isActive: "desc" }, { sortOrder: "asc" }, { name: "asc" }] })
    : prisma.authority.findMany({ orderBy: [{ isActive: "desc" }, { name: "asc" }] });
}

export async function updateSetting(actor: Actor, key: SettingKey, value: number, ctx?: AuditContext) {
  assertCan(actor, "lists.manage");
  const [min, max] = SETTING_LIMITS[key];
  if (!Number.isInteger(value) || value < min || value > max) throw new AppError(`القيمة يجب أن تكون عدداً صحيحاً بين ${min} و${max}`);
  await prisma.$transaction(async (tx) => {
    const before = await tx.setting.findUnique({ where: { key } });
    await tx.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
    await writeAudit(tx, { actor, action: "setting.update", entityType: "Setting", entityId: key, before: before?.value ?? null, after: value, ctx });
  });
}
