import { useState } from "react";
import { Lock, Unlock, ShieldCheck, Github, MessageSquare, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import TextScramble from "./TextScramble";
import EncryptTab from "./EncryptTab";
import DecryptTab from "./DecryptTab";
import ChatTab from "./ChatTab";
import { BackgroundPaths } from "@/components/ui/background-paths";
import { useAuth } from "@/hooks/useAuth";

type Tab = "encrypt" | "decrypt" | "chat";

export function StegFrApp() {
  const [tab, setTab] = useState<Tab>("encrypt");
  const { user, signOut } = useAuth();

  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* ambient bg */}
      <div aria-hidden className="pointer-events-none fixed inset-0 grid-bg opacity-20" />
      <BackgroundPaths />
      <div
        aria-hidden
        className="pointer-events-none fixed -top-40 left-1/4 h-[500px] w-[500px] rounded-full opacity-30 blur-3xl animate-float-orb"
        style={{ background: "radial-gradient(circle, hsl(0 0% 100% / 0.15), transparent 70%)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none fixed -bottom-40 right-1/4 h-[500px] w-[500px] rounded-full opacity-30 blur-3xl animate-float-orb"
        style={{
          background: "radial-gradient(circle, hsl(0 0% 100% / 0.12), transparent 70%)",
          animationDelay: "-7s",
        }}
      />

      <div className="relative z-10 mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {/* ============== HEADER ============== */}
        <header className="flex flex-wrap items-center justify-between gap-4 pb-8">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-primary shadow-neon">
              <ShieldCheck className="h-6 w-6 text-primary-foreground" />
            </div>
            <div>
              <h1 className="font-display text-3xl font-bold leading-none sm:text-4xl">
                <TextScramble text="StegFr" className="text-gradient" loopDelay={6000} />
              </h1>
              <p className="mt-1 text-xs uppercase tracking-[0.3em] text-muted-foreground">
                Hide · Encrypt · Protect
              </p>
            </div>
          </div>

          <nav className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="hidden items-center gap-1.5 rounded-full border border-border/60 bg-card/40 px-3 py-1.5 sm:inline-flex">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[hsl(145_90%_55%)]" />
              Engine online · runs locally
            </span>
            {user && (
              <span className="hidden items-center gap-1.5 rounded-full border border-border/60 bg-card/40 px-3 py-1.5 sm:inline-flex">
                {user.email}
              </span>
            )}
            <a
              href="https://en.wikipedia.org/wiki/Steganography"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card/40 px-3 py-1.5 hover:text-primary"
            >
              <Github className="h-3.5 w-3.5" /> About
            </a>
            <button
              onClick={signOut}
              className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card/40 px-3 py-1.5 hover:text-primary"
            >
              <LogOut className="h-3.5 w-3.5" /> Sign out
            </button>
          </nav>
        </header>

        {/* ============== TABS ============== */}
        <div className="mb-6 inline-flex rounded-xl border border-border/60 bg-card/40 p-1 backdrop-blur">
          {([
            { id: "encrypt" as const, icon: Lock, label: "Encrypt" },
            { id: "decrypt" as const, icon: Unlock, label: "Decrypt" },
            { id: "chat" as const, icon: MessageSquare, label: "Chat" },
          ]).map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                "relative inline-flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-medium transition-all",
                tab === id
                  ? "bg-gradient-primary text-primary-foreground shadow-neon"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>

        <div key={tab} className="animate-fade-in-up">
          {tab === "encrypt" ? <EncryptTab /> : tab === "decrypt" ? <DecryptTab /> : <ChatTab />}
        </div>

        <footer className="mt-12 border-t border-border/40 pt-6 text-center text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
          STEGFR · STEGANOGRAPHY FOR REAL
        </footer>
      </div>
    </div>
  );
}

export default StegFrApp;