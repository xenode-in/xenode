export interface HandoffBinding {
  transactionId: string;
  accountId: string;
  clientId: string;
  productId: string;
  spaceId: string;
  destinationOrigin: string;
  state: string;
  nonce: string;
}

export interface SealedHandoff {
  binding: HandoffBinding;
  senderPublicKey: JsonWebKey;
  destinationKeyFingerprint: string;
  iv: string;
  ciphertext: string;
  expiresAt: string;
}

export interface HandoffStore {
  consume(transactionId: string, now: Date): Promise<boolean>;
}

export interface PendingHandoff {
  binding: HandoffBinding;
  destinationKeyPair: CryptoKeyPair;
  destinationKeyFingerprint: string;
  brokerUrl: string;
}

export function createOneTimeHandoffStore(): HandoffStore {
  const consumed = new Set<string>();
  return {
    async consume(transactionId) {
      if (consumed.has(transactionId)) return false;
      consumed.add(transactionId);
      return true;
    },
  };
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function aad(binding: HandoffBinding): Uint8Array {
  return new TextEncoder().encode(
    [
      "xenode-key-handoff-v1",
      binding.transactionId,
      binding.accountId,
      binding.clientId,
      binding.productId,
      binding.spaceId,
      binding.destinationOrigin,
      binding.state,
      binding.nonce,
    ].join("\u001f"),
  );
}

export async function fingerprintHandoffPublicKey(
  publicKey: JsonWebKey,
): Promise<string> {
  const canonical = JSON.stringify({
    crv: publicKey.crv,
    kty: publicKey.kty,
    x: publicKey.x,
    y: publicKey.y,
  });
  return base64Url(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical)),
    ),
  );
}

async function deriveAesKey(
  privateKey: CryptoKey,
  publicKey: CryptoKey,
  binding: HandoffBinding,
): Promise<CryptoKey> {
  const shared = await crypto.subtle.deriveBits(
    { name: "ECDH", public: publicKey },
    privateKey,
    256,
  );
  const hkdf = await crypto.subtle.importKey("raw", shared, "HKDF", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(
        await crypto.subtle.digest("SHA-256", aad(binding) as BufferSource),
      ),
      info: new TextEncoder().encode("xenode/product-space-key/handoff/v1"),
    },
    hkdf,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function generateHandoffKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"],
  );
}

export async function exportHandoffPublicKey(key: CryptoKey): Promise<JsonWebKey> {
  return crypto.subtle.exportKey("jwk", key);
}

async function importPublicKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
}

function randomToken(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(24)));
}

export function decodeHandoffPublicKey(value: string): JsonWebKey {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(fromBase64Url(value)));
  } catch {
    throw new Error("Invalid handoff public key");
  }
  const key = parsed as Partial<JsonWebKey>;
  if (
    key.kty !== "EC" ||
    key.crv !== "P-256" ||
    typeof key.x !== "string" ||
    typeof key.y !== "string"
  ) {
    throw new Error("Invalid handoff public key");
  }
  return key;
}

export async function createProductHandoffRequest(args: {
  accountsOrigin: string;
  accountId: string;
  clientId: string;
  productId: string;
  spaceId: string;
  destinationOrigin: string;
}): Promise<PendingHandoff> {
  const accountsOrigin = new URL(args.accountsOrigin).origin;
  const destinationOrigin = new URL(args.destinationOrigin).origin;
  const destinationKeyPair = await generateHandoffKeyPair();
  const publicKey = await exportHandoffPublicKey(destinationKeyPair.publicKey);
  const binding: HandoffBinding = {
    transactionId: randomToken(),
    accountId: args.accountId,
    clientId: args.clientId,
    productId: args.productId,
    spaceId: args.spaceId,
    destinationOrigin,
    state: randomToken(),
    nonce: randomToken(),
  };
  const brokerUrl = new URL("/security/key-handoff", accountsOrigin);
  for (const [name, value] of Object.entries(binding)) {
    brokerUrl.searchParams.set(name, value);
  }
  brokerUrl.searchParams.set(
    "publicKey",
    base64Url(new TextEncoder().encode(JSON.stringify(publicKey))),
  );
  return {
    binding,
    destinationKeyPair,
    destinationKeyFingerprint:
      await fingerprintHandoffPublicKey(publicKey),
    brokerUrl: brokerUrl.toString(),
  };
}

function hasBinding(value: unknown): value is HandoffBinding {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<HandoffBinding>;
  return [
    candidate.transactionId,
    candidate.accountId,
    candidate.clientId,
    candidate.productId,
    candidate.spaceId,
    candidate.destinationOrigin,
    candidate.state,
    candidate.nonce,
  ].every((item) => typeof item === "string" && item.length > 0);
}

