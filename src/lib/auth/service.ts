import { createHash, randomBytes } from "node:crypto";
import { prisma, type Db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { writeAudit, type AuditContext } from "@/lib/audit";
import { getSetting } from "@/lib/settings";
import { loadActor, type Actor } from "@/lib/rbac/actor";
import { hashPassword, passwordPolicyErrors, verifyPassword } from "./password";

export const SESSION_COOKIE = "cmc_session";
const IDLE_TIMEOUT_MIN = 60;
const IP_WINDOW_MIN = 15;
const IP_MAX_FAILURES = 30;

// تجزئة وهمية ثابتة لتوحيد زمن الاستجابة عند عدم وجود المستخدم (منع كشف أسماء المستخدمين بالتوقيت)
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hashPassword("dummy-password-for-timing-0000"));

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function ttlHours(): number {
  const n = Number(process.env.SESSION_TTL_HOURS ?? 8);
  return Number.isFinite(n) && n > 0 ? n : 8;
}

export type LoginInput = { username: string; password: string; ip?: string | null; userAgent?: string | null; requestId?: string | null };

export async function authenticate(input: LoginInput): Promise<{ token: string; actor: Actor; expiresAt: Date }> {
  const username = input.username.trim().toLowerCase();
  const ctx: AuditContext = { ip: input.ip, requestId: input.requestId };
  const generic = new AppError("اسم المستخدم أو كلمة المرور غير صحيحة", "UNAUTHENTICATED");

  // تحديد معدل المحاولات حسب عنوان IP
  if (input.ip) {
    const since = new Date(Date.now() - IP_WINDOW_MIN * 60_000);
    const ipFailures = await prisma.loginAttempt.count({ where: { ip: input.ip, success: false, createdAt: { gte: since } } });
    if (ipFailures >= IP_MAX_FAILURES) {
      throw new AppError("تم تجاوز عدد محاولات الدخول المسموح بها. يرجى المحاولة لاحقاً.", "RATE_LIMITED");
    }
  }

  const user = await prisma.user.findUnique({ where: { username } });
  const fail = async (reason: string, err: AppError = generic) => {
    await prisma.$transaction(async (tx) => {
      await tx.loginAttempt.create({ data: { username, ip: input.ip, success: false, reason } });
      await writeAudit(tx, { actor: null, username, action: "auth.login_failed", entityType: "User", entityId: user?.id, reason, ctx });
    });
    return err;
  };

  if (!user) {
    await verifyPassword(await getDummyHash(), input.password);
    throw await fail("unknown_user");
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw await fail("locked", new AppError("الحساب مقفل مؤقتاً بسبب محاولات دخول فاشلة متكررة. حاول لاحقاً أو راجع مدير النظام.", "RATE_LIMITED"));
  }
  const valid = await verifyPassword(user.passwordHash, input.password);
  if (!valid) {
    const maxFailed = await getSetting(prisma, "auth.maxFailedLogins");
    const lockMinutes = await getSetting(prisma, "auth.lockMinutes");
    const count = user.failedLoginCount + 1;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: count,
        lockedUntil: count >= maxFailed ? new Date(Date.now() + lockMinutes * 60_000) : null,
      },
    });
    throw await fail("bad_password");
  }
  if (!user.isActive) throw await fail("inactive", new AppError("الحساب معطل. يرجى مراجعة مدير النظام.", "FORBIDDEN"));

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + ttlHours() * 3_600_000);
  await prisma.$transaction(async (tx) => {
    await tx.session.create({
      data: { tokenHash: hashToken(token), userId: user.id, expiresAt, ip: input.ip, userAgent: input.userAgent?.slice(0, 300) },
    });
    await tx.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } });
    await tx.loginAttempt.create({ data: { username, ip: input.ip, success: true } });
  });
  const actor = (await loadActor(prisma, user.id))!;
  await prisma.$transaction((tx) => writeAudit(tx, { actor, action: "auth.login", entityType: "User", entityId: user.id, ctx }));
  return { token, actor, expiresAt };
}

/// يتحقق من رمز الجلسة ويعيد المستخدم المنفذ. الجلسة تنتهي بانتهاء مدتها أو بعد خمول 60 دقيقة.
export async function validateSession(token: string | undefined | null): Promise<{ actor: Actor; sessionId: string } | null> {
  if (!token || token.length > 200) return null;
  const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!session || session.revokedAt) return null;
  const now = Date.now();
  if (session.expiresAt.getTime() <= now) return null;
  if (session.lastSeenAt.getTime() < now - IDLE_TIMEOUT_MIN * 60_000) return null;
  const actor = await loadActor(prisma, session.userId);
  if (!actor) return null;
  // تحديث آخر نشاط مرة كل دقيقتين على الأكثر لتقليل الكتابة
  if (now - session.lastSeenAt.getTime() > 120_000) {
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
  }
  return { actor, sessionId: session.id };
}

export async function revokeSessionByToken(token: string, actor: Actor | null, ctx?: AuditContext): Promise<void> {
  const tokenHash = hashToken(token);
  await prisma.$transaction(async (tx) => {
    const s = await tx.session.findUnique({ where: { tokenHash } });
    if (!s || s.revokedAt) return;
    await tx.session.update({ where: { id: s.id }, data: { revokedAt: new Date() } });
    await writeAudit(tx, { actor, action: "auth.logout", entityType: "User", entityId: s.userId, ctx });
  });
}

export async function revokeAllSessions(db: Db, userId: string, exceptSessionId?: string): Promise<number> {
  const r = await db.session.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    data: { revokedAt: new Date() },
  });
  return r.count;
}

export async function changeOwnPassword(
  actor: Actor,
  sessionId: string,
  input: { current: string; next: string },
  ctx?: AuditContext,
): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
  if (!(await verifyPassword(user.passwordHash, input.current))) {
    throw new AppError("كلمة المرور الحالية غير صحيحة");
  }
  const errs = passwordPolicyErrors(input.next, user.username);
  if (errs.length) throw new AppError(errs.join("، "));
  if (await verifyPassword(user.passwordHash, input.next)) throw new AppError("يجب أن تختلف كلمة المرور الجديدة عن الحالية");
  const passwordHash = await hashPassword(input.next);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash, mustChangePassword: false, passwordChangedAt: new Date() } });
    await revokeAllSessions(tx, user.id, sessionId);
    await writeAudit(tx, { actor, action: "auth.password_changed", entityType: "User", entityId: user.id, ctx });
  });
}
