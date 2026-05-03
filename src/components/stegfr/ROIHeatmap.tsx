import { useEffect, useRef } from "react";

interface Props {
  roi: number[][];
  /** Max display width in CSS pixels (height follows the image's aspect ratio). */
  size?: number;
  /** Original image dimensions — heatmap is rendered at this aspect ratio (mini version of the image). */
  imageWidth?: number;
  imageHeight?: number;
}

/** Greyscale: 0 = black (poor), 0.5 = grey (near-good), 1 = white (great). */
function colorFor(v: number): [number, number, number] {
  const c = Math.round(Math.max(0, Math.min(1, v)) * 255);
  return [c, c, c];
}

/**
 * 32x32 ROI rendered as a "mini version of the image": the heatmap canvas is
 * stretched to the same aspect ratio as the source image (no cropping).
 */
export function ROIHeatmap({ roi, size = 256, imageWidth, imageHeight }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const n = roi.length;
    cv.width = n;
    cv.height = n;
    const ctx = cv.getContext("2d")!;
    const img = ctx.createImageData(n, n);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const [r, g, b] = colorFor(roi[y][x]);
        const i = (y * n + x) * 4;
        img.data[i] = r;
        img.data[i + 1] = g;
        img.data[i + 2] = b;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [roi]);

  // Compute display dimensions matching the original image's aspect ratio.
  let dispW = size;
  let dispH = size;
  if (imageWidth && imageHeight && imageWidth > 0 && imageHeight > 0) {
    const ar = imageWidth / imageHeight;
    if (ar >= 1) {
      dispW = size;
      dispH = Math.round(size / ar);
    } else {
      dispH = size;
      dispW = Math.round(size * ar);
    }
  }

  return (
    <div className="space-y-2">
      <canvas
        ref={ref}
        style={{ width: dispW, height: dispH, imageRendering: "pixelated" }}
        className="rounded-lg ring-1 ring-primary/40 shadow-neon"
      />
      <div className="flex items-center justify-between text-[10px] uppercase tracking-widest text-muted-foreground">
        <span>Poor</span>
        <div
          className="h-2 flex-1 mx-3 rounded-full ring-1 ring-border"
          style={{ background: "linear-gradient(90deg, #000, #808080, #fff)" }}
        />
        <span>Great</span>
      </div>
    </div>
  );
}

export default ROIHeatmap;