/**
 * Shown the instant a chat link is clicked, while the server renders the
 * page (ownership check + history load in page.tsx). Without it, a click
 * leaves the previous chat on screen until that render lands. Mirrors
 * ChatMain's scroll/column wrappers so nothing jumps when the chat arrives.
 */
export default function ChatLoading() {
  return (
    <main className="chat-main relative" aria-busy="true" aria-label="Loading conversation">
      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="chat-scroll">
            <div className="chat-column animate-pulse space-y-6 py-2">
              <div className="ml-auto h-10 w-2/5 rounded-lg bg-border" />
              <div className="space-y-2">
                <div className="h-4 w-11/12 rounded bg-border" />
                <div className="h-4 w-4/5 rounded bg-border" />
                <div className="h-4 w-3/5 rounded bg-border" />
              </div>
              <div className="ml-auto h-10 w-1/3 rounded-lg bg-border" />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
