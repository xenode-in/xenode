/**
 * Streams decrypted media chunks into a MediaSource when the media Service
 * Worker is unavailable. MP4 (progressive or fragmented) is remuxed into
 * per-track fragments with mp4box as chunks arrive; byte-stream formats MSE
 * accepts natively (WebM, MP3) are appended as-is. Buffering is paced against
 * the playhead and played data is evicted, so long files stay under the MSE
 * quota.
 *
 * ponytail: playback is sequential — seeking back into evicted data or far
 * ahead waits on the feed; the Service Worker path supports random access.
 */
import { createFile, MP4BoxBuffer } from "mp4box";

export type MediaElementRef = { readonly current: HTMLMediaElement | null };

/** Stop feeding once this much is buffered ahead of the playhead. */
const MAX_AHEAD_SECONDS = 60;
/** Played data older than this is evicted from the SourceBuffers. */
const KEEP_BEHIND_SECONDS = 30;

const ISO_BMFF_TYPES = new Set(["video/mp4", "audio/mp4", "video/quicktime", "audio/x-m4a"]);
const NATIVE_MSE_TYPES: Record<string, string> = {
  "video/webm": 'video/webm; codecs="vp9, opus"',
  "audio/webm": 'audio/webm; codecs="opus"',
  "audio/mpeg": "audio/mpeg",
};

/** True when this content type can be streamed through MSE in this browser. */
export function canStreamWithMse(contentType: string): boolean {
  if (typeof MediaSource === "undefined") return false;
  if (ISO_BMFF_TYPES.has(contentType)) return true;
  const mime = NATIVE_MSE_TYPES[contentType];
  return Boolean(mime && MediaSource.isTypeSupported(mime));
}

function bufferedAhead(media: HTMLMediaElement): number {
  const { buffered, currentTime } = media;
  for (let i = 0; i < buffered.length; i++) {
    if (buffered.start(i) <= currentTime + 0.5 && currentTime <= buffered.end(i)) {
      return buffered.end(i) - currentTime;
    }
  }
  return 0;
}

/** Resolves when the player has room for more data (or immediately without a player). */
async function waitForRoom(mediaRef: MediaElementRef | undefined, signal: AbortSignal) {
  for (;;) {
    const media = mediaRef?.current;
    if (!media || signal.aborted || bufferedAhead(media) < MAX_AHEAD_SECONDS) return;
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        media.removeEventListener("timeupdate", done);
        resolve();
      };
      const timer = setTimeout(done, 1000);
      media.addEventListener("timeupdate", done);
    });
  }
}

interface Lane {
  sb: SourceBuffer;
  queue: ArrayBuffer[];
  ended: boolean;
}

/**
 * Appends queued segments in order, evicting played data first and waiting
 * out quota pressure. `onIdle` runs whenever a lane drains.
 */
function createPump(
  ms: MediaSource,
  mediaRef: MediaElementRef | undefined,
  onIdle: () => void,
  onError: (error: Error) => void,
) {
  const pump = (lane: Lane) => {
    if (lane.sb.updating || ms.readyState !== "open") return;
    const media = mediaRef?.current;
    const evictBefore = media ? media.currentTime - KEEP_BEHIND_SECONDS : 0;
    if (evictBefore > 1 && lane.sb.buffered.length && lane.sb.buffered.start(0) < evictBefore - 1) {
      lane.sb.remove(0, evictBefore);
      return;
    }
    const next = lane.queue.shift();
    if (!next) return onIdle();
    try {
      lane.sb.appendBuffer(next);
    } catch (error) {
      if (error instanceof DOMException && error.name === "QuotaExceededError" && media) {
        // Full: retry once playback has moved on and more can be evicted.
        lane.queue.unshift(next);
        media.addEventListener("timeupdate", () => pump(lane), { once: true });
        return;
      }
      onError(error instanceof Error ? error : new Error("Media append failed"));
    }
  };
  const attach = (lane: Lane) => {
    lane.sb.addEventListener("updateend", () => pump(lane));
    lane.sb.addEventListener("error", () => onError(new Error("Media segment rejected")));
  };
  return { pump, attach };
}

function openMediaSource(ms: MediaSource): Promise<void> {
  if (ms.readyState === "open") return Promise.resolve();
  return new Promise((resolve) => ms.addEventListener("sourceopen", () => resolve(), { once: true }));
}

