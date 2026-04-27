/** Load an HTMLImageElement from a data URL. */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.crossOrigin = "anonymous";
    img.src = src;
  });
}

/** Read an HTMLImageElement to ImageData at full natural size. */
export function imageToImageData(img: HTMLImageElement): ImageData {
  const cv = document.createElement("canvas");
  cv.width = img.naturalWidth;
  cv.height = img.naturalHeight;
  const ctx = cv.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, cv.width, cv.height);
}

/** Convert ImageData → PNG data URL (lossless — preserves LSBs). */
export function imageDataToPngDataUrl(img: ImageData): string {
  const cv = document.createElement("canvas");
  cv.width = img.width;
  cv.height = img.height;
  cv.getContext("2d")!.putImageData(img, 0, 0);
  return cv.toDataURL("image/png");
}

/** Convert ImageData → PNG Blob. */
export function imageDataToPngBlob(img: ImageData): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const cv = document.createElement("canvas");
    cv.width = img.width;
    cv.height = img.height;
    cv.getContext("2d")!.putImageData(img, 0, 0);
    cv.toBlob((b) => (b ? resolve(b) : reject(new Error("blob fail"))), "image/png");
  });
}

export async function dataUrlToImageData(dataUrl: string): Promise<ImageData> {
  return imageToImageData(await loadImage(dataUrl));
}