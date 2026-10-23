// نسخة احتياطية مشفّرة: قاعدة البيانات (pg_dump بصيغة custom) + ملفات التخزين المحلي إن وُجدت + بيان (manifest) بالبصمات وأعداد الصفوف.
// الاستخدام: BACKUP_KEY=... npm run backup -- [--out ./backups]
// يتطلب pg_dump بإصدار مساوٍ أو أحدث من إصدار الخادم. يُستخدم DIRECT_DATABASE_URL (اتصال مباشر لا عبر pgbouncer).
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { backupKey, clientFor, encryptFile, pgToolUrl, sha256File, tableCounts, type Manifest } from "./backup-lib";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const key = backupKey();
  const dbUrl = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DIRECT_DATABASE_URL غير مضبوط");
  const outDir = resolve(arg("out") ?? process.env.BACKUP_DIR ?? "./backups");
  await mkdir(outDir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = join(outDir, `cmc-${stamp}`);
  const work = await mkdtemp(join(tmpdir(), "cmc-backup-"));
  const { url, schema } = pgToolUrl(dbUrl);
  const db = clientFor(dbUrl);
  try {
    // البيان يُحسب قبل التفريغ مباشرة؛ يُفضَّل تشغيل النسخ خارج أوقات العمل لتطابق الأعداد
    const counts = await tableCounts(db, schema);
    const head = await db.auditLog.findFirst({ orderBy: { id: "desc" }, select: { id: true, hash: true } });
    const migrations = (await db.$queryRawUnsafe<{ migration_name: string }[]>(
      `SELECT migration_name FROM "${schema}"."_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY migration_name`,
    )).map((r) => r.migration_name);

    const dumpPlain = join(work, "db.dump");
    execFileSync("pg_dump", ["--format=custom", "--no-owner", "--no-privileges", `--schema=${schema}`, `--file=${dumpPlain}`, `--dbname=${url}`], { stdio: ["ignore", "inherit", "inherit"] });
    const dbFile = `${base}.db.enc`;
    await encryptFile(dumpPlain, dbFile, key);

    let files: Manifest["files"] = null;
    const localDir = resolve(process.env.STORAGE_LOCAL_DIR || "./storage");
    if (existsSync(localDir)) {
      const tarPlain = join(work, "files.tar.gz");
      execFileSync("tar", ["-czf", tarPlain, "-C", localDir, "."]);
      const filesFile = `${base}.files.enc`;
      await encryptFile(tarPlain, filesFile, key);
      files = { file: filesFile.split("/").pop()!, sha256: await sha256File(filesFile), sizeBytes: (await stat(filesFile)).size, sourceDir: localDir };
    }

    const manifest: Manifest = {
      format: "cmc-backup/1",
      createdAt: new Date().toISOString(),
      schema,
      database: { file: dbFile.split("/").pop()!, sha256: await sha256File(dbFile), sizeBytes: (await stat(dbFile)).size },
      files,
      counts,
      auditHead: head ? { id: head.id.toString(), hash: head.hash } : null,
      migrations,
    };
    await writeFile(`${base}.manifest.json`, JSON.stringify(manifest, null, 2), { mode: 0o600 });

    // سجل آخر نسخة ناجحة (يظهر في «إعدادات النظام»)
    await db.systemSetting.upsert({
      where: { key: "job.backup.lastSuccess" },
      create: { key: "job.backup.lastSuccess", value: { at: manifest.createdAt, manifest: `${base.split("/").pop()}.manifest.json`, sizeBytes: manifest.database.sizeBytes } },
      update: { value: { at: manifest.createdAt, manifest: `${base.split("/").pop()}.manifest.json`, sizeBytes: manifest.database.sizeBytes } },
    });
    console.log(`تمت النسخة الاحتياطية: ${base}.manifest.json`);
  } finally {
    await db.$disconnect();
    await rm(work, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error("فشل النسخ الاحتياطي:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
