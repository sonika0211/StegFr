import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const CHARS = "!<>-_\\/[]{}—=+*^?#________ABCXYZ01";

interface Props {
  text: string;
  className?: string;
  autoPlay?: boolean;
  /** ms between full reveals when autoplaying */
  loopDelay?: number;
}

/**
 * Animated character scramble effect — kinetic typography.
 * Triggers on hover and (optionally) on an autoplay loop.
 */
export function TextScramble({ text, className, autoPlay = true, loopDelay = 4000 }: Props) {
  const [display, setDisplay] = useState(text);
  const frameRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  const scramble = (target: string) => {
    const oldText = display;
    const length = Math.max(oldText.length, target.length);
    const queue: { from: string; to: string; start: number; end: number; char?: string }[] = [];
    for (let i = 0; i < length; i++) {
      const from = oldText[i] || "";
      const to = target[i] || "";
      const start = Math.floor(Math.random() * 20);
      const end = start + Math.floor(Math.random() * 30) + 10;
      queue.push({ from, to, start, end });
    }
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    frameRef.current = 0;
    const update = () => {
      let output = "";
      let complete = 0;
      for (let i = 0; i < queue.length; i++) {
        const { from, to, start, end } = queue[i];
        let { char } = queue[i];
        if (frameRef.current >= end) {
          complete++;
          output += to;
        } else if (frameRef.current >= start) {
          if (!char || Math.random() < 0.28) {
            char = CHARS[Math.floor(Math.random() * CHARS.length)];
            queue[i].char = char;
          }
          output += char;
        } else {
          output += from;
        }
      }
      setDisplay(output);
      if (complete < queue.length) {
        frameRef.current++;
        rafRef.current = requestAnimationFrame(update);
      }
    };
    update();
  };

  useEffect(() => {
    scramble(text);
    if (!autoPlay) return;
    const id = setInterval(() => scramble(text), loopDelay);
    return () => {
      clearInterval(id);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, autoPlay, loopDelay]);

  return (
    <span
      className={cn("inline-block cursor-pointer select-none font-display tracking-tight", className)}
      onMouseEnter={() => scramble(text)}
      aria-label={text}
    >
      {display}
    </span>
  );
}

export default TextScramble;