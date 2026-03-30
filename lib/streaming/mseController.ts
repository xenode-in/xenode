// Advanced controller: buffering + seeking support
export function createMSEController({ video, sourceBuffer, fetchChunk, decryptChunk, totalChunks, chunkDuration }) {
  let currentIndex = 0;
  let isFetching = false;

  async function appendChunk(index) {
    const encrypted = await fetchChunk(index);
    const decrypted = await decryptChunk(encrypted, index);
    sourceBuffer.appendBuffer(decrypted);
  }

  async function fillBuffer() {
    if (isFetching) return;
    isFetching = true;

    while (currentIndex < totalChunks && !sourceBuffer.updating) {
      await appendChunk(currentIndex);
      currentIndex++;
    }

    isFetching = false;
  }

  video.addEventListener("seeking", async () => {
    const newIndex = Math.floor(video.currentTime / chunkDuration);

    sourceBuffer.abort();
    try {
      sourceBuffer.remove(0, video.duration);
    } catch {}

    currentIndex = newIndex;
    await fillBuffer();
  });

  sourceBuffer.addEventListener("updateend", () => {
    fillBuffer();
  });

  fillBuffer();
}
