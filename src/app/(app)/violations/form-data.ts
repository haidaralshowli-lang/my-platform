import { prisma } from "@/lib/db";
import type { Actor } from "@/lib/rbac/actor";
import { officeScopeWhere } from "@/lib/services/violations";

/// خيارات نموذج المخالفة: القوائم المفعلة فقط، والمكاتب ضمن نطاق المستخدم فقط
export async function violationFormOptions(actor: Actor) {
  const [offices, divisions, violationTypes, entityTypes, activityTypes, detectionSources] = await Promise.all([
    prisma.office.findMany({ where: officeScopeWhere(actor), orderBy: { nameAr: "asc" }, include: { governorate: true } }),
    prisma.division.findMany({ where: { isActive: true }, orderBy: { nameAr: "asc" }, select: { id: true, nameAr: true, officeId: true } }),
    prisma.violationType.findMany({ where: { isActive: true }, orderBy: { nameAr: "asc" }, select: { id: true, nameAr: true } }),
    prisma.entityType.findMany({ where: { isActive: true }, orderBy: { nameAr: "asc" }, select: { id: true, nameAr: true } }),
    prisma.activityType.findMany({ where: { isActive: true }, orderBy: { nameAr: "asc" }, select: { id: true, nameAr: true } }),
    prisma.detectionSource.findMany({ where: { isActive: true }, orderBy: { nameAr: "asc" }, select: { id: true, nameAr: true } }),
  ]);
  const governorates = [...new Map(offices.map((o) => [o.governorateId, { id: o.governorateId, nameAr: o.governorate.nameAr }])).values()];
  return {
    governorates,
    offices: offices.map((o) => ({ id: o.id, nameAr: o.nameAr, governorateId: o.governorateId })),
    divisions,
    violationTypes,
    entityTypes,
    activityTypes,
    detectionSources,
  };
}

export type ViolationFormOptions = Awaited<ReturnType<typeof violationFormOptions>>;
