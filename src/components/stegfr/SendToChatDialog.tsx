import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Search, Send } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import ShinyButton from "./ShinyButton";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import {
  Conversation,
  Profile,
  getOrCreateConversation,
  searchProfiles,
  sendMessage,
  uploadStegoImage,
} from "@/lib/chat";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  imageBlob: Blob | null;
  defaultNote?: string;
  onSent?: () => void;
}

interface Row {
  conv?: Conversation;
  peer: Profile;
}

export default function SendToChatDialog({
  open,
  onOpenChange,
  imageBlob,
  defaultNote,
  onSent,
}: Props) {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [search, setSearch] = useState("");
  const [searchRows, setSearchRows] = useState<Profile[]>([]);
  const [note, setNote] = useState(defaultNote ?? "Encrypted stego image inside 🔒");
  const [sendingTo, setSendingTo] = useState<string | null>(null);

  // load my conversations + peers
  useEffect(() => {
    if (!open || !user) return;
    (async () => {
      const { data } = await supabase
        .from("conversations")
        .select("*")
        .or(`user_a.eq.${user.id},user_b.eq.${user.id}`)
        .order("last_message_at", { ascending: false });
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
      setRows(
        convs
          .map((c) => {
            const peerId = c.user_a === user.id ? c.user_b : c.user_a;
            const peer = peers.find((pp) => pp.id === peerId);
            return peer ? { conv: c, peer } : null;
          })
          .filter(Boolean) as Row[],
      );
    })();
  }, [open, user]);

  // search
  useEffect(() => {
    if (!user || !search.trim()) {
      setSearchRows([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        setSearchRows(await searchProfiles(search, user.id));
      } catch (e) {
        toast.error((e as Error).message);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [search, user]);

  const sendTo = async (peer: Profile, existing?: Conversation) => {
    if (!user || !imageBlob) return;
    setSendingTo(peer.id);
    try {
      const conv = existing ?? (await getOrCreateConversation(user.id, peer.id));
      const path = await uploadStegoImage(conv.id, imageBlob);
      await sendMessage({
        conversationId: conv.id,
        senderId: user.id,
        content: note.trim() || null,
        imagePath: path,
        imageKind: "stego",
      });
      toast.success(`Sent to @${peer.username}`);
      onSent?.();
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSendingTo(null);
    }
  };

  const showSearch = !!search.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Send stego image</DialogTitle>
        </DialogHeader>

        <div className="space-y-2">
          <label className="text-[11px] uppercase tracking-widest text-muted-foreground">
            Note (optional)
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="w-full resize-none rounded-xl border border-border bg-input/60 p-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/40"
          />
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search recipients by username/email"
            className="w-full rounded-xl border border-border bg-input/60 py-2 pl-10 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/40"
          />
        </div>

        <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
          {showSearch ? (
            searchRows.length === 0 ? (
              <p className="px-2 text-xs text-muted-foreground">No users found</p>
            ) : (
              searchRows.map((p) => (
                <button
                  key={p.id}
                  onClick={() => sendTo(p)}
                  disabled={!!sendingTo || !imageBlob}
                  className="flex w-full items-center gap-3 rounded-lg border border-border/60 p-2 text-left transition hover:bg-card/40 disabled:opacity-50"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-primary text-xs font-bold text-primary-foreground">
                    {p.username[0]?.toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">@{p.username}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{p.email}</p>
                  </div>
                  <Send className="h-4 w-4 text-primary" />
                </button>
              ))
            )
          ) : rows.length === 0 ? (
            <p className="px-2 text-xs text-muted-foreground">
              No chats yet — search for a user above.
            </p>
          ) : (
            rows.map(({ conv, peer }) => (
              <button
                key={peer.id}
                onClick={() => sendTo(peer, conv)}
                disabled={!!sendingTo || !imageBlob}
                className="flex w-full items-center gap-3 rounded-lg border border-border/60 p-2 text-left transition hover:bg-card/40 disabled:opacity-50"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-primary text-xs font-bold text-primary-foreground">
                  {peer.username[0]?.toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">@{peer.username}</p>
                  <p className="truncate text-[11px] text-muted-foreground">{peer.email}</p>
                </div>
                {sendingTo === peer.id ? (
                  <span className="text-[11px] text-muted-foreground">sending…</span>
                ) : (
                  <Send className="h-4 w-4 text-primary" />
                )}
              </button>
            ))
          )}
        </div>

        <ShinyButton
          variant="ghost"
          className="w-full"
          onClick={() => onOpenChange(false)}
        >
          Cancel
        </ShinyButton>
      </DialogContent>
    </Dialog>
  );
}