// NEW: True streaming MSE player (no Blob usage)
export async function startE2EEStream({ video, urls, decryptChunk, dek, ivs, mimeCodec }) {
  const ms = new MediaSource();
  video.src = URL.createObjectURL(ms);

  await new Promise((r) => ms.addEventListener("sourceopen", r, { once: true }));

  const sb = ms.addSourceBuffer(mimeCodec);

  let index = 0;

  const queue: ArrayBuffer[] = [];
  let appending = false;

  async function pump() {
    if (appending || queue.length === 0) return;
    appending = true;
    const chunk = queue.shift();
    sb.appendBuffer(chunk);
  }

  sb.addEventListener("updateend", () => {
    appending = false;
    pump();
  });

  async function fetchLoop() {
    while (index < urls.length) {
      const res = await fetch(urls[index]);
      const cipher = await res.arrayBuffer();
      const plain = dek ? await decryptChunk(cipher, dek, ivs[index]) : cipher;
      queue.push(plain);
      pump();
      index++;
    }
  }

  fetchLoop();
}
