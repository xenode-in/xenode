import {
  openEnvelopeWithKey,
  sealEnvelopeWithKey,
  utf8,
  type CryptoEnvelope,
  type EnvelopeContext,
} from "@xenode/crypto-core";

/**
 * Album names are crypto-core envelopes under the Photos metadata key (HKDF,
 * Space-bound). The AAD binds the creating account, Space, product and
 * purpose; the server sees only the envelope.
 */
function albumNameContext(
  accountId: string,
  spaceId: string,
  type: "album-name" | "photo-metadata" = "album-name",
): EnvelopeContext {
  return {
    accountId,
    spaceId,
    productId: "photos",
    keyId: "photos-metadata",
    keyVersion: 1,
    type,
  };
}

export async function sealAlbumName(
  name: string,
  metadataKey: CryptoKey,
  accountId: string,
  spaceId: string,
): Promise<string> {
  return JSON.stringify(
    await sealEnvelopeWithKey(utf8(name), metadataKey, albumNameContext(accountId, spaceId)),
  );
}

/**
 * A photo's original file name, sealed the same way. The asset id is inside
 * the plaintext, so a name moved onto another photo fails to open.
 */
export async function sealPhotoName(
  name: string,
  assetId: string,
  metadataKey: CryptoKey,
  accountId: string,
  spaceId: string,
): Promise<string> {
  return JSON.stringify(
    await sealEnvelopeWithKey(
      utf8(JSON.stringify({ assetId, name })),
      metadataKey,
      albumNameContext(accountId, spaceId, "photo-metadata"),
    ),
  );
}

/** The original name, or null when it is missing or not sealed for this photo. */
export async function openPhotoName(
  sealed: string | undefined,
  assetId: string,
  metadataKey: CryptoKey,
  spaceId: string,
): Promise<string | null> {
  if (!sealed) return null;
  try {
    const envelope = JSON.parse(sealed) as CryptoEnvelope;
    const plaintext = await openEnvelopeWithKey(
      envelope,
      metadataKey,
      albumNameContext(envelope.accountId, spaceId, "photo-metadata"),
    );
    const value = JSON.parse(new TextDecoder().decode(plaintext)) as { assetId?: unknown; name?: unknown };
    return value.assetId === assetId && typeof value.name === "string" && value.name ? value.name : null;
  } catch {
    return null;
  }
}

/** The plaintext name, or null when the value is not this Space's album name. */
export async function openAlbumName(
  encryptedName: string,
  metadataKey: CryptoKey,
  spaceId: string,
): Promise<string | null> {
  try {
    const envelope = JSON.parse(encryptedName) as CryptoEnvelope;
    const plaintext = await openEnvelopeWithKey(
      envelope,
      metadataKey,
      albumNameContext(envelope.accountId, spaceId),
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    return null;
  }
}
