// استعادة نسخة احتياطية إلى قاعدة بيانات فارغة، ثم التحقق: بصمات الملفات، وأعداد الصفوف مقابل البيان، وسلامة سلسلة سجل التدقيق.
// الاستخدام: BACKUP_KEY=... npm run restore -- --manifest ./backups/cmc-....manifest.json --target "postgresql://..." [--files-dir ./storage-restored]
// لا تستعيد فوق قاعدة إنتاج قائمة: الأداة ترفض إذا كان المخطط الهدف يحتوي جداول.
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { verifyAuditChain } from "../src/lib/audit";
import { backupKey, clientFor, decryptFile, pgToolUrl, sha256File, tableCounts, type Manifest } from "./backup-lib";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const manifestPath = arg("manifest");
  const target = arg("target");
  if (!manifestPath || !target) throw new Error("يلزم --manifest و --target");
  const key = backupKey();
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;
  if (manifest.format !== "cmc-backup/1") throw new Error("صيغة بيان غير معروفة");
  const dir = dirname(resolve(manifestPath));
  const dbFile = join(dir, manifest.database.file);
  if ((await sha256File(dbFile)) !== manifest.database.sha256) throw new Error("بصمة ملف قاعدة البيانات لا تطابق البيان");

  const { url, schema } = pgToolUrl(target);
  if (schema !== manifest.schema) throw new Error(`المخطط الهدف (${schema}) يختلف عن مخطط النسخة (${manifest.schema})`);
  const db = clientFor(target);
  const work = await mkdtemp(join(tmpdir(), "cmc-restore-"));
  try {
    const existing = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM information_schema.tables WHERE table_schema = ${schema}`;
    if (Number(existing[0].n) > 0) throw new Error(`المخطط ${schema} في القاعدة الهدف ليس فارغاً؛ أوقفت الاستعادة`);
    if (schema !== "public") await db.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "${schema.replace(/"/g, '""')}"`);

    const dumpPlain = join(work, "db.dump");
    await decryptFile(dbFile, dumpPlain, key);
    // المخطط موجود مسبقاً في الهدف (أُنشئ أعلاه أو public الافتراضي)، فنستبعد أمر إنشائه من قائمة الاستعادة
    const list = execFileSync("pg_restore", ["--list", dumpPlain], { encoding: "utf8" })
      .split("\n").filter((l) => !/^\d+;\s+\d+\s+\d+\s+SCHEMA\s+-\s+/.test(l)).join("\n");
    const listFile = join(work, "restore.list");
    await writeFile(listFile, list);
    execFileSync("pg_restore", ["--no-owner", "--no-privileges", "--exit-on-error", "--single-transaction", `--use-list=${listFile}`, `--dbname=${url}`, dumpPlain], { stdio: ["ignore", "inherit", "inherit"] });

    if (manifest.files) {
      const filesDir = resolve(arg("files-dir") ?? "./storage-restored");
      const enc = join(dir, manifest.files.file);
      if ((await sha256File(enc)) !== manifest.files.sha256) throw new Error("بصمة ملف المرفقات لا تطابق البيان");
      const tarPlain = join(work, "files.tar.gz");
      await decryptFile(enc, tarPlain, key);
      await mkdir(filesDir, { recursive: true });
      execFileSync("tar", ["-xzf", tarPlain, "-C", filesDir]);
      console.log(`استُعيدت الملفات إلى ${filesDir}`);
    }

    const counts = await tableCounts(db, schema);
    const diffs = Object.keys({ ...manifest.counts, ...counts }).filter((t) => manifest.counts[t] !== counts[t]);
    if (diffs.length) throw new Error(`اختلاف في أعداد الصفوف: ${diffs.map((t) => `${t} (${manifest.counts[t]} ← ${counts[t]})`).join("، ")}`);
    const chain = await verifyAuditChain(db);
    if (!chain.ok) throw new Error(`سلسلة سجل التدقيق مكسورة عند السجل ${chain.brokenAt}`);
    const head = await db.auditLog.findFirst({ orderBy: { id: "desc" }, select: { id: true, hash: true } });
    if ((head?.hash ?? null) !== (manifest.auditHead?.hash ?? null)) throw new Error("آخر سجل تدقيق لا يطابق البيان");
    console.log(`تمت الاستعادة والتحقق: ${Object.keys(counts).length} جدولاً، ${chain.checked} سجل تدقيق سليم.`);
  } finally {
    await db.$disconnect();
    await rm(work, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error("فشلت الاستعادة:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
