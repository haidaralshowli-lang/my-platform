"use server";

import { prisma } from "@/lib/db";
import { actionActor, requestContext } from "@/lib/auth/server";
import { verifyAuditChain, writeAudit } from "@/lib/audit";
import { toActionError, type ActionResult } from "@/lib/errors";

/// التحقق من سلامة سلسلة التجزئة لكامل سجل التدقيق (يُسجَّل التحقق نفسه)
export async function verifyChainAction(): Promise<ActionResult<{ ok: boolean; checked: number; brokenAt?: string; lastHash?: string }>> {
  try {
    const actor = await actionActor("audit.view");
    const r = await verifyAuditChain(prisma);
    const last = await prisma.auditLog.findFirst({ orderBy: { id: "desc" }, select: { hash: true } });
    await prisma.$transaction(async (tx) => writeAudit(tx, { actor, action: "audit.chain_verified", entityType: "AuditLog", after: { ok: r.ok, checked: r.checked, brokenAt: r.brokenAt?.toString() }, ctx: await requestContext() }));
    return { ok: true, data: { ok: r.ok, checked: r.checked, brokenAt: r.brokenAt?.toString(), lastHash: last?.hash } };
  } catch (e) {
    return toActionError(e);
  }
}
