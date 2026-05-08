import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * HMAC-SHA256 hex-digest verify. Constant-time. Safe for malformed input —
 * never throws; returns false instead.
 */
export function verifyHmac(
  body: string,
  signatureHex: string | null,
  secret: string | undefined
): boolean {
  if (!signatureHex || !secret) return false;

  const expectedHex = createHmac("sha256", secret).update(body).digest("hex");
  if (signatureHex.length !== expectedHex.length) return false;

  let received: Buffer;
  try {
    received = Buffer.from(signatureHex, "hex");
  } catch {
    return false;
  }
  // Buffer.from with non-hex chars produces a shorter buffer rather than
  // throwing — guard against that explicitly.
  if (received.length * 2 !== expectedHex.length) return false;

  const expected = Buffer.from(expectedHex, "hex");
  return timingSafeEqual(received, expected);
}
