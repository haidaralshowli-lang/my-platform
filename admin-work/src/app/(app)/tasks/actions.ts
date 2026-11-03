"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { actionActor, requestContext } from "@/lib/auth/server";
import { formError, type ActionResult } from "@/lib/errors";
import {
  approveTaskClosure,
  cancelTask,
  createTask,
  decideDueDateChange,
  deleteTask,
  reassignTask,
  recordConsent,
  reopenTask,
  updateProgress,
  updateTaskDetails,
} from "@/lib/services/tasks";

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" ? v : undefined;
};

type R = Promise<ActionResult>;

async function run(id: string, perm: Parameters<typeof actionActor>[0], fn: (actor: Awaited<ReturnType<typeof actionActor>>, ctx: Awaited<ReturnType<typeof requestContext>>) => Promise<unknown>, message: string): R {
  try {
    const actor = await actionActor(perm);
    await fn(actor, await requestContext());
    revalidatePath(`/tasks/${id}`);
    return { ok: true, message };
  } catch (e) {
    return formError(e);
  }
}

export async function createTaskAction(_p: ActionResult | null, f: FormData): R {
  let id: string;
  try {
    const actor = await actionActor("tasks.create");
    id = (
      await createTask(
        actor,
        {
          title: str(f, "title") ?? "",
          details: str(f, "details"),
          assigneeId: str(f, "assigneeId") ?? "",
          dueDate: str(f, "dueDate"),
          priority: (str(f, "priority") as never) || "NORMAL",
          requestId: str(f, "requestId") || null,
        },
        await requestContext(),
      )
    ).id;
    revalidatePath("/tasks");
  } catch (e) {
    return formError(e);
  }
  redirect(`/tasks/${id}?created=1`);
}

export async function detailsAction(id: string, _p: ActionResult | null, f: FormData): R {
  return run(id, "tasks.update", (a, c) => updateTaskDetails(a, id, { title: str(f, "title") ?? "", details: str(f, "details"), priority: (str(f, "priority") as never) || "NORMAL", dueDate: str(f, "dueDate") }, c), "تم حفظ التعديلات");
}

export async function consentAction(id: string, _p: ActionResult | null, f: FormData): R {
  const response = str(f, "response") as "ACCEPT" | "DECLINE" | "REQUEST_CHANGE";
  const msg = response === "ACCEPT" ? "سُجِّلت موافقة المكلف وأصبح التكليف نافذاً" : response === "DECLINE" ? "سُجِّل اعتذار المكلف" : "سُجِّل طلب تعديل الموعد";
  return run(id, "tasks.update", (a, c) => recordConsent(a, id, { response, note: str(f, "note"), proposedDueDate: str(f, "proposedDueDate") }, c), msg);
}

export async function decideChangeAction(id: string, _p: ActionResult | null, f: FormData): R {
  const approve = str(f, "decision") === "approve";
  return run(id, "tasks.update", (a, c) => decideDueDateChange(a, id, approve, str(f, "note") || null, c), approve ? "اعتُمد الموعد الجديد" : "رُفض طلب التعديل");
}

export async function reassignAction(id: string, _p: ActionResult | null, f: FormData): R {
  return run(id, "tasks.update", (a, c) => reassignTask(a, id, { assigneeId: str(f, "assigneeId") ?? "", dueDate: str(f, "dueDate"), note: str(f, "note") }, c), "أُعيد إسناد المهمة");
}

export async function progressAction(id: string, _p: ActionResult | null, f: FormData): R {
  return run(
    id,
    "tasks.update",
    (a, c) =>
      updateProgress(a, id, { status: str(f, "status") as never, progress: Number(str(f, "progress") ?? 0), obstacles: str(f, "obstacles"), finalResult: str(f, "finalResult"), note: str(f, "note") }, c),
    "تم تحديث الإنجاز",
  );
}

export async function closeAction(id: string, _p: ActionResult | null, f: FormData): R {
  return run(id, "tasks.close", (a, c) => approveTaskClosure(a, id, str(f, "note") || null, c), "اعتُمد إغلاق المهمة");
}

export async function reopenAction(id: string, _p: ActionResult | null, f: FormData): R {
  return run(id, "tasks.close", (a, c) => reopenTask(a, id, str(f, "reason") ?? "", c), "أُعيد فتح المهمة");
}

export async function cancelAction(id: string, _p: ActionResult | null, f: FormData): R {
  return run(id, "tasks.close", (a, c) => cancelTask(a, id, str(f, "reason") ?? "", c), "أُلغيت المهمة");
}

export async function deleteTaskAction(id: string, _p: ActionResult | null, f: FormData): R {
  try {
    const actor = await actionActor("tasks.delete");
    await deleteTask(actor, id, str(f, "reason") ?? "", await requestContext());
    revalidatePath("/tasks");
  } catch (e) {
    return formError(e);
  }
  redirect("/tasks?deleted=1");
}
