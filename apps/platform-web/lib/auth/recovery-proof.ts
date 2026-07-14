import crypto from "node:crypto";

const RECOVERY_TOKEN_TTL_MS = 10 * 60 * 1000;
const RECOVERY_SECRET =
  process.env.BETTER_AUTH_SECRET || "changeme";

interface RecoveryTokenPayload {
  userId: string;
  challengeHash: string;
  exp: number;
}

function toBase64Url(input: Buffer | string) {
  return Buffer.from(input).toString("base64url");
}

function fromBase64Url(input: string) {
  return Buffer.from(input, "base64url");
}

function signTokenPayload(payload: string) {
  return crypto
    .createHmac("sha256", RECOVERY_SECRET)
    .update(payload)
    .digest("base64url");
}

export function hashRecoveryProof(proofB64: string) {
  return crypto.createHash("sha256").update(proofB64, "utf8").digest("hex");
}

export function issueRecoveryToken(input: {
  userId: string;
  challengeHash: string;
}) {
  const payload: RecoveryTokenPayload = {
    userId: input.userId,
    challengeHash: input.challengeHash,
    exp: Date.now() + RECOVERY_TOKEN_TTL_MS,
  };

  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signature = signTokenPayload(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export function verifyRecoveryToken(token: string): RecoveryTokenPayload | null {
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = signTokenPayload(encodedPayload);
  const provided = Buffer.from(signature, "utf8");
  const expected = Buffer.from(expectedSignature, "utf8");

  if (
    provided.length !== expected.length ||
    !crypto.timingSafeEqual(provided, expected)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(
      fromBase64Url(encodedPayload).toString("utf8"),
    ) as RecoveryTokenPayload;

    if (!payload.userId || !payload.challengeHash || !payload.exp) {
      return null;
    }

    if (Date.now() > payload.exp) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}
