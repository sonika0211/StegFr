import { useState } from "react";
import { Lock, Sparkles, ShieldCheck } from "lucide-react";
import GlowCard from "./GlowCard";
import ShinyButton from "./ShinyButton";
import TextScramble from "./TextScramble";
import { BackgroundPaths } from "@/components/ui/background-paths";

interface Props {
  onEnter: () => void;
}

/**
 * Splash / optional gateway. No real auth — "Skip to Demo" or fake email entry.
 */
export function SignInPage({ onEnter }: Props) {
  const [email, setEmail] = useState("");

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      {/* full-screen animated paths on pure black */}
      <BackgroundPaths />

      <GlowCard className="relative z-10 w-full max-w-md animate-fade-in-up">
        <div className="space-y-6 p-8 sm:p-10">
          <div className="flex items-center gap-3 text-xs uppercase tracking-[0.3em] text-primary/80">
            <ShieldCheck className="h-4 w-4" /> Steganography Frontier
          </div>
          <div>
            <h1 className="font-display text-5xl font-bold leading-none">
              <TextScramble text="StegFr" className="text-gradient" />
            </h1>
            <p className="mt-3 text-sm text-muted-foreground">
              Hide. Encrypt. Protect. Conceal AES-encrypted payloads inside the noisiest regions of any image — entirely in your browser.
            </p>
          </div>

          <div className="space-y-3">
            <label className="text-xs uppercase tracking-widest text-muted-foreground">Operator ID (optional)</label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary/70" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="agent@stegfr.io"
                className="w-full rounded-xl border border-border bg-input/60 py-3 pl-10 pr-3 text-sm text-foreground placeholder:text-muted-foreground/60 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/40"
              />
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <ShinyButton size="lg" className="flex-1" onClick={onEnter}>
              Enter StegFr
            </ShinyButton>
            <ShinyButton size="lg" variant="ghost" className="flex-1" onClick={onEnter}>
              Start Right Away
            </ShinyButton>
          </div>

          <p className="text-center text-[11px] text-muted-foreground">
            StegFr
          </p>
        </div>
      </GlowCard>
    </div>
  );
}

export default SignInPage;