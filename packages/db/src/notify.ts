/**
 * Postgres LISTEN/NOTIFY, scoped one channel per message id.
 *
 * Built for the resumable-chat-state fix: a client reconnecting to an
 * in-progress turn needs to know the moment it finishes, without polling.
 * Postgres is already the datastore, so NOTIFY (fired by whichever request is
 * actually generating the turn) plus LISTEN (held by the reconnect endpoint's
 * open connection) does this with zero extra client-visible requests.
 *
 * postgres.js multiplexes every `.listen()` channel over one dedicated
 * connection it opens lazily (see its `listen()` source) — this does not cost
 * a pool connection per open reconnect stream.
 */
import { pgClient } from "./client";

function channelFor(messageId: string): string {
  return `mola_message_done:${messageId}`;
}

/** Fired once a message reaches a terminal status (done or error). */
export async function notifyMessageDone(messageId: string): Promise<void> {
  await pgClient.notify(channelFor(messageId), "1");
}

/**
 * Subscribes to one message's completion notification. Resolves once
 * postgres.js confirms the LISTEN is registered — callers must await this
 * BEFORE reading the message's current status, so a completion that lands in
 * between "start listening" and "check status" is never missed. Call the
 * returned function to unsubscribe.
 */
export async function listenForMessageDone(
  messageId: string,
  onDone: () => void,
): Promise<() => Promise<void>> {
  const { unlisten } = await pgClient.listen(channelFor(messageId), onDone);
  return unlisten;
}
