import { getSession, requestContext } from "@/lib/auth/server";
import { readAttachmentVersion } from "@/lib/services/attachments";
import { AppError } from "@/lib/errors";

export const dynamic = "force-dynamic";

/// تقديم الملفات عبر خدمة تتحقق من الجلسة والنطاق والسرية في كل طلب. لا توجد روابط مباشرة للملفات.
export async function GET(req: Request, { params }: { params: Promise<{ versionId: string }> }) {
  const s = await getSession();
  if (!s || s.actor.mustChangePassword) return new Response("غير مصرح", { status: 401 });
  const { versionId } = await params;
  try {
    const { version, data, inline } = await readAttachmentVersion(s.actor, versionId, await requestContext());
    const asDownload = new URL(req.url).searchParams.get("download") === "1" || !inline;
    const encoded = encodeURIComponent(version.originalName);
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": version.mimeType,
        "Content-Length": String(data.length),
        "Content-Disposition": `${asDownload ? "attachment" : "inline"}; filename*=UTF-8''${encoded}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        // لا تُنفَّذ أي شيفرة داخل الملف المعروض
        "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; plugin-types application/pdf; sandbox",
        "X-Frame-Options": "SAMEORIGIN",
      },
    });
  } catch (e) {
    if (e instanceof AppError) return new Response(e.message, { status: e.code === "NOT_FOUND" ? 404 : 403 });
    console.error("[file-serve]", e instanceof Error ? e.message : e);
    return new Response("تعذر تقديم الملف", { status: 500 });
  }
}
