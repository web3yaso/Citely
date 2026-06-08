/**
 * One-time Solana setup: create the USDC-SPL Associated Token Account (ATA) for
 * SOL_PAYTO. A Solana recipient cannot receive an SPL token until its ATA for that
 * mint exists, so the x402 payment fails ("Destination does not have an Associated
 * Token Account") until this is run once per payTo.
 *
 *   pnpm tsx scripts/sol-create-payto-ata.ts
 *
 * Requires SOL_PAYTO + a funded SOL_TEST_PAYER_SECRET (pays the ~0.002 SOL rent;
 * ATA creation is permissionless — the payTo owner does not need to sign).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import bs58 from "bs58";
import { SOL_USDC_MINT } from "../lib/x402-solana-server";

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

async function main() {
  const payToStr = process.env.SOL_PAYTO;
  const secret = process.env.SOL_TEST_PAYER_SECRET;
  if (!payToStr) throw new Error("SOL_PAYTO not set");
  if (!secret) throw new Error("SOL_TEST_PAYER_SECRET not set (pays the ATA rent)");

  const connection = new Connection(process.env.SOLANA_DEVNET_RPC ?? "https://api.devnet.solana.com", "confirmed");
  const payer = Keypair.fromSecretKey(bs58.decode(secret));
  const ata = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    new PublicKey(SOL_USDC_MINT),
    new PublicKey(payToStr),
  );
  console.log(`payTo ${payToStr} USDC ATA: ${ata.address.toBase58()} (balance ${ata.amount.toString()})`);
}
main();
