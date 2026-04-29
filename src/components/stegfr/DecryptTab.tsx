import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, KeyRound, Unlock, XCircle } from "lucide-react";
import GlowCard from "./GlowCard";
import ShinyButton from "./ShinyButton";
import ImageDrop from "./ImageDrop";
import { dataUrlToImageData } from "@/lib/stego/imageUtils";
import { extract } from "@/lib/stego/embed";
import { decryptMessage } from "@/lib/stego/crypto";

interface DecryptTabProps {
  preload?: { url: string; name: string } | null;
  onPreloadConsumed?: () => void;
}

export function DecryptTab({ preload, onPreloadConsumed }: DecryptTabProps = {}) {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [imgData, setImgData] = useState<ImageData | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Accept image pasted from Chat tab
  useEffect(() => {
    if (!preload?.url) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(preload.url);
        const blob = await res.blob();
        const dataUrl: string = await new Promise((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(fr.result as string);
          fr.onerror = reject;
          fr.readAsDataURL(blob);
        });
        if (cancelled) return;
        setImgUrl(dataUrl);
        setMessage(null);
        setError(null);
        setImgData(await dataUrlToImageData(dataUrl));
        toast.success("Image loaded from chat");
      } catch (e) {
        toast.error("Could not load image from chat");
      } finally {
        onPreloadConsumed?.();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [preload, onPreloadConsumed]);

  const handleImage = async (_f: File, dataUrl: string) => {
    setImgUrl(dataUrl);
    setMessage(null);
    setError(null);
    setImgData(await dataUrlToImageData(dataUrl));
  };

  const onExtract = async () => {
    if (!imgData) return toast.error("Upload a stego image first");
    if (!password) return toast.error("Enter the password");
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      // Try the priorities the embed policy might have chosen, in order.
      const priorities = ["mixed", "edges", "texture"] as const;
      let decrypted: string | null = null;
      let lastErr: Error | null = null;
      for (const p of priorities) {
        try {
          const payload = extract(imgData, p);
          decrypted = await decryptMessage(payload, password);
          break;
        } catch (e) {
          lastErr = e as Error;
        }
      }
      if (decrypted == null) throw lastErr ?? new Error("Decryption failed");
      setMessage(decrypted);
      toast.success("Message extracted ✓");
    } catch {
      setError("Wrong password or no payload found in this image.");
      toast.error("Extraction failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <GlowCard>
        <div className="space-y-5 p-6">
          <header className="flex items-center gap-2 text-primary">
            <Unlock className="h-4 w-4" />
            <h2 className="font-display text-sm uppercase tracking-[0.25em]">Stego Input</h2>
          </header>

          <ImageDrop
            onImage={handleImage}
            previewUrl={imgUrl}
            onClear={() => {
              setImgUrl(null);
              setImgData(null);
              setMessage(null);
              setError(null);
            }}
            label="Drop stego image"
          />

          <div className="space-y-2">
            <label className="text-[11px] uppercase tracking-widest text-muted-foreground">
              Password
            </label>
            <div className="relative">
              <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary/70" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-xl border border-border bg-input/60 py-2.5 pl-10 pr-3 text-sm font-mono outline-none focus:border-primary focus:ring-2 focus:ring-primary/40"
              />
            </div>
          </div>
        </div>
      </GlowCard>

      <GlowCard glowColor="hsl(295 100% 60% / 0.35)">
        <div className="space-y-5 p-6">
          <header className="flex items-center gap-2 text-secondary">
            <Unlock className="h-4 w-4" />
            <h2 className="font-display text-sm uppercase tracking-[0.25em]">Extraction</h2>
          </header>

          <ShinyButton onClick={onExtract} disabled={!imgData || !password || busy} className="w-full">
            <KeyRound className="h-4 w-4" />
            {busy ? "Extracting…" : "Extract Message"}
          </ShinyButton>

          {message && (
            <div className="space-y-2 rounded-xl border border-[hsl(145_90%_55%/0.4)] bg-[hsl(145_90%_55%/0.08)] p-4">
              <div className="flex items-center gap-2 text-[hsl(145_90%_60%)]">
                <CheckCircle2 className="h-4 w-4" />
                <p className="text-xs font-semibold uppercase tracking-widest">Decrypted</p>
              </div>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-background/60 p-3 font-mono text-sm text-foreground">
                {message}
              </pre>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
              <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{error}</p>
            </div>
          )}

          {!message && !error && (
            <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-border/60 text-xs text-muted-foreground">
              Drop a stego image and enter the password
            </div>
          )}
        </div>
      </GlowCard>
    </div>
  );
}

export default DecryptTab;