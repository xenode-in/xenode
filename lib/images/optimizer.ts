import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

let ffmpeg: FFmpeg | null = null;

async function loadFFmpeg() {
  if (ffmpeg) return ffmpeg;

  ffmpeg = new FFmpeg();

  const baseURL = "/ffmpeg";
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
  });

  return ffmpeg;
}

/**
 * Optimizes an image file for fast previews.
 * Converts to WebP with high quality (q:v 85).
 */
export async function optimizeImage(file: File): Promise<File> {
  // Only process standard images. Skip if already webp or not an image.
  if (!file.type.startsWith("image/") || file.type === "image/webp" || file.type === "image/gif") {
    return file;
  }

  try {
    const ffmpeg = await loadFFmpeg();
    const inputName = `input_${crypto.randomUUID()}`;
    const outputName = `output_${crypto.randomUUID()}.webp`;

    // Write file to FFmpeg's virtual filesystem
    await ffmpeg.writeFile(inputName, await fetchFile(file));

    // Run conversion command
    // -i input: input file
    // -c:v libwebp: use WebP encoder
    // -q:v 85: high quality lossy (usually 30-50% smaller than JPG/PNG)
    await ffmpeg.exec([
      "-i",
      inputName,
      "-c:v",
      "libwebp",
      "-q:v",
      "85",
      outputName,
    ]);

    // Read result
    const data = await ffmpeg.readFile(outputName);
    const resultBuffer = new Uint8Array(data as any).buffer as ArrayBuffer;
    const resultBlob = new Blob([resultBuffer], { type: "image/webp" });

    // Cleanup virtual FS
    await ffmpeg.deleteFile(inputName);
    await ffmpeg.deleteFile(outputName);

    // Return as a File object
    return new File([resultBlob], `${file.name.split(".")[0]}.webp`, {
      type: "image/webp",
      lastModified: file.lastModified,
    });
  } catch (err) {
    console.error(
      "[FFmpeg] Image optimization failed, falling back to original:",
      err
    );
    return file;
  }
}
