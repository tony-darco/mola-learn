"use server";

import { redirect } from "next/navigation";
import { AuthError, signIn, signOut } from "./next-auth";
import { registerUser } from "./register";

/**
 * Creates the account and signs it straight in, for the sign-up wizard
 * (SignUpWizard) — which stays on one page across all its steps, so this
 * returns a result instead of throwing a redirect like signInAction does.
 */
export async function completeSignupAction(input: {
  name: string;
  email: string;
  password: string;
  expectedGradDate?: string;
  phoneNumber?: string;
  university?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await registerUser(input);
  if (!result.ok) return result;

  try {
    // redirect: false — signIn() would otherwise throw Next's NEXT_REDIRECT
    // digest on success, same as the plain sign-in form's default.
    await signIn("credentials", { email: input.email, password: input.password, redirect: false });
  } catch (err) {
    if (err instanceof AuthError) {
      return { ok: false, error: "account created, but sign-in failed — try signing in manually" };
    }
    throw err;
  }
  return { ok: true };
}

export async function signInAction(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  try {
    await signIn("credentials", { email, password, redirectTo: "/" });
  } catch (err) {
    // next/navigation's redirect() (thrown by a successful signIn) surfaces as
    // a special digest error, not an AuthError — only intercept real auth failures.
    if (err instanceof AuthError) {
      redirect("/sign-in?error=1");
    }
    throw err;
  }
}

export async function signOutAction() {
  // redirect: false — a bare client onClick call (not a <form action>) doesn't
  // reliably propagate signOut()'s internal NEXT_REDIRECT throw as a client
  // navigation. The caller does the navigation itself after this resolves.
  await signOut({ redirect: false });
}
