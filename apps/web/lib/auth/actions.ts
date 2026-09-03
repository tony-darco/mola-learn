"use server";

import { redirect } from "next/navigation";
import { AuthError, signIn, signOut } from "./next-auth";
import { registerUser } from "./register";

export async function signUpAction(formData: FormData) {
  const result = await registerUser({
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  });
  if (!result.ok) {
    redirect(`/sign-up?error=${encodeURIComponent(result.error)}`);
  }
  // Sign the new account straight in — signIn() throws NEXT_REDIRECT on success.
  await signIn("credentials", {
    email: formData.get("email"),
    password: formData.get("password"),
    redirectTo: "/",
  });
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
