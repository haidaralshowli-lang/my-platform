import { redirect } from "next/navigation";
import { requireActor } from "@/lib/auth/server";
import { canAny } from "@/lib/rbac/actor";
import { PageHeader } from "@/components/ui";
import { QueueTable } from "@/components/queue-table";

export const metadata = { title: "المصادقات القانونية" };

export default async function LegalQueue() {
  const actor = await requireActor();
  if (!canAny(actor, ["legal.prepare", "legal.approve"])) redirect("/forbidden");
  return (
    <>
      <PageHeader title="المصادقات القانونية" description="المعاملات المكتمل موقفها الفني بانتظار الرأي والمصادقة القانونية." />
      <QueueTable actor={actor} stages={["AWAITING_LEGAL"]} title="بانتظار المصادقة القانونية" />
    </>
  );
}
