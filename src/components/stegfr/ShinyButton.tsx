import { ButtonHTMLAttributes, forwardRef, ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: "primary" | "ghost";
  size?: "default" | "lg";
}

/**
 * Shimmering gradient button with animated highlight sweep.
 */
export const ShinyButton = forwardRef<HTMLButtonElement, Props>(
  ({ children, className, variant = "primary", size = "default", disabled, ...rest }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled}
        {...rest}
        className={cn(
          "group relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-xl font-medium",
          "transition-all duration-300 disabled:cursor-not-allowed disabled:opacity-50",
          size === "lg" ? "px-7 py-3.5 text-base" : "px-5 py-2.5 text-sm",
          variant === "primary"
            ? "text-primary-foreground shadow-neon hover:scale-[1.02] active:scale-[0.98]"
            : "border border-primary/40 text-primary hover:bg-primary/10",
          className,
        )}
      >
        {variant === "primary" && (
          <>
            <span
              aria-hidden
              className="absolute inset-0 bg-gradient-primary"
              style={{ backgroundSize: "200% 200%", animation: "shimmer 3s linear infinite" }}
            />
            <span
              aria-hidden
              className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/40 to-transparent transition-transform duration-700 group-hover:translate-x-full"
            />
          </>
        )}
        <span className="relative z-10 inline-flex items-center gap-2 whitespace-nowrap">{children}</span>
      </button>
    );
  },
);
ShinyButton.displayName = "ShinyButton";

export default ShinyButton;