export function parseSealedHandoff(value: unknown): SealedHandoff {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new Error("Invalid sealed handoff");
    }
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid sealed handoff");
  }
  const sealed = parsed as Partial<SealedHandoff>;
  const sender = sealed.senderPublicKey as Partial<JsonWebKey> | undefined;
  if (
    !hasBinding(sealed.binding) ||
    sender?.kty !== "EC" ||
    sender.crv !== "P-256" ||
    typeof sender.x !== "string" ||
    typeof sender.y !== "string" ||
    typeof sealed.destinationKeyFingerprint !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/u.test(sealed.destinationKeyFingerprint) ||
    typeof sealed.iv !== "string" ||
    sealed.iv.length !== 16 ||
    typeof sealed.ciphertext !== "string" ||
    sealed.ciphertext.length < 64 ||
    typeof sealed.expiresAt !== "string" ||
    !Number.isFinite(new Date(sealed.expiresAt).getTime())
  ) {
    throw new Error("Invalid sealed handoff");
  }
  return sealed as SealedHandoff;
}

export async function sealProductSpaceKey(
  productSpaceKey: Uint8Array,
  destinationPublicKey: JsonWebKey,
  binding: HandoffBinding,
  expiresAt: Date,
): Promise<SealedHandoff> {
  if (productSpaceKey.length !== 32) {
    throw new Error("ProductSpaceKey must be 256 bits");
  }
  if (expiresAt.getTime() <= Date.now()) throw new Error("Handoff already expired");

  const sender = await generateHandoffKeyPair();
  const destination = await importPublicKey(destinationPublicKey);
  const key = await deriveAesKey(sender.privateKey, destination, binding);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv as BufferSource,
      additionalData: aad(binding) as BufferSource,
      tagLength: 128,
    },
    key,
    productSpaceKey as BufferSource,
  );

  return {
    binding: { ...binding },
    senderPublicKey: await exportHandoffPublicKey(sender.publicKey),
    destinationKeyFingerprint:
      await fingerprintHandoffPublicKey(destinationPublicKey),
    iv: base64Url(iv),
    ciphertext: base64Url(new Uint8Array(ciphertext)),
    expiresAt: expiresAt.toISOString(),
  };
}

export interface ProductKeyHandoffBundle {
  productSpaceKey: Uint8Array;
  sharingPrivateKeyPkcs8?: Uint8Array;
  sharingPublicKeySpki?: Uint8Array;
}

type SerializedProductKeyHandoffBundle = {
  version: 1;
  productSpaceKey: string;
  sharingPrivateKeyPkcs8?: string;
  sharingPublicKeySpki?: string;
};

function serializeProductKeyBundle(bundle: ProductKeyHandoffBundle): Uint8Array {
  if (bundle.productSpaceKey.length !== 32) {
    throw new Error("ProductSpaceKey must be 256 bits");
  }
  const hasPrivate = bundle.sharingPrivateKeyPkcs8 !== undefined;
  const hasPublic = bundle.sharingPublicKeySpki !== undefined;
  if (hasPrivate !== hasPublic) {
    throw new Error("Sharing key handoff requires both key halves");
  }
  if (
    (bundle.sharingPrivateKeyPkcs8?.length ?? 0) > 8_192 ||
    (bundle.sharingPublicKeySpki?.length ?? 0) > 2_048
  ) {
    throw new Error("Sharing key handoff is too large");
  }
  const serialized: SerializedProductKeyHandoffBundle = {
    version: 1,
    productSpaceKey: base64Url(bundle.productSpaceKey),
    ...(bundle.sharingPrivateKeyPkcs8
      ? { sharingPrivateKeyPkcs8: base64Url(bundle.sharingPrivateKeyPkcs8) }
      : {}),
    ...(bundle.sharingPublicKeySpki
      ? { sharingPublicKeySpki: base64Url(bundle.sharingPublicKeySpki) }
      : {}),
  };
  return new TextEncoder().encode(JSON.stringify(serialized));
}

