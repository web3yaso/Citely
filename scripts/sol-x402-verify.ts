/**
 * E2E: pay the Solana x402 endpoint with a funded throwaway keypair.
 *   pnpm sol:verify <slug>            (default slug: yaoqian-crypto-liability)
 * Requires: a running app (pnpm dev), SOL_TEST_PAYER_SECRET (base58) funded with
 * devnet SOL + devnet USDC-SPL, SOLANA_DEVNET_RPC.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { createX402Client } from "x402-solana/client";

function loadEnvLocal(): void {
  try {
    const txt = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of txt.split("\n")) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
}
loadEnvLocal();

const slug = process.argv[2] ?? "yaoqian-crypto-liability";
const base = process.env.SOL_VERIFY_BASE ?? "http://localhost:3000";
const url = `${base}/api/v1/sol/articles/${slug}`;

const secret = process.env.SOL_TEST_PAYER_SECRET;
if (!secret) throw new Error("SOL_TEST_PAYER_SECRET not set (base58)");
const kp = Keypair.fromSecretKey(bs58.decode(secret));

const wallet = {
  publicKey: kp.publicKey,
  signTransaction: async (tx: any) => {
    if (typeof tx.partialSign === "function") tx.partialSign(kp);
    else tx.sign([kp]);
    return tx;
  },
};

async function main() {
  console.log(`payer ${kp.publicKey.toBase58()} paying ${url} ...`);
  const client = createX402Client({
    wallet,
    network: "solana-devnet",
    rpcUrl: process.env.SOLANA_DEVNET_RPC ?? "https://api.devnet.solana.com",
  });
  const res = await client.fetch(url);
  console.log("final status:", res.status);
  if (res.status !== 200) {
    console.error("body:", await res.text());
    throw new Error(`expected 200, got ${res.status}`);
  }
  const body = await res.json();
  console.log("OK — title:", body.title, "| content chars:", body.content?.length, "| author:", body.citation?.author);
}
main();
