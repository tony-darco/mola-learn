"use server";

import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/ownership";
import { deleteApiKey, saveApiKey, SUPPORTED_PROVIDERS, type SupportedProvider } from "@/lib/auth/api-keys";

export async function saveApiKeyAction(formData: FormData) {
  const session = await requireSession();
  const provider = String(formData.get("provider") ?? "");
  const key = String(formData.get("key") ?? "");

  if (!(SUPPORTED_PROVIDERS as readonly string[]).includes(provider)) {
    throw new Error("unsupported provider");
  }

  await saveApiKey(session.userId, provider as SupportedProvider, key);
  redirect("/settings");
}

export async function removeApiKeyAction() {
  const session = await requireSession();
  await deleteApiKey(session.userId);
  redirect("/settings");
}
