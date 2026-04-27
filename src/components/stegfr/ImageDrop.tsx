import { useCallback, useRef, useState, DragEvent } from "react";
import { ImagePlus, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  onImage: (file: File, dataUrl: string) => void;
  previewUrl?: string | null;
  onClear?: () => void;
  label?: string;
  className?: string;
}

/**
 * Drag & drop image picker. Preview is constrained to 150x150 only visually —
 * the underlying file keeps its original dimensions.
 */
export function ImageDrop({ onImage, previewUrl, onClear, label = "Drop image here", className }: Props) {
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handle = useCallback(
    (file: File) => {
      if (!file.type.startsWith("image/")) return;
      const reader = new FileReader();
      reader.onload = () => onImage(file, reader.result as string);
      reader.readAsDataURL(file);
    },
    [onImage],
  );

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handle(f);
  };

  return (
    <div
      className={cn(
        "group relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-4 text-center transition-all",
        over ? "border-primary bg-primary/10" : "border-border/60 bg-input/30 hover:border-primary/60",
        className,
      )}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/bmp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handle(f);
        }}
      />
      {previewUrl ? (
        <div className="relative">
          <img
            src={previewUrl}
            alt="upload preview"
            className="h-[150px] w-[150px] rounded-lg object-cover ring-1 ring-primary/40"
          />
          {onClear && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onClear();
              }}
              className="absolute -right-2 -top-2 rounded-full bg-destructive p-1 text-destructive-foreground shadow-lg transition hover:scale-110"
              aria-label="Remove image"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 py-6 text-muted-foreground">
          <ImagePlus className="h-8 w-8 text-primary" />
          <p className="text-sm font-medium text-foreground">{label}</p>
          <p className="text-xs">PNG · JPG · WebP · BMP</p>
        </div>
      )}
    </div>
  );
}

export default ImageDrop;