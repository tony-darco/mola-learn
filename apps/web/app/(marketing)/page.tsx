import { eq } from "drizzle-orm";
import { db, users } from "@mola/db";
import { getSession } from "@/lib/auth/session";
import { getPublicApiKey } from "@/lib/auth/api-keys";
import { LandingComposer } from "@/components/marketing/LandingComposer";

export const dynamic = "force-dynamic";

export default async function LandingPage() {
  const session = await getSession();

  let defaultModel: string | undefined;
  let defaultThinkingEnabled: boolean | undefined;
  let hasOwnKey = false;

  if (session) {
    const [[user], ownKey] = await Promise.all([
      db.select({
        defaultModel: users.defaultModel, defaultThinkingEnabled: users.defaultThinkingEnabled,
      }).from(users).where(eq(users.id, session.userId)).limit(1),
      getPublicApiKey(session.userId),
    ]);
    defaultModel = user?.defaultModel;
    defaultThinkingEnabled = user ? user.defaultThinkingEnabled === 1 : undefined;
    hasOwnKey = ownKey !== null;
  }

  return (
    <section className="mx-auto flex max-w-2xl flex-col items-center px-6 pb-24 pt-32 text-center">
      <h1 className="mb-10 text-5xl font-semibold leading-tight text-fg sm:text-6xl">
        What can I help you study?
      </h1>
      <div className="w-full">
        <LandingComposer
          isAuthenticated={!!session}
          defaultModel={defaultModel}
          defaultThinkingEnabled={defaultThinkingEnabled}
          hasOwnKey={hasOwnKey}
        />
      </div>
    </section>
  );
}
