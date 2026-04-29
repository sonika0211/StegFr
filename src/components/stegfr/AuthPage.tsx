import { useState } from "react";
import { Lock, Mail, ShieldCheck, User as UserIcon } from "lucide-react";
import { z } from "zod";
import { toast } from "sonner";
import GlowCard from "./GlowCard";
import ShinyButton from "./ShinyButton";
import TextScramble from "./TextScramble";
import { BackgroundPaths } from "@/components/ui/background-paths";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";

const emailSchema = z.string().trim().email("Invalid email").max(255);
const pwSchema = z.string().min(1, "Password required");
const identifierSchema = z.string().trim().min(1, "Email or username required").max(255);
const usernameSchema = z
  .string()
  .trim()
  .min(2, "Min 2 chars")
  .max(32)
  .regex(/^[a-zA-Z0-9_]+$/, "Only letters, numbers, _");

type Mode = "signin" | "signup";

export default function AuthPage() {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    try {
      const p = pwSchema.parse(password);
      setBusy(true);
      if (mode === "signup") {
        const e = emailSchema.parse(email);
        const u = usernameSchema.parse(username);
        const { error } = await supabase.auth.signUp({
          email: e,
          password: p,
          options: {
            emailRedirectTo: window.location.origin,
            data: { username: u, display_name: u },
          },
        });
        if (error) throw error;
        toast.success("Account created — welcome operator");
      } else {
        const id = identifierSchema.parse(identifier);
        let loginEmail = id;
        // If not an email, treat as username and look up email
        if (!id.includes("@")) {
          const { data, error: lookupErr } = await (supabase.rpc as any)(
            "get_email_for_username",
            { _username: id.toLowerCase() },
          );
          if (lookupErr) throw lookupErr;
          if (!data) throw new Error("No account found for that username");
          loginEmail = data as string;
        }
        const { error } = await supabase.auth.signInWithPassword({
          email: loginEmail,
          password: p,
        });
        if (error) throw error;
        toast.success("Signed in");
      }
    } catch (err) {
      const msg = err instanceof z.ZodError ? err.issues[0].message : (err as Error).message;
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    setBusy(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      toast.error(result.error.message);
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <BackgroundPaths />
      <GlowCard className="relative z-10 w-full max-w-md animate-fade-in-up">
        <div className="space-y-6 p-8 sm:p-10">
          <div className="flex items-center gap-3 text-xs uppercase tracking-[0.3em] text-primary/80">
            <ShieldCheck className="h-4 w-4" /> STEGANOGRAPHY FOR REAL
          </div>
          <div>
            <h1 className="font-display text-5xl font-bold leading-none">
              <TextScramble text="StegFr" className="text-gradient" />
            </h1>
            <p className="mt-3 text-sm text-muted-foreground">Hide. Encrypt. Protect.</p>
          </div>

          <div className="inline-flex w-full rounded-xl border border-border/60 bg-card/40 p-1">
            {(["signin", "signup"] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={
                  "flex-1 rounded-lg py-2 text-xs font-medium uppercase tracking-widest transition " +
                  (mode === m
                    ? "bg-gradient-primary text-primary-foreground shadow-neon"
                    : "text-muted-foreground hover:text-foreground")
                }
              >
                {m === "signin" ? "Sign in" : "Sign up"}
              </button>
            ))}
          </div>

          <div className="space-y-3">
            {mode === "signup" && (
              <div className="relative">
                <UserIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary/70" />
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="username"
                  className="w-full rounded-xl border border-border bg-input/60 py-3 pl-10 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/40"
                />
              </div>
            )}
            {mode === "signup" ? (
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary/70" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="agent@stegfr.io"
                  className="w-full rounded-xl border border-border bg-input/60 py-3 pl-10 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/40"
                />
              </div>
            ) : (
              <div className="relative">
                <UserIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary/70" />
                <input
                  type="text"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="email or username"
                  autoComplete="username"
                  className="w-full rounded-xl border border-border bg-input/60 py-3 pl-10 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/40"
                />
              </div>
            )}
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary/70" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-xl border border-border bg-input/60 py-3 pl-10 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/40"
              />
            </div>
          </div>

          <ShinyButton size="lg" className="w-full" onClick={submit} disabled={busy}>
            {busy ? "…" : mode === "signin" ? "Sign in" : "Create account"}
          </ShinyButton>

          <div className="flex items-center gap-3 text-[10px] uppercase tracking-widest text-muted-foreground">
            <div className="h-px flex-1 bg-border/60" /> or <div className="h-px flex-1 bg-border/60" />
          </div>

          <ShinyButton size="lg" variant="ghost" className="w-full" onClick={google} disabled={busy}>
            Continue with Google
          </ShinyButton>

          <p className="text-center text-[11px] text-muted-foreground">StegFr</p>
        </div>
      </GlowCard>
    </div>
  );
}