import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Props {
  children: ReactNode;
  className?: string;
  /** kept for backwards-compat; no longer used */
  glowColor?: string;
  intensity?: number;
}

/**
 * Plain card. No background paths, no cursor-follow glow.
 */
export function GlowCard({ children, className }: Props) {
  return (
    <div
      className={cn(
        "group relative rounded-2xl p-[1px] shadow-card transition-all duration-300",
        "bg-[linear-gradient(135deg,hsl(var(--border)/0.6),hsl(var(--border)/0.2),hsl(var(--border)/0.6))]",
        className,
      )}
    >
      <div className="relative h-full w-full overflow-hidden rounded-2xl glass">
        <div className="relative">{children}</div>
      </div>
    </div>
  );
}

export default GlowCard;