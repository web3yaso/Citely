/**
 * entitlement.ts
 *
 * Server-side "has this wallet paid for this article?" check (issue #12). A
 * returning reader signs a short message; the server recovers the address and
 * matches it against the payment log. Replaces the browser localStorage cache —
 * no full text is persisted client-side.
 */

import { readPaymentLog } from "./payment-log";

const SLUG_PREFIX = "文章: ";
const TIME_PREFIX = "时间: ";

/** The exact text the wallet signs. issuedAt is epoch ms; stored as ISO. */
export function buildEntitlementMessage(
  slug: string,
  address: string,
  issuedAt: number,
  nonce: string,
): string {
  return [
    "Citely 阅读验证",
    `${SLUG_PREFIX}${slug}`,
    `地址: ${address}`,
    `${TIME_PREFIX}${new Date(issuedAt).toISOString()}`,
    `nonce: ${nonce}`,
  ].join("\n");
}

/** Read back slug + issuedAt (ms) from a signed message; null if malformed. */
export function parseEntitlementMessage(message: string): { slug: string; issuedAt: number } | null {
  const lines = message.split("\n");
  const slugLine = lines.find((l) => l.startsWith(SLUG_PREFIX));
  const timeLine = lines.find((l) => l.startsWith(TIME_PREFIX));
  if (!slugLine || !timeLine) return null;
  const slug = slugLine.slice(SLUG_PREFIX.length).trim();
  const issuedAt = Date.parse(timeLine.slice(TIME_PREFIX.length).trim());
  if (!slug || Number.isNaN(issuedAt)) return null;
  return { slug, issuedAt };
}

/** True if `address` appears as the payer for `slug` in the payment log. */
export async function hasPaidFor(slug: string, address: string): Promise<boolean> {
  const addr = address.toLowerCase();
  const log = await readPaymentLog();
  return log.some((e) => e.slug === slug && e.payer.toLowerCase() === addr);
}
