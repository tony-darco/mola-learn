/**
 * Account creation. Shared by the JSON route (`/api/auth/sign-up`) and the
 * sign-up page's server action, so the validation rules live in one place.
 */
import { eq } from "drizzle-orm";
import { db, users } from "@mola/db";
import { hashPassword } from "./password";

export type RegisterResult = { ok: true; userId: string } | { ok: false; error: string };

export async function registerUser(input: {
  name?: string;
  email?: string;
  password?: string;
}): Promise<RegisterResult> {
  const name = input.name?.trim();
  const email = input.email?.trim().toLowerCase();
  const password = input.password;

  if (!name || !email || !password) {
    return { ok: false, error: "name, email and password are required" };
  }
  if (password.length < 8) {
    return { ok: false, error: "password must be at least 8 characters" };
  }

  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing[0]) {
    return { ok: false, error: "an account with that email already exists" };
  }

  const passwordHash = await hashPassword(password);
  const [row] = await db.insert(users).values({ email, name, passwordHash }).returning({ id: users.id });
  return { ok: true, userId: row!.id };
}
