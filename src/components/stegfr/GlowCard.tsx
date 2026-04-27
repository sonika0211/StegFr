import { ReactNode } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface Props {
  children: ReactNode;
  className?: string;
  /** kept for backwards-compat; no longer used */
  glowColor?: string;
  intensity?: number;
}

function CardPaths({ position }: { position: number }) {
  const paths = Array.from({ length: 18 }, (_, i) => ({
    id: i,
    d: `M-${380 - i * 5 * position} -${189 + i * 6}C-${
      380 - i * 5 * position
    } -${189 + i * 6} -${312 - i * 5 * position} ${216 - i * 6} ${
      152 - i * 5 * position
    } ${343 - i * 6}C${616 - i * 5 * position} ${470 - i * 6} ${
      684 - i * 5 * position
    } ${875 - i * 6} ${684 - i * 5 * position} ${875 - i * 6}`,
    width: 0.4 + i * 0.03,
  }));

  return (
    <svg
      className="absolute inset-0 h-full w-full text-primary"
      viewBox="0 0 696 316"
      fill="none"
      preserveAspectRatio="xMidYMid slice"
    >
      {paths.map((p) => (
        <motion.path
          key={p.id}
          d={p.d}
          stroke="currentColor"
          strokeWidth={p.width}
          strokeOpacity={0.08 + p.id * 0.015}
          initial={{ pathLength: 0.3, opacity: 0.4 }}
          animate={{
            pathLength: 1,
            opacity: [0.2, 0.5, 0.2],
            pathOffset: [0, 1, 0],
          }}
          transition={{
            duration: 22 + Math.random() * 10,
            repeat: Number.POSITIVE_INFINITY,
            ease: "linear",
          }}
        />
      ))}
    </svg>
  );
}

/**
 * Card with animated white background paths. No cursor-follow glow.
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
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden opacity-40">
          <CardPaths position={1} />
          <CardPaths position={-1} />
        </div>
        <div className="relative">{children}</div>
      </div>
    </div>
  );
}

export default GlowCard;