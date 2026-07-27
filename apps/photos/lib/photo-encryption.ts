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
  const wrapIv = crypto.getRandomValues(new Uint8Array(12));
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
      body,
      encryptedDEK: toBase64(new Uint8Array(wrappedDEK)),
      iv: toBase64(contentIv),
      spaceKeyWrapIv: toBase64(wrapIv),
    };
  } finally {
    rawDEK.fill(0);
  }
}

export async function decryptPhotoFile(
  ciphertext: ArrayBuffer,
  productSpaceKey: CryptoKey,
  context: PhotoEncryptionContext,
  descriptor: EncryptedPhotoDescriptor,
): Promise<ArrayBuffer> {
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
    const dek = await crypto.subtle.importKey(
      "raw",
      rawDEK,
      { name: "AES-GCM" },
      false,
      ["decrypt"],
    );
    return crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: fromBase64(descriptor.iv),
        additionalData: additionalData("content", context) as BufferSource,
        tagLength: 128,
      },
      dek,
      ciphertext,
    );
  } finally {
    rawDEK.fill(0);
  }
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
