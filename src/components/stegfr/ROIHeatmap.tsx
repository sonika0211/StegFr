import { useEffect, useRef } from "react";

interface Props {
  roi: number[][];
  size?: number;
}

/** Map value 0..1 to a color: blue/purple → poor, yellow/red → great. */
function colorFor(v: number): [number, number, number] {
  // Custom 5-stop gradient: indigo → purple → red → orange → yellow
  const stops: [number, [number, number, number]][] = [
    [0.0, [40, 20, 110]],
    [0.25, [120, 30, 180]],
    [0.5, [220, 40, 90]],
    [0.75, [255, 130, 30]],
    [1.0, [255, 230, 60]],
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const [a, ca] = stops[i];
    const [b, cb] = stops[i + 1];
    if (v <= b) {
      const t = (v - a) / (b - a || 1);
      return [
        ca[0] + (cb[0] - ca[0]) * t,
        ca[1] + (cb[1] - ca[1]) * t,
        ca[2] + (cb[2] - ca[2]) * t,
      ];
    }
  }
  return stops[stops.length - 1][1];
}

/** 32x32 ROI heatmap. */
export function ROIHeatmap({ roi, size = 256 }: Props) {
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
        img.data[i + 3] 255;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [roi]);

  return (
    <div className="space-y-2">
      <canvas
        ref={ref}
        style={{ width: size, height: size, imageRendering: "pixelated" }}
        className="rounded-lg ring-1 ring-primary/40 shadow-neon"
      />
      <div className="flex items-center justify-between text-[10px] uppercase tracking-widest text-muted-foreground">
        <span>Poor</span>
        <div
          className="h-2 flex-1 mx-3 rounded-full"
          style={{
            background:
              "linear-gradient(90deg, rgb(40,20,110), rgb(120,30,180), rgb(220,40,90), rgb(255,130,30), rgb(255,230,60))",
          }}
        />
        <span>Great</span>
      </div>
    </div>
  );
}

export default ROIHeatmap;