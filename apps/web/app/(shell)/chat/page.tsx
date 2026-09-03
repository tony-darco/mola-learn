import { getSession } from "@/lib/auth/session";
import { NewCourseChatComposer } from "@/components/chat/NewCourseChatComposer";

export const dynamic = "force-dynamic";

/** The app's landing screen — always a fresh "start a new chat" prompt, not the last conversation. */
export default async function ChatLandingPage() {
  const session = await getSession();
  if (!session) return null; // ShellLayout already redirected; unreachable in practice.

  return (
    <main className="chat-main flex flex-col items-center justify-center pb-40">
      <div className="w-full max-w-2xl px-6">
        <h1 className="mb-8 text-center text-4xl font-semibold text-fg">Ready to get started</h1>
        <NewCourseChatComposer placeholder="Ask something, or pick a course from the sidebar…" />
      </div>
    </main>
  );
}
