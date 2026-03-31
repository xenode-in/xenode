import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

let ffmpeg: FFmpeg | null = null;

async function loadFFmpeg() {
  if (ffmpeg) return ffmpeg;

  ffmpeg = new FFmpeg();

  // In production, we'll host these files locally in the public folder
  const baseURL = "/ffmpeg";
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
  });

  return ffmpeg;
}

/**
 * Optimizes a video file for streaming by moving the moov atom to the front.
 * Uses ffmpeg.wasm with '-movflags +faststart' and '-c copy'.
 */
export async function optimizeVideoForStreaming(file: File): Promise<File> {
  // Only process mp4 videos (most common for moov atom issues)
  // Other formats might not support faststart or might not need it for MSE
  if (!file.type.includes("mp4") && !file.name.endsWith(".mp4")) {
    return file;
  }

  try {
    const ffmpeg = await loadFFmpeg();
    const inputName = "input.mp4";
    const outputName = "output.mp4";

    // Write file to FFmpeg's virtual filesystem
    await ffmpeg.writeFile(inputName, await fetchFile(file));

    // Run remux command: copy codecs, move moov atom to front
    // -i input.mp4: input file
    // -c copy: don't re-encode, just copy streams (fast!)
    // -movflags +faststart: move moov atom to the beginning
    await ffmpeg.exec([
      "-i",
      inputName,
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      outputName,
    ]);

    // Read result
    const data = await ffmpeg.readFile(outputName);

    // FFmpeg.wasm often returns data backed by a SharedArrayBuffer.
    // To satisfy TypeScript and ensure compatibility with the Blob constructor,
    // we clone the data into a regular ArrayBuffer.
    const resultBuffer = new Uint8Array(data as any).buffer as ArrayBuffer;

    const resultBlob = new Blob([resultBuffer], { type: file.type });

    // Cleanup virtual FS
    await ffmpeg.deleteFile(inputName);
    await ffmpeg.deleteFile(outputName);

    // Return as a File object to maintain original metadata if needed
    return new File([resultBlob], file.name, {
      type: file.type,
      lastModified: file.lastModified,
    });
  } catch (err) {
    console.error(
      "[FFmpeg] Optimization failed, falling back to original file:",
      err,
    );
    return file;
  }
}
