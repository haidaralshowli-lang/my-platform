"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { actionActor, requestContext } from "@/lib/auth/server";
import { formError, type ActionResult } from "@/lib/errors";
import { addRequestAction, createRequest, deleteRequest, restoreRequest, transitionRequest, updateRequest, type RequestInput } from "@/lib/services/requests";

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" ? v : undefined;
};

function toInput(f: FormData): RequestInput {
  return {
    receivedAt: str(f, "receivedAt"),
    applicantName: str(f, "applicantName") ?? "",
    applicantId: str(f, "applicantId") || null,
    type: str(f, "type") as RequestInput["type"],
    description: str(f, "description") ?? "",
    authorityId: str(f, "authorityId") ? Number(str(f, "authorityId")) : null,
    ownerId: str(f, "ownerId") || null,
    priority: (str(f, "priority") as RequestInput["priority"]) || "NORMAL",
    followUpDate: str(f, "followUpDate"),
  };
}

export async function createRequestAction(_p: ActionResult | null, f: FormData): Promise<ActionResult> {
  let id: string;
  try {
    const actor = await actionActor("requests.create");
    id = (await createRequest(actor, toInput(f), await requestContext())).id;
    revalidatePath("/requests");
  } catch (e) {
    return formError(e);
  }
  redirect(`/requests/${id}?created=1`);
}

export async function updateRequestAction(id: string, _p: ActionResult | null, f: FormData): Promise<ActionResult> {
  try {
    const actor = await actionActor("requests.update");
    await updateRequest(actor, id, toInput(f), await requestContext());
    revalidatePath(`/requests/${id}`);
    return { ok: true, message: "تم حفظ التعديلات" };
  } catch (e) {
    return formError(e);
  }
}

export async function transitionAction(id: string, _p: ActionResult | null, f: FormData): Promise<ActionResult> {
  try {
    const actor = await actionActor();
    await transitionRequest(
      actor,
      id,
      {
        to: str(f, "to") as never,
        note: str(f, "note") ?? "",
        failureReason: str(f, "failureReason"),
        authorityId: str(f, "authorityId") ? Number(str(f, "authorityId")) : null,
        followUpDate: str(f, "followUpDate"),
      },
      await requestContext(),
    );
    revalidatePath(`/requests/${id}`);
    return { ok: true, message: "تم تحديث حالة الطلب" };
  } catch (e) {
    return formError(e);
  }
}

export async function addActionAction(id: string, _p: ActionResult | null, f: FormData): Promise<ActionResult> {
  try {
    const actor = await actionActor("requests.update");
    await addRequestAction(actor, id, { note: str(f, "note") ?? "", followUpDate: str(f, "followUpDate") }, await requestContext());
    revalidatePath(`/requests/${id}`);
    return { ok: true, message: "تم تسجيل الإجراء" };
  } catch (e) {
    return formError(e);
  }
}

export async function deleteRequestAction(id: string, _p: ActionResult | null, f: FormData): Promise<ActionResult> {
  try {
    const actor = await actionActor("requests.delete");
    await deleteRequest(actor, id, str(f, "reason") ?? "", await requestContext());
    revalidatePath("/requests");
  } catch (e) {
    return formError(e);
  }
  redirect("/requests?deleted=1");
}

export async function restoreRequestAction(id: string): Promise<ActionResult> {
  try {
    const actor = await actionActor("requests.delete");
    await restoreRequest(actor, id, await requestContext());
    revalidatePath("/requests/deleted");
    return { ok: true, message: "تمت استعادة الطلب" };
  } catch (e) {
    return formError(e);
  }
}
