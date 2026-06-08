import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getStore } from "../lib/store";

function loadEnvLocal() {
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
  const seeds = JSON.parse(readFileSync(resolve(process.cwd(), "data/attestation-index.json"), "utf8"));
  const store = getStore();
  await store.reset(seeds);
  await store.clearPayments();
  console.log(`seed-kv: wrote ${seeds.length} records to`, process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL ? "Redis" : "file");
}
main();
