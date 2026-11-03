"use server";

import { revalidatePath } from "next/cache";
import { actionActor } from "@/lib/auth/server";
import { markAllRead } from "@/lib/services/notifications";

export async function markAllReadAction(): Promise<void> {
  const actor = await actionActor();
  await markAllRead(actor.id);
  revalidatePath("/", "layout");
}