/**
 * Feeds `nextChunk(0..chunkCount-1)` into `ms`. Resolves once the stream has
 * ended; rejects when the browser cannot play this file through MSE.
 */
export async function streamToMediaSource(input: {
  ms: MediaSource;
  contentType: string;
  chunkCount: number;
  nextChunk: (index: number) => Promise<ArrayBuffer>;
  mediaRef?: MediaElementRef;
  signal: AbortSignal;
  onFirstData?: () => void;
}): Promise<void> {
  const { ms, contentType, chunkCount, nextChunk, mediaRef, signal } = input;
  await openMediaSource(ms);
  if (signal.aborted) return;

  let fail!: (error: Error) => void;
  let finish!: () => void;
  const finished = new Promise<void>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  const lanes: Lane[] = [];
  let fed = false;
  let firstData = false;
  const markFirstData = () => {
    if (firstData) return;
    firstData = true;
    input.onFirstData?.();
  };
  const maybeEnd = () => {
    if (!fed || ms.readyState !== "open") return;
    if (!lanes.length) return fail(new Error("No playable tracks"));
    if (lanes.some((lane) => !lane.ended || lane.queue.length || lane.sb.updating)) return;
    ms.endOfStream();
    finish();
  };
  const { pump, attach } = createPump(ms, mediaRef, maybeEnd, (error) => fail(error));
  signal.addEventListener("abort", () => finish(), { once: true });

  const feed = async (append: (chunk: ArrayBuffer) => void, end: () => void) => {
    for (let i = 0; i < chunkCount; i++) {
      await waitForRoom(mediaRef, signal);
      if (signal.aborted) return;
      append(await nextChunk(i));
    }
    end();
    fed = true;
    maybeEnd();
  };

  if (!ISO_BMFF_TYPES.has(contentType)) {
    const lane: Lane = { sb: ms.addSourceBuffer(NATIVE_MSE_TYPES[contentType]), queue: [], ended: false };
    attach(lane);
    lanes.push(lane);
    await Promise.race([
      feed(
        (chunk) => {
          lane.queue.push(chunk);
          markFirstData();
          pump(lane);
        },
        () => {
          lane.ended = true;
        },
      ),
      finished,
    ]);
    return finished;
  }

  // ISO BMFF: remux into one fragmented track per SourceBuffer.
  const file = createFile();
  file.onError = (_module, message) => fail(new Error(message || "Unsupported MP4 layout"));
  file.onReady = (info) => {
    try {
      const tracks = [
        ...info.videoTracks.map((track) => ({ track, kind: "video" })),
        ...info.audioTracks.map((track) => ({ track, kind: "audio" })),
      ];
      if (!tracks.length) throw new Error("No playable tracks");
      for (const { track, kind } of tracks) {
        const mime = `${kind}/mp4; codecs="${track.codec}"`;
        if (!MediaSource.isTypeSupported(mime)) throw new Error(`Unsupported codec ${track.codec}`);
        const lane: Lane = { sb: ms.addSourceBuffer(mime), queue: [], ended: false };
        attach(lane);
        lanes.push(lane);
        file.setSegmentOptions(track.id, lane, { nbSamples: 100 });
      }
      for (const init of file.initializeSegmentation("per-track")) {
        const lane = init.user as Lane;
        lane.queue.push(init.buffer);
        pump(lane);
      }
      file.start();
    } catch (error) {
      fail(error instanceof Error ? error : new Error("Unsupported MP4"));
    }
  };
  file.onSegment = (id, user, buffer, nextSample, last) => {
    const lane = user as Lane;
    lane.queue.push(buffer);
    if (last) lane.ended = true;
    file.releaseUsedSamples(id, nextSample);
    markFirstData();
    pump(lane);
  };

  let offset = 0;
  await Promise.race([
    feed(
      (chunk) => {
        file.appendBuffer(MP4BoxBuffer.fromArrayBuffer(chunk, offset));
        offset += chunk.byteLength;
      },
      () => {
        file.flush();
        // flush() marks the final segment of each track as last.
        for (const lane of lanes) lane.ended = true;
      },
    ),
    finished,
  ]);
  return finished;
}
