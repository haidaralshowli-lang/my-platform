import { redirect } from "next/navigation";
import { requireActor } from "@/lib/auth/server";
import { canAny } from "@/lib/rbac/actor";
import { PageHeader } from "@/components/ui";
import { QueueTable } from "@/components/queue-table";

export const metadata = { title: "الموقف الفني" };

export default async function TechnicalQueue() {
  const actor = await requireActor();
  if (!canAny(actor, ["technical.prepare", "technical.review"])) redirect("/forbidden");
  return (
    <>
      <PageHeader title="الموقف الفني" description="المعاملات المصادق عليها بانتظار بيان الموقف الفني أو مراجعته." />
      <QueueTable actor={actor} stages={["AWAITING_TECHNICAL"]} title="بانتظار الموقف الفني" />
    </>
  );
}
