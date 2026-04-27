import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Props {
  label: string;
  value: ReactNode;
  unit?: string;
  hint?: string;
  accent?: "cyan" | "magenta" | "purple";
  big?: boolean;
}

const accentClass: Record<NonNullable<Props["accent"]>, string> = {
  cyan: "from-[hsl(185_100%_50%/0.18)] to-transparent text-primary",
  magenta: "from-[hsl(295_100%_55%/0.2)] to-transparent text-secondary",
  purple: "from-[hsl(270_100%_65%/0.2)] to-transparent text-[hsl(270_100%_75%)]",
};

export function MetricCard({ label, value, unit, hint, accent = "cyan", big }: Props) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-border/60 bg-card/40 p-3",
        "bg-gradient-to-br",
        accentClass[accent],
      )}
    >
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className={cn("font-display font-semibold leading-tight", big ? "mt-1 text-3xl" : "mt-0.5 text-xl")}>
        {value}
        {unit && <span className="ml-1 text-xs font-normal text-muted-foreground">{unit}</span>}
      </p>
      {hint && <p className="mt-1 text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default MetricCard;