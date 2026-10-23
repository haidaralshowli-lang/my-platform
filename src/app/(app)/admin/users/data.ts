import { prisma } from "@/lib/db";

export async function orgOptions() {
  const [governorates, offices, roles] = await Promise.all([
    prisma.governorate.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" }, select: { id: true, nameAr: true } }),
    prisma.office.findMany({ where: { isActive: true }, orderBy: { nameAr: "asc" }, select: { id: true, nameAr: true, governorateId: true } }),
    prisma.role.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, nameAr: true, description: true } }),
  ]);
  return { governorates, offices, roles };
}
