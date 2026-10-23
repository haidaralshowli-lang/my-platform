import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { prisma } from "@/lib/db";

export type StorageProvider = "local" | "s3" | "db";

/// واجهة تخزين موحدة. مفاتيح التخزين يولدها النظام ولا تُشتق من اسم الملف الأصلي مطلقاً.
export interface FileStorage {
  readonly provider: StorageProvider;
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
}

export function newStorageKey(prefix: string): string {
  const d = new Date();
  const safePrefix = prefix.replace(/[^a-z0-9_-]/gi, "").slice(0, 40) || "files";
  return `${safePrefix}/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}`;
}

class LocalStorage implements FileStorage {
  readonly provider = "local" as const;
  private root: string;
  constructor(dir: string) {
    this.root = path.resolve(dir);
  }
  private resolve(key: string): string {
    const p = path.resolve(this.root, key);
    // منع الخروج من مجلد التخزين
    if (!p.startsWith(this.root + path.sep)) throw new Error("مفتاح تخزين غير صالح");
    return p;
  }
  async put(key: string, data: Buffer): Promise<void> {
    const p = this.resolve(key);
    await mkdir(path.dirname(p), { recursive: true, mode: 0o750 });
    // wx: لا يُستبدل ملف موجود أبداً
    await writeFile(p, data, { flag: "wx", mode: 0o640 });
  }
  async get(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }
}

class S3Storage implements FileStorage {
  readonly provider = "s3" as const;
  private client: S3Client;
  constructor(private bucket: string) {
    this.client = new S3Client({
      endpoint: process.env.S3_ENDPOINT || undefined,
      region: process.env.S3_REGION || "us-east-1",
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
      },
    });
  }
  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, ContentType: contentType, IfNoneMatch: "*" }),
    );
  }
  async get(key: string): Promise<Buffer> {
    const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }
}

/// التخزين داخل PostgreSQL: للبيئات بلا قرص دائم (دوال Netlify) عند عدم توفر تخزين S3.
/// مناسب لأحجام المرفقات الرسمية المعتادة؛ يُراعى حجم قاعدة البيانات في خطة الاستضافة (DEPLOYMENT.md).
class DbStorage implements FileStorage {
  readonly provider = "db" as const;
  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    await prisma.storedBlob.create({ data: { key, data: new Uint8Array(data), contentType, sizeBytes: data.length } });
  }
  async get(key: string): Promise<Buffer> {
    const b = await prisma.storedBlob.findUnique({ where: { key } });
    if (!b) throw new Error("الملف غير موجود في المخزن");
    return Buffer.from(b.data);
  }
}

const instances = new Map<StorageProvider, FileStorage>();

function make(provider: StorageProvider): FileStorage {
  if (provider === "s3") {
    if (!process.env.S3_BUCKET) throw new Error("S3_BUCKET غير مضبوط");
    return new S3Storage(process.env.S3_BUCKET);
  }
  if (provider === "db") return new DbStorage();
  return new LocalStorage(process.env.STORAGE_LOCAL_DIR || "./storage");
}

export function storageFor(provider: string): FileStorage {
  const p = (["local", "s3", "db"].includes(provider) ? provider : "local") as StorageProvider;
  if (!instances.has(p)) instances.set(p, make(p));
  return instances.get(p)!;
}

/// محرك الكتابة الحالي. القراءة تستخدم دائماً المحرك المسجل مع كل إصدار (storageFor)، فيبقى الملف القديم قابلاً للقراءة بعد تغيير المحرك.
export function storage(): FileStorage {
  return storageFor(process.env.STORAGE_DRIVER || "local");
}
