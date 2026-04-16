/**
 * lib/video/audio-extractor.ts
 *
 * Universal audio track extractor using Mediabunny.
 * Supports MP4, MKV, MOV, WebM, etc.
 *
 * Extracts a specific audio track and remuxes it into a standalone .m4a (MP4) 
 * or similar container that the browser can decode directly.
 */

import { 
  Input, 
  Output, 
  Conversion,
  BlobSource, 
  BufferTarget, 
  MATROSKA, 
  MP4, 
  QTFF,
  Mp4OutputFormat
} from "mediabunny";

/**
 * Extracts a single audio track from a video/audio file.
 *
 * @param file         The source media file (Blob/File)
 * @param trackIndex   0-based index into audioTracks[] (e.g. 1 = second audio track)
 * @param _language    Label used for internal logging
 * @returns A Blob containing the remuxed audio track, or null on failure
 */
export async function extractAudioTrack(
  file: File,
  trackIndex: number,
  _language: string,
): Promise<Blob | null> {
  let input: Input | null = null;
  try {
    // 1. Initialize input with format support
    input = new Input({
      source: new BlobSource(file),
      formats: [MATROSKA, MP4, QTFF],
    });

    // 2. Identify the target track number
    const audioTracks = await input.getAudioTracks();
    if (audioTracks.length <= trackIndex) {
      console.warn(`[AudioExtractor] Track index ${trackIndex} not found. Available: ${audioTracks.length}`);
      return null;
    }
    const targetTrackNumber = audioTracks[trackIndex].number;

    // 3. Prepare output target (in-memory buffer)
    const target = new BufferTarget();
    const output = new Output({
      format: new Mp4OutputFormat(),
      target,
    });

    // 4. Use Conversion to orchestrate the remuxing
    const conversion = await Conversion.init({
      input,
      output,
      video: { discard: true },
      subtitle: { discard: true },
      audio: (track) => ({
        discard: track.number !== targetTrackNumber
      })
    });

    await conversion.execute();

    if (!target.buffer) {
      throw new Error("Target buffer is empty after extraction");
    }

    const blob = new Blob([target.buffer], { type: "audio/mp4" });
    console.log(`[AudioExtractor] Successfully extracted ${blob.size} bytes`);
    
    return blob;
  } catch (error) {
    console.error("[AudioExtractor] Extraction failed:", error);
    return null;
  } finally {
    if (input) {
      try {
        await input.dispose();
      } catch (e) {
        console.warn("[AudioExtractor] Dispose failed:", e);
      }
    }
  }
}
