// أدوات مشتركة للنسخ الاحتياطي والاستعادة: التشفير (AES-256-GCM)، وتهيئة روابط PostgreSQL لأدوات pg_dump/pg_restore، وإحصاء الجداول.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { PrismaClient } from "@prisma/client";

export const MAGIC = Buffer.from("CMCBK1");
const IV_LEN = 12;
const TAG_LEN = 16;

/// مفتاح التشفير من BACKUP_KEY (32 بايت بترميز base64 أو hex). لا يُخزَّن المفتاح مع النسخة أبداً.
export function backupKey(): Buffer {
  const raw = process.env.BACKUP_KEY ?? "";
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("BACKUP_KEY مفقود أو غير صالح: يجب أن يكون 32 بايت (openssl rand -base64 32)");
  return key;
}

/// صيغة الملف: MAGIC | IV | النص المشفّر | وسم المصادقة
export async function encryptFile(src: string, dest: string, key: Buffer): Promise<void> {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const out = createWriteStream(dest, { mode: 0o600 });
  out.write(Buffer.concat([MAGIC, iv]));
  await pipeline(createReadStream(src), cipher, out, { end: false });
  await new Promise<void>((resolve, reject) => out.end(cipher.getAuthTag(), (e?: Error | null) => (e ? reject(e) : resolve())));
}

export async function decryptFile(src: string, dest: string, key: Buffer): Promise<void> {
  const { size } = await stat(src);
  const fh = await open(src, "r");
  const head = Buffer.alloc(MAGIC.length + IV_LEN);
  const tag = Buffer.alloc(TAG_LEN);
  await fh.read(head, 0, head.length, 0);
  await fh.read(tag, 0, TAG_LEN, size - TAG_LEN);
  await fh.close();
  if (!head.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("الملف ليس نسخة احتياطية لهذه المنصة");
  const decipher = createDecipheriv("aes-256-gcm", key, head.subarray(MAGIC.length));
  decipher.setAuthTag(tag);
  // فشل التحقق من الوسم (مفتاح خاطئ أو ملف معدَّل) يرمي خطأً عند نهاية التدفق
  await pipeline(createReadStream(src, { start: head.length, end: size - TAG_LEN - 1 }), decipher, createWriteStream(dest, { mode: 0o600 }));
}

export async function sha256File(path: string): Promise<string> {
  const h = createHash("sha256");
  await pipeline(createReadStream(path), h);
  return h.digest("hex");
}

/// يحذف معاملات Prisma (schema, pgbouncer, connection_limit) التي لا تفهمها أدوات PostgreSQL، ويعيد اسم المخطط
export function pgToolUrl(url: string): { url: string; schema: string } {
  const u = new URL(url);
  const schema = u.searchParams.get("schema") || "public";
  for (const k of ["schema", "pgbouncer", "connection_limit", "pool_timeout"]) u.searchParams.delete(k);
  return { url: u.toString(), schema };
}

export function clientFor(url: string): PrismaClient {
  return new PrismaClient({ datasources: { db: { url } } });
}

/// عدد الصفوف لكل جدول في المخطط (للمقارنة بعد الاستعادة)
export async function tableCounts(db: PrismaClient, schema: string): Promise<Record<string, number>> {
  const tables = await db.$queryRaw<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables WHERE table_schema = ${schema} AND table_type = 'BASE TABLE' ORDER BY table_name`;
  const counts: Record<string, number> = {};
  for (const { table_name } of tables) {
    const ident = `"${schema.replace(/"/g, '""')}"."${table_name.replace(/"/g, '""')}"`;
    const [{ n }] = await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*)::bigint AS n FROM ${ident}`);
    counts[table_name] = Number(n);
  }
  return counts;
}

export type Manifest = {
  format: "cmc-backup/1";
  createdAt: string;
  schema: string;
  database: { file: string; sha256: string; sizeBytes: number };
  files: { file: string; sha256: string; sizeBytes: number; sourceDir: string } | null;
  counts: Record<string, number>;
  auditHead: { id: string; hash: string } | null;
  migrations: string[];
};
