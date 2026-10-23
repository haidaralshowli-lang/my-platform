import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { Tx } from "@/lib/db";
import type { Actor } from "@/lib/rbac/actor";

export type AuditContext = { requestId?: string | null; ip?: string | null };

export type AuditEntry = {
  actor: Pick<Actor, "id" | "username" | "roles"> | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  ctx?: AuditContext;
  /// اسم مستخدم بديل عند غياب المنفذ (مثل محاولة دخول فاشلة)
  username?: string | null;
};

// مفاتيح لا تُسجَّل في سجل التدقيق مطلقاً
const SECRET_KEYS = /pass(word)?|hash|token|secret|session|cookie/i;

export function redact(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(redact);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Prisma.Decimal) return value.toString();
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEYS.test(k) ? "[محجوب]" : redact(v);
    }
    return out;
  }
  return value;
}

const AUDIT_LOCK_KEY = 7_420_001;

/// تسلسل JSON بمفاتيح مرتبة، لأن jsonb يعيد ترتيب المفاتيح عند التخزين
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(",")}}`;
}

function chainHash(prev: string | null, payload: unknown): string {
  return createHash("sha256").update(`${prev ?? ""}|${canonicalJson(payload)}`).digest("hex");
}

/// يكتب قيد تدقيق داخل المعاملة نفسها. القيود متسلسلة بالتجزئة (hash chain) لكشف أي عبث.
/// يجب استدعاؤه من داخل prisma.$transaction حتى يلتزم القيد مع الإجراء أو يُلغى معه.
export async function writeAudit(tx: Tx, e: AuditEntry): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${AUDIT_LOCK_KEY})`;
  const last = await tx.auditLog.findFirst({ orderBy: { id: "desc" }, select: { hash: true } });
  const at = new Date();
  const before = e.before === undefined ? null : redact(e.before);
  const after = e.after === undefined ? null : redact(e.after);
  const payload = {
    at: at.toISOString(),
    userId: e.actor?.id ?? null,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId ?? null,
    before,
    after,
    reason: e.reason ?? null,
  };
  const prevHash = last?.hash ?? null;
  const hash = chainHash(prevHash, payload);
  await tx.auditLog.create({
    data: {
      at,
      userId: e.actor?.id ?? null,
      username: e.actor?.username ?? e.username ?? null,
      roles: e.actor?.roles ?? [],
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId ?? null,
      before: before === null ? Prisma.JsonNull : (before as Prisma.InputJsonValue),
      after: after === null ? Prisma.JsonNull : (after as Prisma.InputJsonValue),
      reason: e.reason ?? null,
      requestId: e.ctx?.requestId ?? null,
      ip: e.ctx?.ip ?? null,
      prevHash,
      hash,
    },
  });
}

/// يتحقق من سلامة سلسلة التجزئة في سجل التدقيق. يعيد أول معرف مكسور إن وجد.
export async function verifyAuditChain(tx: Tx | import("@prisma/client").PrismaClient): Promise<{ ok: boolean; brokenAt?: bigint; checked: number }> {
  let prev: string | null = null;
  let cursor: bigint | undefined;
  let checked = 0;
  for (;;) {
    const rows: Awaited<ReturnType<typeof tx.auditLog.findMany>> = await tx.auditLog.findMany({
      orderBy: { id: "asc" },
      take: 500,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (rows.length === 0) break;
    for (const r of rows) {
      const payload = {
        at: r.at.toISOString(),
        userId: r.userId,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        before: r.before,
        after: r.after,
        reason: r.reason,
      };
      const expected = chainHash(prev, payload);
      if (r.prevHash !== prev || r.hash !== expected) return { ok: false, brokenAt: r.id, checked };
      prev = r.hash;
      checked++;
    }
    cursor = rows[rows.length - 1].id;
  }
  return { ok: true, checked };
}
