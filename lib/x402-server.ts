import { x402ResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { createFacilitatorConfig } from "@coinbase/x402";
import { findRecord } from "./attestation-index";

// ⚠️ DEMO BRANCH ONLY — Base mainnet (real USDC). dev/main stay on Base Sepolia
// (eip155:84532). Switched to mainnet because Cobo Agentic Wallet's x402 settlement
// has no testnet support (see issue #3). EAS provenance still reads Base Sepolia via
// BASE_SEPOLIA_RPC_URL — unaffected. Keep the X402_NETWORK env var UNSET on the demo
// deployment so this constant is authoritative.
export const X402_NETWORK = "eip155:8453";

// No env cross-check on the demo branch: this constant is the single source of truth
// for the paywall network. The X402_NETWORK env var has no effect on payment routing
// (only this file's constant does), so a leftover eip155:84532 in a shared .env.local
// must not break the mainnet demo build.

let _server: x402ResourceServer | null = null;
export function getX402Server(): x402ResourceServer {
  if (!_server) {
    const facilitator = new HTTPFacilitatorClient(
      createFacilitatorConfig(process.env.CDP_API_KEY_ID, process.env.CDP_API_KEY_SECRET),
    );
    _server = new x402ResourceServer(facilitator).register(X402_NETWORK, new ExactEvmScheme());
  }
  return _server;
}

export function slugFromPath(path: string): string {
  return path.replace(/\/+$/, "").split("/").pop() ?? "";
}

export function payToForSlug(slug: string): string {
  const rec = findRecord(slug);
  if (!rec) throw new Error(`no published record for ${slug}`);
  return rec.author;
}

export function priceUsdForSlug(slug: string): string {
  const rec = findRecord(slug);
  if (!rec) throw new Error(`no published record for ${slug}`);
  return "$" + (Number(BigInt(rec.priceUSDC)) / 1e6).toFixed(2);
}