function parseProductKeyBundle(plaintext: Uint8Array): ProductKeyHandoffBundle {
  let value: Partial<SerializedProductKeyHandoffBundle>;
  try {
    value = JSON.parse(new TextDecoder().decode(plaintext)) as Partial<SerializedProductKeyHandoffBundle>;
  } catch {
    throw new Error("Invalid product key handoff bundle");
  }
  if (
    value.version !== 1 ||
    typeof value.productSpaceKey !== "string" ||
    (value.sharingPrivateKeyPkcs8 === undefined) !==
      (value.sharingPublicKeySpki === undefined)
  ) {
    throw new Error("Invalid product key handoff bundle");
  }
  const productSpaceKey = fromBase64Url(value.productSpaceKey);
  if (productSpaceKey.length !== 32) {
    throw new Error("ProductSpaceKey must be 256 bits");
  }
  return {
    productSpaceKey,
    ...(typeof value.sharingPrivateKeyPkcs8 === "string"
      ? { sharingPrivateKeyPkcs8: fromBase64Url(value.sharingPrivateKeyPkcs8) }
      : {}),
    ...(typeof value.sharingPublicKeySpki === "string"
      ? { sharingPublicKeySpki: fromBase64Url(value.sharingPublicKeySpki) }
      : {}),
  };
}

async function sealHandoffPayload(
  plaintext: Uint8Array,
  destinationPublicKey: JsonWebKey,
  binding: HandoffBinding,
  expiresAt: Date,
): Promise<SealedHandoff> {
  if (expiresAt.getTime() <= Date.now()) throw new Error("Handoff already expired");
  const sender = await generateHandoffKeyPair();
  const destination = await importPublicKey(destinationPublicKey);
  const key = await deriveAesKey(sender.privateKey, destination, binding);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv as BufferSource,
      additionalData: aad(binding) as BufferSource,
      tagLength: 128,
    },
    key,
    plaintext as BufferSource,
  );
  return {
    binding: { ...binding },
    senderPublicKey: await exportHandoffPublicKey(sender.publicKey),
    destinationKeyFingerprint: await fingerprintHandoffPublicKey(destinationPublicKey),
    iv: base64Url(iv),
    ciphertext: base64Url(new Uint8Array(ciphertext)),
    expiresAt: expiresAt.toISOString(),
  };
}

async function consumeHandoffPayload(
  sealed: SealedHandoff,
  destinationPrivateKey: CryptoKey,
  expected: HandoffBinding,
  store: HandoffStore,
  now = new Date(),
): Promise<Uint8Array> {
  if (
    JSON.stringify(sealed.binding) !== JSON.stringify(expected) ||
    new Date(sealed.expiresAt).getTime() <= now.getTime()
  ) {
    throw new Error("Handoff binding mismatch or expiry");
  }
  if (!(await store.consume(expected.transactionId, now))) {
    throw new Error("Handoff already consumed");
  }
  const senderPublic = await importPublicKey(sealed.senderPublicKey);
  const key = await deriveAesKey(destinationPrivateKey, senderPublic, expected);
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: fromBase64Url(sealed.iv) as BufferSource,
          additionalData: aad(expected) as BufferSource,
          tagLength: 128,
        },
        key,
        fromBase64Url(sealed.ciphertext) as BufferSource,
      ),
    );
  } catch (error) {
    throw new Error("Handoff decryption failed", { cause: error });
  }
}

export async function sealProductKeyBundle(
  bundle: ProductKeyHandoffBundle,
  destinationPublicKey: JsonWebKey,
  binding: HandoffBinding,
  expiresAt: Date,
): Promise<SealedHandoff> {
  return sealHandoffPayload(
    serializeProductKeyBundle(bundle),
    destinationPublicKey,
    binding,
    expiresAt,
  );
}

export async function consumeProductKeyBundle(
  sealed: SealedHandoff,
  destinationPrivateKey: CryptoKey,
  expected: HandoffBinding,
  store: HandoffStore,
  now = new Date(),
): Promise<ProductKeyHandoffBundle> {
  return parseProductKeyBundle(
    await consumeHandoffPayload(sealed, destinationPrivateKey, expected, store, now),
  );
}

export async function consumeProductSpaceKey(
  sealed: SealedHandoff,
  destinationPrivateKey: CryptoKey,
  expected: HandoffBinding,
  store: HandoffStore,
  now = new Date(),
): Promise<Uint8Array> {
  if (
    JSON.stringify(sealed.binding) !== JSON.stringify(expected) ||
    new Date(sealed.expiresAt).getTime() <= now.getTime()
  ) {
    throw new Error("Handoff binding mismatch or expiry");
  }
  if (!(await store.consume(expected.transactionId, now))) {
    throw new Error("Handoff already consumed");
  }

  const senderPublic = await importPublicKey(sealed.senderPublicKey);
  const key = await deriveAesKey(destinationPrivateKey, senderPublic, expected);
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: fromBase64Url(sealed.iv) as BufferSource,
          additionalData: aad(expected) as BufferSource,
          tagLength: 128,
        },
        key,
        fromBase64Url(sealed.ciphertext) as BufferSource,
      ),
    );
  } catch (error) {
    throw new Error("Handoff decryption failed", { cause: error });
  }
}
