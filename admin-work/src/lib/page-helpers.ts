import { notFound } from "next/navigation";
import { AppError } from "@/lib/errors";

/// في الصفحات: السجل غير الموجود أو الواقع خارج النطاق يعرض صفحة «غير موجود» نفسها (دون كشف وجوده)
export async function orNotFound<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof AppError && (e.code === "NOT_FOUND" || e.code === "FORBIDDEN")) notFound();
    throw e;
  }
}
