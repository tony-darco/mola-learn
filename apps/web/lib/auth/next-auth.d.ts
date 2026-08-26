/**
 * Module augmentation: `session.user.id` is not part of next-auth's default
 * Session type. `lib/auth/session.ts` depends on it being there.
 */
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: { id: string } & DefaultSession["user"];
  }
}
