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
function albumNameContext(accountId: string, spaceId: string): EnvelopeContext {
  return {
    accountId,
    spaceId,
    productId: "photos",
    keyId: "photos-metadata",
    keyVersion: 1,
    type: "album-name",
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
