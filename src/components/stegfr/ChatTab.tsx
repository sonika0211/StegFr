import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Download, MessageSquare, Search, Send, UserPlus } from "lucide-react";
import GlowCard from "./GlowCard";
import ShinyButton from "./ShinyButton";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import {
  Conversation,
  Message,
  Profile,
  getOrCreateConversation,
  getSignedImageUrl,
  searchProfiles,
  sendMessage,
} from "@/lib/chat";
import { cn } from "@/lib/utils";

interface ConvWithPeer extends Conversation {
  peer?: Profile;
}

export default function ChatTab() {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<ConvWithPeer[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Profile[]>([]);
  const [searching, setSearching] = useState(false);
  const [imgUrls, setImgUrls] = useState<Record<string, string>>({});
  const scrollRef = useRef<HTMLDivElement>(null);

  // ---- load conversations ----
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select("*")
        .or(`user_a.eq.${user.id},user_b.eq.${user.id}`)
        .order("last_message_at", { ascending: false });
      if (error) return toast.error(error.message);
      const convs = (data ?? []) as Conversation[];
      const peerIds = convs.map((c) => (c.user_a === user.id ? c.user_b : c.user_a));
      let peers: Profile[] = [];
      if (peerIds.length) {
        const { data: p } = await supabase
          .from("profiles")
          .select("id, username, display_name, email")
          .in("id", peerIds);
        peers = (p ?? []) as Profile[];
      }
      if (cancelled) return;
      const merged: ConvWithPeer[] = convs.map((c) => ({
        ...c,
        peer: peers.find((pp) => pp.id === (c.user_a === user.id ? c.user_b : c.user_a)),
      }));
      setConversations(merged);
      if (!activeId && merged.length) setActiveId(merged[0].id);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // ---- realtime: new conversations for me ----
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("conv-list-" + user.id)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations" },
        async (payload) => {
          const row = (payload.new ?? payload.old) as Conversation | undefined;
          if (!row) return;
          if (row.user_a !== user.id && row.user_b !== user.id) return;
          // refetch list
          const { data } = await supabase
            .from("conversations")
            .select("*")
            .or(`user_a.eq.${user.id},user_b.eq.${user.id}`)
            .order("last_message_at", { ascending: false });
          const convs = (data ?? []) as Conversation[];
          const peerIds = convs.map((c) => (c.user_a === user.id ? c.user_b : c.user_a));
          const { data: p } = await supabase
            .from("profiles")
            .select("id, username, display_name, email")
            .in("id", peerIds.length ? peerIds : ["00000000-0000-0000-0000-000000000000"]);
          const peers = (p ?? []) as Profile[];
          setConversations(
            convs.map((c) => ({
              ...c,
              peer: peers.find((pp) => pp.id === (c.user_a === user.id ? c.user_b : c.user_a)),
            })),
          );
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  // ---- load + subscribe messages for active conv ----
  useEffect(() => {
    if (!activeId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", activeId)
        .order("created_at", { ascending: true });
      if (error) return toast.error(error.message);
      if (cancelled) return;
      setMessages((data ?? []) as Message[]);
    })();
    const channel = supabase
      .channel("msgs-" + activeId)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${activeId}` },
        (payload) => {
          setMessages((m) => {
            const next = payload.new as Message;
            if (m.some((x) => x.id === next.id)) return m;
            return [...m, next];
          });
        },
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [activeId]);

  // ---- resolve signed image URLs ----
  useEffect(() => {
    const missing = messages.filter((m) => m.image_path && !imgUrls[m.image_path!]);
    if (!missing.length) return;
    (async () => {
      const updates: Record<string, string> = {};
      for (const m of missing) {
        try {
          updates[m.image_path!] = await getSignedImageUrl(m.image_path!);
        } catch {
          /* ignore */
        }
      }
      if (Object.keys(updates).length) setImgUrls((u) => ({ ...u, ...updates }));
    })();
  }, [messages, imgUrls]);

  // ---- auto scroll ----
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, activeId]);

  // ---- search ----
  useEffect(() => {
    if (!user || !search.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const r = await searchProfiles(search, user.id);
        setResults(r);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [search, user]);

  const startChatWith = async (p: Profile) => {
    if (!user) return;
    try {
      const c = await getOrCreateConversation(user.id, p.id);
      setActiveId(c.id);
      setSearch("");
      setResults([]);
      // ensure visible in list
      setConversations((prev) =>
        prev.some((x) => x.id === c.id) ? prev : [{ ...c, peer: p }, ...prev],
      );
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const onSend = async () => {
    if (!user || !activeId || !draft.trim()) return;
    const text = draft.trim();
    setDraft("");
    try {
      await sendMessage({ conversationId: activeId, senderId: user.id, content: text });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const active = useMemo(() => conversations.find((c) => c.id === activeId), [conversations, activeId]);

  const downloadImage = async (path: string) => {
    const url = imgUrls[path] ?? (await getSignedImageUrl(path));
    const a = document.createElement("a");
    a.href = url;
    a.download = "stegfr-stego.png";
    a.target = "_blank";
    a.click();
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
      {/* SIDEBAR */}
      <GlowCard>
        <div className="flex h-[600px] flex-col p-4">
          <header className="mb-3 flex items-center gap-2 text-primary">
            <MessageSquare className="h-4 w-4" />
            <h2 className="font-display text-sm uppercase tracking-[0.25em]">Chats</h2>
          </header>
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by username or email"
              className="w-full rounded-xl border border-border bg-input/60 py-2 pl-10 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/40"
            />
          </div>

          <div className="flex-1 space-y-1 overflow-y-auto pr-1">
            {search.trim() ? (
              <>
                {searching && <p className="px-2 text-xs text-muted-foreground">Searching…</p>}
                {!searching && results.length === 0 && (
                  <p className="px-2 text-xs text-muted-foreground">No users found</p>
                )}
                {results.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => startChatWith(p)}
                    className="flex w-full items-center gap-3 rounded-lg border border-transparent p-2 text-left transition hover:border-border hover:bg-card/40"
                  >
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-primary text-xs font-bold text-primary-foreground">
                      {p.username[0]?.toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">@{p.username}</p>
                      <p className="truncate text-[11px] text-muted-foreground">{p.email}</p>
                    </div>
                    <UserPlus className="h-4 w-4 text-primary" />
                  </button>
                ))}
              </>
            ) : conversations.length === 0 ? (
              <p className="px-2 text-xs text-muted-foreground">
                Search for a user above to start a chat
              </p>
            ) : (
              conversations.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setActiveId(c.id)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg border p-2 text-left transition",
                    activeId === c.id
                      ? "border-primary/60 bg-primary/10"
                      : "border-transparent hover:border-border hover:bg-card/40",
                  )}
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-primary text-xs font-bold text-primary-foreground">
                    {c.peer?.username?.[0]?.toUpperCase() ?? "?"}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      @{c.peer?.username ?? "unknown"}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {new Date(c.last_message_at).toLocaleString()}
                    </p>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      </GlowCard>

      {/* MESSAGES */}
      <GlowCard>
        <div className="flex h-[600px] flex-col">
          <header className="border-b border-border/40 p-4">
            {active ? (
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-primary text-sm font-bold text-primary-foreground">
                  {active.peer?.username?.[0]?.toUpperCase() ?? "?"}
                </div>
                <div>
                  <p className="text-sm font-semibold">@{active.peer?.username ?? "unknown"}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {active.peer?.email}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Select a conversation</p>
            )}
          </header>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.map((m) => {
              const mine = m.sender_id === user?.id;
              const url = m.image_path ? imgUrls[m.image_path] : null;
              return (
                <div
                  key={m.id}
                  className={cn("flex", mine ? "justify-end" : "justify-start")}
                >
                  <div
                    className={cn(
                      "max-w-[80%] space-y-2 rounded-2xl px-4 py-2 text-sm",
                      mine
                        ? "bg-gradient-primary text-primary-foreground"
                        : "border border-border bg-card/60 text-foreground",
                    )}
                  >
                    {m.content && <p className="whitespace-pre-wrap break-words">{m.content}</p>}
                    {m.image_path && (
                      <div className="space-y-2">
                        {url ? (
                          <img
                            src={url}
                            alt="stego"
                            className="max-h-64 rounded-lg ring-1 ring-border"
                          />
                        ) : (
                          <div className="h-24 w-48 animate-pulse rounded-lg bg-muted/30" />
                        )}
                        <button
                          onClick={() => downloadImage(m.image_path!)}
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition",
                            mine
                              ? "bg-black/30 hover:bg-black/40"
                              : "border border-border hover:bg-accent",
                          )}
                        >
                          <Download className="h-3 w-3" /> Download stego
                        </button>
                        {m.image_kind && (
                          <p className="text-[10px] uppercase tracking-widest opacity-70">
                            {m.image_kind}
                          </p>
                        )}
                      </div>
                    )}
                    <p className="text-right text-[10px] opacity-60">
                      {new Date(m.created_at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                </div>
              );
            })}
            {active && messages.length === 0 && (
              <p className="text-center text-xs text-muted-foreground">
                No messages yet — say hi or send a stego image from the Encrypt tab.
              </p>
            )}
          </div>

          {active && (
            <div className="flex items-end gap-2 border-t border-border/40 p-3">
              <textarea
                rows={1}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    onSend();
                  }
                }}
                placeholder="Type a message…"
                className="flex-1 resize-none rounded-xl border border-border bg-input/60 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/40"
              />
              <ShinyButton onClick={onSend} disabled={!draft.trim()}>
                <Send className="h-4 w-4" /> Send
              </ShinyButton>
            </div>
          )}
        </div>
      </GlowCard>
    </div>
  );
}