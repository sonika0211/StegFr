import { useRef, MouseEvent, ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Props {
  children: ReactNode;
  className?: string;
  /** css color for the spotlight */
  glowColor?: string;
  /** width of edge gradient ring */
  intensity?: number;
}

/**
 * Spotlight glow card. Tracks mouse and renders a soft radial highlight
 * plus an animated gradient border. Pure presentation.
 */
export function GlowCard({
  children,
  className,
  glowColor = "hsl(185 100% 60% / 0.35)",
  intensity = 1,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);

  const handleMove = (e: MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - rect.left}px`);
    el.style.setProperty("--my", `${e.clientY - rect.top}px`);
  };

  return (
    <div
      ref={ref}
      onMouseMove={handleMove}
      className={cn(
        "group relative rounded-2xl p-[1px] shadow-card transition-all duration-300",
        "bg-[linear-gradient(135deg,hsl(var(--primary)/0.6),hsl(var(--secondary)/0.6),hsl(var(--primary)/0.6))]",
        "hover:shadow-neon",
        className,
      )}
      style={{ ["--glow" as string]: glowColor }}
    >
      <div className="relative h-full w-full overflow-hidden rounded-2xl glass">
        {/* spotlight */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
          style={{
            background: `radial-gradient(${300 * intensity}px circle at var(--mx,50%) var(--my,50%), var(--glow), transparent 60%)`,
          }}
        />
        <div className="relative">{children}</div>
      </div>
    </div>
  );
}

export default GlowCard;