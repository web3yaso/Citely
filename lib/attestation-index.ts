import { isAddress } from "viem";
import { getStore } from "./store";

const SLUG_RE = /^[a-z0-9-]{1,80}$/;
const HEX32 = /^0x[0-9a-fA-F]{64}$/;
const PRICE_MIN = 50000n; // $0.05 * 1e6
const PRICE_MAX = 50000000n; // $50 * 1e6

export type AttestationRecord = {
  slug: string;
  attestationUID: string;
  txHash: string;
  author: string;
  priceUSDC: string;
  publishedAt: number;
  version: number;
  disclaimerHash: string;
};

export function validateAttestationInput(x: AttestationRecord): void {
  if (!SLUG_RE.test(x.slug)) throw new Error("invalid slug");
  if (!HEX32.test(x.attestationUID)) throw new Error("invalid attestationUID");
  if (!HEX32.test(x.txHash)) throw new Error("invalid txHash");
  if (!isAddress(x.author)) throw new Error("invalid author address");
  let price: bigint;
  try { price = BigInt(x.priceUSDC); } catch { throw new Error("invalid priceUSDC"); }
  if (price < PRICE_MIN || price > PRICE_MAX) throw new Error("price out of range");
  if (x.version !== 1) throw new Error("version must be 1");
  if (!Number.isInteger(x.publishedAt) || x.publishedAt <= 0) throw new Error("invalid publishedAt");
  if (x.publishedAt > Math.floor(Date.now() / 1000)) throw new Error("publishedAt in the future");
  if (!HEX32.test(x.disclaimerHash)) throw new Error("invalid disclaimerHash");
}

export async function readIndex(): Promise<AttestationRecord[]> {
  return getStore().getIndex();
}

export async function hasSlug(slug: string): Promise<boolean> {
  return (await readIndex()).some((r) => r.slug === slug);
}

export async function findRecord(slug: string): Promise<AttestationRecord | undefined> {
  return (await readIndex()).find((r) => r.slug === slug);
}

/**
 * First-write-wins: a slug can only be claimed once. This prevents an attacker
 * from re-attesting an existing slug as themselves and REPLACING the record
 * (authorship/payout hijack). Re-publishing requires manually clearing the entry.
 * The store enforces first-write-wins (throws on duplicate slug).
 */
export async function appendIndex(rec: AttestationRecord): Promise<void> {
  await getStore().addIndexRecord(rec);
}
