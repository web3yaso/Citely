/**
 * x402-payer.ts
 *
 * Recover the real paying wallet from the `X-PAYMENT` request header. The header
 * is base64(JSON) of the x402 PaymentPayload; for the exact-EVM scheme the payer
 * is `payload.authorization.from`. The handler runs AFTER x402 verified the
 * payment, so this address is trustworthy. Returns a lowercased 0x address, or
 * null when the header is absent/unparseable.
 */
export function payerFromXPayment(req: Request): string | null {
  const header = req.headers.get("X-PAYMENT");
  if (!header) return null;
  try {
    const decoded = JSON.parse(b64ToUtf8(header));
    const from = decoded?.payload?.authorization?.from;
    if (typeof from === "string" && /^0x[0-9a-fA-F]{40}$/.test(from)) {
      return from.toLowerCase();
    }
    return null;
  } catch {
    return null;
  }
}

/** Isomorphic base64 → utf-8 (mirrors lib/x402-errors.ts; `atob` in browsers, Buffer on Node). */
function b64ToUtf8(b64: string): string {
  if (typeof atob === "function") {
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
  return Buffer.from(b64, "base64").toString("utf8");
}
