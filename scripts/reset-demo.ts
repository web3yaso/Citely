/**
 * Reset the demo to a clean pre-recording state (store-backed: file or Redis):
 *   - removes the /publish import-example article (onchain-partnership-rwa) from the
 *     attestation index, so the live /publish → Sign+Attest demo re-adds it
 *     (addIndexRecord is first-write-wins, so a stale entry would block re-publishing);
 *   - clears the payment log, so EARNED starts at $0 and visibly rises during the demo.
 *
 * Keeps the seed articles (姚前案 / 违法用工) and ALL content files (.mdx/.enc/companions).
 * Re-runnable after each demo run.
 *
 *   node_modules/.bin/tsx scripts/reset-demo.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getStore } from "../lib/store";

// Minimal .env.local loader (no dependency) — needed so getStore() can see Redis env.
function loadEnvLocal(): void {
  try {
    const txt = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of txt.split("\n")) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* rely on process.env */ }
}
loadEnvLocal();

const DAO = "onchain-partnership-rwa";

async function main() {
  const store = getStore();
  const kept = (await store.getIndex()).filter((r) => r.slug !== DAO);
  await store.reset(kept);
  await store.clearPayments();
  console.log(`reset-demo: dropped '${DAO}' (kept ${kept.length}); payment-log cleared.`);
}

main();
