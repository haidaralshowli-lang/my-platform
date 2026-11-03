// نسخة احتياطية مشفّرة لقاعدة البيانات (pg_dump بصيغة custom) مع بيان (manifest) بالبصمة وأعداد الصفوف ورأس سلسلة التدقيق.
// الاستخدام: BACKUP_KEY=... npm run backup -- [--out ./backups] [--keep 30]
// يُجدوَل يومياً (cron) للنسخ الدوري. يتطلب pg_dump بإصدار مساوٍ أو أحدث من إصدار الخادم، ويستخدم DIRECT_DATABASE_URL.
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { backupKey, clientFor, encryptFile, pgToolUrl, sha256File, tableCounts, type Manifest } from "./backup-lib";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/// يُبقي أحدث N نسخة ويحذف الأقدم (البيان وملف البيانات معاً)
async function prune(dir: string, keep: number): Promise<number> {
  const manifests = (await readdir(dir)).filter((f) => /^aw-.*\.manifest\.json$/.test(f)).sort();
  const old = manifests.slice(0, Math.max(0, manifests.length - keep));
  for (const m of old) {
    const base = m.replace(/\.manifest\.json$/, "");
    await rm(join(dir, `${base}.db.enc`), { force: true });
    await rm(join(dir, m), { force: true });
  }
  return old.length;
}

async function main() {
  const key = backupKey();
  const dbUrl = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DIRECT_DATABASE_URL غير مضبوط");
  const outDir = resolve(arg("out") ?? process.env.BACKUP_DIR ?? "./backups");
  const keep = Number(arg("keep") ?? process.env.BACKUP_KEEP ?? 30);
  if (!Number.isInteger(keep) || keep < 1) throw new Error("--keep يجب أن يكون عدداً صحيحاً موجباً");
  await mkdir(outDir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = join(outDir, `aw-${stamp}`);
  const work = await mkdtemp(join(tmpdir(), "aw-backup-"));
  const { url, schema } = pgToolUrl(dbUrl);
  const db = clientFor(dbUrl);
  try {
    // البيان يُحسب قبل التفريغ مباشرة؛ يُفضَّل تشغيل النسخ خارج أوقات العمل لتطابق الأعداد
    const counts = await tableCounts(db, schema);
    const head = await db.auditLog.findFirst({ orderBy: { id: "desc" }, select: { id: true, hash: true } });
    const migrations = (
      await db.$queryRawUnsafe<{ migration_name: string }[]>(`SELECT migration_name FROM "${schema.replace(/"/g, '""')}"."_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY migration_name`)
    ).map((r) => r.migration_name);

    const dumpPlain = join(work, "db.dump");
    execFileSync("pg_dump", ["--format=custom", "--no-owner", "--no-privileges", `--schema=${schema}`, `--file=${dumpPlain}`, `--dbname=${url}`], { stdio: ["ignore", "inherit", "inherit"] });
    const dbFile = `${base}.db.enc`;
    await encryptFile(dumpPlain, dbFile, key);

    const manifest: Manifest = {
      format: "aw-backup/1",
      createdAt: new Date().toISOString(),
      schema,
      database: { file: dbFile.split("/").pop()!, sha256: await sha256File(dbFile), sizeBytes: (await stat(dbFile)).size },
      counts,
      auditHead: head ? { id: head.id.toString(), hash: head.hash } : null,
      migrations,
    };
    await writeFile(`${base}.manifest.json`, JSON.stringify(manifest, null, 2), { mode: 0o600 });

    // آخر نسخة ناجحة تظهر للمدير في صفحة «القوائم والإعدادات»
    const value = { at: manifest.createdAt, manifest: `${base.split("/").pop()}.manifest.json`, sizeBytes: manifest.database.sizeBytes };
    await db.setting.upsert({ where: { key: "backup.lastSuccess" }, create: { key: "backup.lastSuccess", value }, update: { value } });
    const removed = await prune(outDir, keep);
    console.log(`تمت النسخة الاحتياطية: ${base}.manifest.json${removed ? ` (حُذفت ${removed} نسخة أقدم من آخر ${keep})` : ""}`);
  } finally {
    await db.$disconnect();
    await rm(work, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error("فشل النسخ الاحتياطي:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
