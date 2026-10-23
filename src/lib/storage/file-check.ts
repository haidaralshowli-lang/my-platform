import { createHash } from "node:crypto";
import { Socket } from "node:net";
import { fileTypeFromBuffer } from "file-type";

/// الأنواع المسموح بها: يُحدَّد النوع من محتوى الملف الفعلي (التوقيع الثنائي)، لا من الامتداد أو ما يرسله المتصفح
export const ALLOWED_TYPES: Record<string, { label: string; inline: boolean; exts: string[] }> = {
  "application/pdf": { label: "PDF", inline: true, exts: ["pdf"] },
  "image/jpeg": { label: "صورة JPEG", inline: true, exts: ["jpg", "jpeg"] },
  "image/png": { label: "صورة PNG", inline: true, exts: ["png"] },
  "image/webp": { label: "صورة WebP", inline: true, exts: ["webp"] },
  "image/tiff": { label: "صورة TIFF", inline: false, exts: ["tif", "tiff"] },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { label: "Word", inline: false, exts: ["docx"] },
  "application/x-cfb": { label: "مستند Office قديم (DOC/XLS)", inline: false, exts: ["doc", "xls"] },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { label: "Excel", inline: false, exts: ["xlsx"] },
  "audio/mpeg": { label: "صوت MP3", inline: true, exts: ["mp3"] },
  "audio/wav": { label: "صوت WAV", inline: true, exts: ["wav"] },
  "audio/x-m4a": { label: "صوت M4A", inline: true, exts: ["m4a"] },
  "audio/ogg": { label: "صوت OGG", inline: true, exts: ["ogg", "oga"] },
  "video/mp4": { label: "فيديو MP4", inline: true, exts: ["mp4"] },
  "video/webm": { label: "فيديو WebM", inline: true, exts: ["webm"] },
  "video/quicktime": { label: "فيديو MOV", inline: false, exts: ["mov"] },
};

export const ACCEPT_ATTR = Object.values(ALLOWED_TYPES).flatMap((t) => t.exts.map((e) => `.${e}`)).join(",");

export type CheckedFile = { mimeType: string; ext: string; sha256: string; sizeBytes: number };

export class FileRejected extends Error {}

export async function checkFile(name: string, data: Buffer, maxBytes: number): Promise<CheckedFile> {
  if (data.length === 0) throw new FileRejected(`الملف «${name}» فارغ`);
  if (data.length > maxBytes) throw new FileRejected(`الملف «${name}» يتجاوز الحد الأقصى المسموح (${Math.round(maxBytes / 1048576)} ميغابايت)`);
  const detected = await fileTypeFromBuffer(data);
  if (!detected || !ALLOWED_TYPES[detected.mime]) {
    throw new FileRejected(`نوع الملف «${name}» غير مسموح به أو لا يطابق محتواه الفعلي`);
  }
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  // امتداد مضلل (مثل ملف PNG باسم .pdf) يُرفض لتجنب الالتباس عند الفتح
  if (!ALLOWED_TYPES[detected.mime].exts.includes(ext)) {
    throw new FileRejected(`امتداد الملف «${name}» لا يطابق نوعه الحقيقي (${ALLOWED_TYPES[detected.mime].label})`);
  }
  return {
    mimeType: detected.mime,
    ext,
    sha256: createHash("sha256").update(data).digest("hex"),
    sizeBytes: data.length,
  };
}

/// تنظيف اسم الملف الأصلي للعرض فقط (لا يُستخدم في مسار التخزين)
export function safeDisplayName(name: string): string {
  const cleaned = name.replace(/[\\/\u0000-\u001f<>:"|?*]+/g, "_").replace(/\s+/g, " ").trim();
  return (cleaned || "ملف").slice(0, 180);
}

/// فحص بمضاد برمجيات خبيثة عبر خدمة clamd (اختياري: CLAMAV_HOST و CLAMAV_PORT)
export async function scanForMalware(data: Buffer): Promise<"CLEAN" | "INFECTED" | "NOT_SCANNED"> {
  const host = process.env.CLAMAV_HOST;
  if (!host) return "NOT_SCANNED";
  const port = Number(process.env.CLAMAV_PORT || 3310);
  return new Promise((resolve) => {
    const sock = new Socket();
    let reply = "";
    const done = (r: "CLEAN" | "INFECTED" | "NOT_SCANNED") => {
      sock.destroy();
      resolve(r);
    };
    sock.setTimeout(30_000, () => done("NOT_SCANNED"));
    sock.on("error", () => done("NOT_SCANNED"));
    sock.on("data", (c) => (reply += c.toString()));
    sock.on("end", () => done(/FOUND/.test(reply) ? "INFECTED" : /OK/.test(reply) ? "CLEAN" : "NOT_SCANNED"));
    sock.connect(port, host, () => {
      sock.write("zINSTREAM\0");
      for (let i = 0; i < data.length; i += 64 * 1024) {
        const chunk = data.subarray(i, i + 64 * 1024);
        const len = Buffer.alloc(4);
        len.writeUInt32BE(chunk.length);
        sock.write(len);
        sock.write(chunk);
      }
      sock.write(Buffer.alloc(4));
    });
  });
}
