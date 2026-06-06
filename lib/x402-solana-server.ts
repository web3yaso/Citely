import { X402PaymentHandler } from "x402-solana/server";
import { findRecord } from "./attestation-index";

export const SOL_NETWORK = "solana-devnet";
export const SOL_USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
export const SOL_USDC_DECIMALS = 6;

/** Devnet recipient (treasury). USDC-SPL is 6-decimal, matching the index priceUSDC units. */
export function solPayTo(): string {
  const a = process.env.SOL_PAYTO;
  if (!a) throw new Error("SOL_PAYTO not set");
  return a;
}

/** Reuse the on-chain price (atomic micro-USDC string) from the attestation index. */
export function solPriceForSlug(slug: string): string {
  const rec = findRecord(slug);
  if (!rec) throw new Error(`no published record for ${slug}`);
  return rec.priceUSDC;
}

let _handler: X402PaymentHandler | null = null;
export function getSolHandler(): X402PaymentHandler {
  if (!_handler) {
    _handler = new X402PaymentHandler({
      network: SOL_NETWORK,
      treasuryAddress: solPayTo(),
      facilitatorUrl: process.env.PAYAI_FACILITATOR_URL ?? "https://facilitator.payai.network",
      apiKeyId: process.env.PAYAI_API_KEY_ID,
      apiKeySecret: process.env.PAYAI_API_KEY_SECRET,
      rpcUrl: process.env.SOLANA_DEVNET_RPC,
    });
  }
  return _handler;
}
