import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/server";
import { prisma } from "@/lib/db";
import { todayStr } from "@/lib/dates";
import { Card, PageHeader } from "@/components/ui";
import { TaskForm } from "../forms";

export const metadata = { title: "مهمة جديدة" };

const UUID = /^[0-9a-f-]{36}$/i;

export default async function NewTaskPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePagePermission("tasks.create");
  const sp = await searchParams;
  const [request, assignee] = await Promise.all([
    sp.request && UUID.test(sp.request) ? prisma.request.findFirst({ where: { id: sp.request, deletedAt: null, status: { not: "CLOSED" } }, select: { id: true, number: true } }) : null,
    sp.assignee && UUID.test(sp.assignee) ? prisma.person.findFirst({ where: { id: sp.assignee, deletedAt: null }, select: { id: true, serial: true, fullName: true } }) : null,
  ]);
  return (
    <>
      <PageHeader
        title="مهمة جديدة"
        description="توزيع المهام على أعضاء الفريق وفق موافقتهم وقدرتهم."
        actions={
          <Link href={request ? `/requests/${request.id}` : "/tasks"} className="text-sm text-brand hover:underline">
            ← العودة
          </Link>
        }
      />
      <Card>
        <TaskForm today={todayStr()} request={request} assignee={assignee} />
      </Card>
    </>
  );
}
