import { supabase } from "@/integrations/supabase/client";

export interface Profile {
  id: string;
  username: string;
  display_name: string | null;
  email: string | null;
}

export interface Conversation {
  id: string;
  user_a: string;
  user_b: string;
  last_message_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string | null;
  image_path: string | null;
  image_kind: string | null;
  created_at: string;
}

/** Get-or-create a 1-on-1 conversation between current user and other user. */
export async function getOrCreateConversation(meId: string, otherId: string): Promise<Conversation> {
  if (meId === otherId) throw new Error("Can't chat with yourself");
  const [a, b] = meId < otherId ? [meId, otherId] : [otherId, meId];
  const { data: existing } = await supabase
    .from("conversations")
    .select("*")
    .eq("user_a", a)
    .eq("user_b", b)
    .maybeSingle();
  if (existing) return existing as Conversation;
  const { data, error } = await supabase
    .from("conversations")
    .insert({ user_a: a, user_b: b })
    .select()
    .single();
  if (error) throw error;
  return data as Conversation;
}

export async function searchProfiles(query: string, excludeId: string): Promise<Profile[]> {
  const q = query.trim();
  if (!q) return [];
  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, display_name, email")
    .or(`username.ilike.%${q}%,email.ilike.%${q}%,display_name.ilike.%${q}%`)
    .neq("id", excludeId)
    .limit(10);
  if (error) throw error;
  return (data ?? []) as Profile[];
}

export async function uploadStegoImage(
  conversationId: string,
  blob: Blob,
): Promise<string> {
  const path = `${conversationId}/${crypto.randomUUID()}.png`;
  const { error } = await supabase.storage
    .from("stego-images")
    .upload(path, blob, { contentType: "image/png", upsert: false });
  if (error) throw error;
  return path;
}

export async function getSignedImageUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from("stego-images")
    .createSignedUrl(path, 60 * 60);
  if (error) throw error;
  return data.signedUrl;
}

export async function sendMessage(opts: {
  conversationId: string;
  senderId: string;
  content?: string;
  imagePath?: string;
  imageKind?: string;
}) {
  const { error } = await supabase.from("messages").insert({
    conversation_id: opts.conversationId,
    sender_id: opts.senderId,
    content: opts.content ?? null,
    image_path: opts.imagePath ?? null,
    image_kind: opts.imageKind ?? null,
  });
  if (error) throw error;
}