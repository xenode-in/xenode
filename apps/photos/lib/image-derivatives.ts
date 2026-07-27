export type ImageDerivative = {
  blob: Blob;
  contentType: "image/jpeg";
  height: number;
  width: number;
};

export type ImageDerivatives = {
  optimized: ImageDerivative;
  thumbnail: ImageDerivative;
};

const THUMBNAIL_MAX_EDGE = 512;
const OPTIMIZED_MAX_EDGE = 2560;

export function fitImageWithin(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !Number.isFinite(maxEdge) ||
    width <= 0 ||
    height <= 0 ||
    maxEdge <= 0
  ) {
    throw new Error("Invalid image dimensions");
  }
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export async function createImageDerivatives(
  source: Blob,
): Promise<ImageDerivatives> {
  const bitmap = await createImageBitmap(source);
  try {
    const [thumbnail, optimized] = await Promise.all([
      renderJpeg(bitmap, THUMBNAIL_MAX_EDGE, 0.78),
      renderJpeg(bitmap, OPTIMIZED_MAX_EDGE, 0.86),
    ]);
    return { thumbnail, optimized };
  } finally {
    bitmap.close();
  }
}

async function renderJpeg(
  bitmap: ImageBitmap,
  maxEdge: number,
  quality: number,
): Promise<ImageDerivative> {
  const dimensions = fitImageWithin(bitmap.width, bitmap.height, maxEdge);
  const canvas = document.createElement("canvas");
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Could not create image processor");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) =>
        result
          ? resolve(result)
          : reject(new Error("Could not encode image derivative")),
      "image/jpeg",
      quality,
    );
  });
  return {
    blob,
    contentType: "image/jpeg",
    ...dimensions,
  };
}
