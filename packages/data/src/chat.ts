// Coach conversations saved by the chat API (chat_threads / chat_messages), read back on any device so a
// conversation started on the phone continues on the desktop. Reads go through the signed-in client, so RLS
// limits them to the owner's rows. The rows are rebuilt into turns by turnsFromMessages (cards re-validated).
import type { SupabaseClient } from '@supabase/supabase-js';
import { turnsFromMessages, type ChatMessageRow, type ChatThreadRow, type Turn } from '@diet/core/coach';

export interface Conversation {
  threads: ChatThreadRow[];
  /** the thread shown (the latest, or the one asked for), null when there is none yet */
  threadId: string | null;
  turns: Turn[];
}

/** Newest first. */
export async function loadThreads(client: SupabaseClient, limit = 20): Promise<ChatThreadRow[]> {
  const { data, error } = await client
    .from('chat_threads')
    .select('id,title,created_at,updated_at')
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as ChatThreadRow[];
}

/** The last `limit` messages of a thread, oldest first. */
export async function loadThreadMessages(client: SupabaseClient, threadId: string, limit = 80): Promise<ChatMessageRow[]> {
  const { data, error } = await client
    .from('chat_messages')
    .select('id,role,content,created_at')
    .eq('thread_id', threadId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return ((data ?? []) as ChatMessageRow[]).reverse();
}

/** The thread an assistant message (a card's messageId) belongs to. */
export async function threadOfMessage(client: SupabaseClient, messageId: string): Promise<string | null> {
  const { data, error } = await client.from('chat_messages').select('thread_id').eq('id', messageId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { thread_id?: string } | null)?.thread_id ?? null;
}

/**
 * The thread list plus one conversation: `threadId` if given, else the thread of `messageId` if given,
 * else the most recently updated thread.
 */
export async function loadConversation(client: SupabaseClient, want: { threadId?: string | null; messageId?: string | null } = {}): Promise<Conversation> {
  const [threads, fromMessage] = await Promise.all([
    loadThreads(client),
    !want.threadId && want.messageId ? threadOfMessage(client, want.messageId) : Promise.resolve(null),
  ]);
  const threadId = want.threadId ?? fromMessage ?? threads[0]?.id ?? null;
  const turns = threadId ? turnsFromMessages(await loadThreadMessages(client, threadId)) : [];
  return { threads, threadId, turns };
}
