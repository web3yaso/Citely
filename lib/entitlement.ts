/**
 * entitlement.ts
 *
 * Server-side "has this wallet paid for this article?" check (issue #12). A
 * returning reader signs a short message; the server recovers the address and
 * matches it against the payment log. Replaces the browser localStorage cache —
 * no full text is persisted client-side.
 */

import { recoverMessageAddress } from "viem";
import { readPaymentLog } from "./payment-log";
import { parseEntitlementMessage } from "./entitlement-message";

// Re-export the client-safe message helpers so existing server/test imports of
// `buildEntitlementMessage` / `parseEntitlementMessage` from "./entitlement" keep
// working. The client (UnlockGate) imports them from "./entitlement-message"
// directly to avoid pulling this module's payment-log/node:fs chain into the bundle.
export { buildEntitlementMessage, parseEntitlementMessage } from "./entitlement-message";

export type EntitlementFailureReason = "bad_signature" | "slug_mismatch" | "expired" | "not_paid";

export type EntitlementResult =
  | { ok: true; address: string }
  | { ok: false; reason: EntitlementFailureReason };

const MAX_AGE_MS = 5 * 60 * 1000;
const FUTURE_SKEW_MS = 60 * 1000;

/** True if `address` appears as the payer for `slug` in the payment log. */
export async function hasPaidFor(slug: string, address: string): Promise<boolean> {
  const addr = address.toLowerCase();
  const log = await readPaymentLog();
  return log.some((e) => e.slug === slug && e.payer.toLowerCase() === addr);
}

/**
 * Verify a signed entitlement request: recover the signer, confirm the message
 * targets this slug and is recent (≤5min, small future skew allowed), then check
 * the payment log. Replay window is bounded by the timestamp; a server-issued
 * nonce store is intentionally out of scope (see spec).
 */
export async function verifyEntitlement(input: {
  slug: string;
  message: string;
  signature: `0x${string}`;
}): Promise<EntitlementResult> {
  let recovered: string;
  try {
    recovered = (await recoverMessageAddress({ message: input.message, signature: input.signature })).toLowerCase();
  } catch {
    return { ok: false, reason: "bad_signature" };
  }
  const parsed = parseEntitlementMessage(input.message);
  if (!parsed) return { ok: false, reason: "bad_signature" }; // signed, but not a Citely entitlement message
  if (parsed.slug !== input.slug) return { ok: false, reason: "slug_mismatch" };
  const age = Date.now() - parsed.issuedAt;
  if (age > MAX_AGE_MS || age < -FUTURE_SKEW_MS) return { ok: false, reason: "expired" };
  if (!(await hasPaidFor(input.slug, recovered))) return { ok: false, reason: "not_paid" };
  return { ok: true, address: recovered };
}
