import {
  FILE_CHUNK_BYTES,
  decryptFileChunk,
  decryptFileChunks,
  fileChunkCount,
  sealFileChunk,
} from "@xenode/crypto-core";

type PhotoEncryptionContext = {
  accountId: string;
  spaceId: string;
  objectKey: string;
};

export type EncryptedPhoto = {
  body: ArrayBuffer;
  encryptedDEK: string;
  iv: string;
  spaceKeyWrapIv: string;
};

export type EncryptedPhotoDescriptor = {
  encryptedDEK: string;
  iv: string;
  spaceKeyWrapIv: string;
};

/**
 * A video original in the chunked `xenode-file/1` format (crypto-core), so it
 * can be read and played chunk by chunk: one stored object holding every
 * sealed chunk in order, each bound to the object key, its index and the
 * count. `iv` is chunk 0's IV.
 */
export type EncryptedPhotoVideo = Omit<EncryptedPhoto, "body"> & {
  body: Blob;
  chunkSize: number;
  chunkIvs: string[];
};

function additionalData(
  purpose: "content" | "dek",
  context: PhotoEncryptionContext,
): Uint8Array {
  return new TextEncoder().encode(
    [
      "xenode-photos",
      "v1",
      purpose,
      context.accountId,
      context.spaceId,
      context.objectKey,
    ].join("\u001f"),
  );
}

export async function encryptPhotoFile(
  source: Blob,
  productSpaceKey: CryptoKey,
  context: PhotoEncryptionContext,
): Promise<EncryptedPhoto> {
  const rawDEK = crypto.getRandomValues(new Uint8Array(32));
  const contentIv = crypto.getRandomValues(new Uint8Array(12));
  try {
    const dek = await crypto.subtle.importKey(
      "raw",
      rawDEK,
      { name: "AES-GCM" },
      false,
      ["encrypt"],
    );
    const body = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: contentIv,
        additionalData: additionalData("content", context) as BufferSource,
        tagLength: 128,
      },
      dek,
      await source.arrayBuffer(),
    );
    return {
      body,
      iv: toBase64(contentIv),
      ...(await wrapPhotoDEK(rawDEK, productSpaceKey, context)),
    };
  } finally {
    rawDEK.fill(0);
  }
}

export async function encryptPhotoVideo(
  source: Blob,
  productSpaceKey: CryptoKey,
  context: PhotoEncryptionContext,
): Promise<EncryptedPhotoVideo> {
  const rawDEK = crypto.getRandomValues(new Uint8Array(32));
  try {
    const dek = await crypto.subtle.importKey("raw", rawDEK, { name: "AES-GCM" }, false, ["encrypt"]);
    const count = fileChunkCount(source.size, FILE_CHUNK_BYTES);
    const parts: ArrayBuffer[] = [];
    const chunkIvs: string[] = [];
    for (let index = 0; index < count; index++) {
      const start = index * FILE_CHUNK_BYTES;
      const sealed = await sealFileChunk(
        await source.slice(start, start + FILE_CHUNK_BYTES).arrayBuffer(),
        dek,
        { fileId: context.objectKey },
        index,
        count,
      );
      parts.push(sealed.ciphertext);
      chunkIvs.push(toBase64(sealed.iv));
    }
    return {
      body: new Blob(parts),
      iv: chunkIvs[0],
      chunkSize: FILE_CHUNK_BYTES,
      chunkIvs,
      ...(await wrapPhotoDEK(rawDEK, productSpaceKey, context)),
    };
  } finally {
    rawDEK.fill(0);
  }
}

async function wrapPhotoDEK(
  rawDEK: Uint8Array<ArrayBuffer>,
  productSpaceKey: CryptoKey,
  context: PhotoEncryptionContext,
) {
  const wrapIv = crypto.getRandomValues(new Uint8Array(12));
  const wrappedDEK = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: wrapIv,
      additionalData: additionalData("dek", context) as BufferSource,
      tagLength: 128,
    },
    productSpaceKey,
    rawDEK,
  );
  return {
    encryptedDEK: toBase64(new Uint8Array(wrappedDEK)),
    spaceKeyWrapIv: toBase64(wrapIv),
  };
}

/** The content key of a photo or video, for reading it chunk by chunk. */
export async function unwrapPhotoDEK(
  productSpaceKey: CryptoKey,
  context: PhotoEncryptionContext,
  descriptor: Pick<EncryptedPhotoDescriptor, "encryptedDEK" | "spaceKeyWrapIv">,
): Promise<CryptoKey> {
  const rawDEK = new Uint8Array(
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: fromBase64(descriptor.spaceKeyWrapIv),
        additionalData: additionalData("dek", context) as BufferSource,
        tagLength: 128,
      },
      productSpaceKey,
      fromBase64(descriptor.encryptedDEK),
    ),
  );
  try {
    return await crypto.subtle.importKey("raw", rawDEK, { name: "AES-GCM" }, false, ["decrypt"]);
  } finally {
    rawDEK.fill(0);
  }
}

/** Opens chunk `index` of a chunked video original. */
export function decryptPhotoVideoChunk(
  sealedChunk: ArrayBuffer,
  dek: CryptoKey,
  objectKey: string,
  chunkIvs: readonly string[],
  index: number,
): Promise<ArrayBuffer> {
  return decryptFileChunk(sealedChunk, dek, fromBase64(chunkIvs[index]), { fileId: objectKey }, index, chunkIvs.length);
}

/** Opens a whole chunked video original. */
export async function decryptPhotoVideo(
  ciphertext: ArrayBuffer,
  dek: CryptoKey,
  objectKey: string,
  chunkSize: number,
  chunkIvs: readonly string[],
): Promise<ArrayBuffer[]> {
  return decryptFileChunks(ciphertext, dek, chunkIvs.map(fromBase64), { fileId: objectKey }, chunkSize);
}

export async function decryptPhotoFile(
  ciphertext: ArrayBuffer,
  productSpaceKey: CryptoKey,
  context: PhotoEncryptionContext,
  descriptor: EncryptedPhotoDescriptor,
): Promise<ArrayBuffer> {
  return crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: fromBase64(descriptor.iv),
      additionalData: additionalData("content", context) as BufferSource,
      tagLength: 128,
    },
    await unwrapPhotoDEK(productSpaceKey, context, descriptor),
    ciphertext,
  );
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
