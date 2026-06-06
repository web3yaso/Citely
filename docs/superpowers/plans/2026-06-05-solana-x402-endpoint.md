# Solana devnet x402 Paid-Unlock Endpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A parallel Solana devnet x402 paid-unlock endpoint `/api/v1/sol/articles/<slug>` that returns 402 with Solana payment requirements, verifies+settles USDC-SPL via the PayAI facilitator, and returns the same body as the Base endpoint — verified end-to-end with a funded throwaway Solana keypair.

**Architecture:** A new route reuses Citely's content layer and delegates payment to `x402-solana`'s `X402PaymentHandler` (PayAI facilitator). The existing Base route is untouched. payTo comes from `SOL_PAYTO`, price reuses the per-slug `priceUSDC` from the attestation index (both 6-decimal atomic units).

**Tech Stack:** TypeScript, Next.js route handlers, `x402-solana` (PayAI), `@solana/web3.js`, Vitest. Branch `sol-dev`.

**Spec:** `docs/superpowers/specs/2026-06-05-solana-x402-endpoint-design.md`

---

## File Structure

- Create `lib/x402-solana-server.ts` — Solana lane config: constants, `solPayTo()`, `solPriceForSlug()`, `getSolHandler()`.
- Create `lib/x402-solana-server.test.ts` — unit tests for the pure helpers.
- Create `lib/paid-article.ts` — `getPaidArticleBody(slug)`, the shared 200 body (same shape as the Base route).
- Create `lib/paid-article.test.ts` — shape test (env-loaded, decryption works).
- Create `app/api/v1/sol/articles/[slug]/route.ts` — the Solana paid-unlock GET handler.
- Create `scripts/sol-x402-verify.ts` — e2e payer (funded keypair → pays the endpoint → asserts 402→200).
- Modify `package.json` — add deps + `sol:verify` script.
- `.env.local.example` / `.env.local` — already carry `SOL_PAYTO`, `SOLANA_DEVNET_RPC`, `SOL_TEST_PAYER_SECRET` (done in commit `50b3666`; `SOL_PAYTO` already set locally).

Notes for the implementer:
- pnpm only. Never stage `data/*.json` (runtime-dirty) — they are unrelated.
- Use seeded slugs present in the index for tests: `yaoqian-crypto-liability` ($0.30 → `priceUSDC` "300000") and `web3-illegal-employment` ($0.25 → "250000"). Do NOT use `onchain-partnership-rwa` (removed from the index).
- The exact `x402-solana` server API used below is from its README; if a signature differs, the installed types are at `node_modules/x402-solana/dist/**/*.d.ts` — check there.

---

### Task 1: Dependencies + script

**Files:** Modify `package.json`

- [ ] **Step 1: Install deps**

Run:
```bash
pnpm add x402-solana @solana/web3.js bs58
```
Expected: all three in `dependencies`.

- [ ] **Step 2: Add the e2e verify script**

In `package.json` `"scripts"`, after `"ingest"`, add:
```json
"sol:verify": "tsx scripts/sol-x402-verify.ts",
```

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "build: add x402-solana + @solana/web3.js for Solana lane"
```

---

### Task 2: `lib/x402-solana-server.ts` — config + pure helpers (TDD)

**Files:**
- Create `lib/x402-solana-server.ts`
- Test `lib/x402-solana-server.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/x402-solana-server.test.ts`:
```ts
import { describe, it, expect, afterEach } from "vitest";
import { solPriceForSlug, solPayTo, SOL_NETWORK, SOL_USDC_MINT } from "./x402-solana-server";

describe("solPriceForSlug", () => {
  it("returns the index priceUSDC (atomic units) for a seeded slug", () => {
    expect(solPriceForSlug("yaoqian-crypto-liability")).toBe("300000");
    expect(solPriceForSlug("web3-illegal-employment")).toBe("250000");
  });
  it("throws for an unknown slug", () => {
    expect(() => solPriceForSlug("nope")).toThrow(/no published record/i);
  });
});

describe("solPayTo", () => {
  const saved = process.env.SOL_PAYTO;
  afterEach(() => { process.env.SOL_PAYTO = saved; });
  it("returns the configured devnet address", () => {
    process.env.SOL_PAYTO = "6bMe95k9itoYTvef4mE9rCDw1K11BgzMmZxgvjjkoH9s";
    expect(solPayTo()).toBe("6bMe95k9itoYTvef4mE9rCDw1K11BgzMmZxgvjjkoH9s");
  });
  it("throws when SOL_PAYTO is unset", () => {
    delete process.env.SOL_PAYTO;
    expect(() => solPayTo()).toThrow(/SOL_PAYTO/);
  });
});

describe("constants", () => {
  it("targets solana-devnet + devnet USDC-SPL mint", () => {
    expect(SOL_NETWORK).toBe("solana-devnet");
    expect(SOL_USDC_MINT).toBe("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
  });
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `pnpm test lib/x402-solana-server.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `lib/x402-solana-server.ts`:
```ts
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
    });
  }
  return _handler;
}
```

- [ ] **Step 4: Run, verify it passes**

Run: `pnpm test lib/x402-solana-server.test.ts`
Expected: PASS (5 tests). `getSolHandler` is exercised by the route + e2e, not unit-tested (it constructs a network client).

- [ ] **Step 5: Type-check**

Run: `pnpm build`
Expected: `✓ Compiled successfully` / `Finished TypeScript`. If `x402-solana/server` lacks types, check `node_modules/x402-solana/dist/**/*.d.ts` for the correct subpath/exports and adjust the import.

- [ ] **Step 6: Commit**

```bash
git add lib/x402-solana-server.ts lib/x402-solana-server.test.ts
git commit -m "feat: Solana x402 server config (payTo, price, PayAI handler)"
```

---

### Task 3: `lib/paid-article.ts` — shared 200 body (TDD)

**Files:**
- Create `lib/paid-article.ts`
- Test `lib/paid-article.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/paid-article.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { getPaidArticleBody } from "./paid-article";

describe("getPaidArticleBody", () => {
  it("returns slug/title/content/companion/citation for a seeded slug", () => {
    const b = getPaidArticleBody("yaoqian-crypto-liability");
    expect(b.slug).toBe("yaoqian-crypto-liability");
    expect(typeof b.title).toBe("string");
    expect(b.content.length).toBeGreaterThan(100);
    expect(b.companion.length).toBeGreaterThan(0);
    expect(b.citation.author).toBeTruthy();
    expect(b.citation.attestationUID).toMatch(/^0x[0-9a-f]+$/i);
    expect(b.citation.publishedAt).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `pnpm test lib/paid-article.test.ts`
Expected: FAIL — module not found. (CONTENT_ENC_KEY is loaded by `vitest.setup.ts`, so decryption works once the module exists.)

- [ ] **Step 3: Implement** (mirrors the Base route's 200 body, `app/api/v1/articles/[slug]/route.ts:37-48`)

Create `lib/paid-article.ts`:
```ts
import { getReportBody, getReportMeta } from "./reports";
import { getCompanionPaidZone } from "./companions";
import { findRecord } from "./attestation-index";

export type PaidArticleBody = {
  slug: string;
  title: string;
  content: string;
  companion: string;
  citation: { author: string; attestationUID: string; publishedAt: string };
};

/** The shared paid 200 body — identical shape on both the Base and Solana lanes. */
export function getPaidArticleBody(slug: string): PaidArticleBody {
  const meta = getReportMeta(slug);
  const rec = findRecord(slug);
  if (!rec) throw new Error(`no published record for ${slug}`);
  return {
    slug,
    title: meta.title,
    content: getReportBody(slug),
    companion: getCompanionPaidZone(slug),
    citation: { author: meta.authorName, attestationUID: rec.attestationUID, publishedAt: meta.publishedAt },
  };
}
```

- [ ] **Step 4: Run, verify it passes**

Run: `pnpm test lib/paid-article.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/paid-article.ts lib/paid-article.test.ts
git commit -m "feat: shared getPaidArticleBody for paid lanes"
```

---

### Task 4: `app/api/v1/sol/articles/[slug]/route.ts` — the endpoint

**Files:** Create `app/api/v1/sol/articles/[slug]/route.ts`

This is orchestration over network-bound calls; verified by type-check + the e2e script (Task 6), not a unit test.

- [ ] **Step 1: Write the route**

Create `app/api/v1/sol/articles/[slug]/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import {
  getSolHandler,
  solPriceForSlug,
  SOL_USDC_MINT,
  SOL_USDC_DECIMALS,
} from "@/lib/x402-solana-server";
import { getPaidArticleBody } from "@/lib/paid-article";
import { findRecord } from "@/lib/attestation-index";

const SLUG_RE = /^[a-z0-9-]{1,80}$/;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  // slug whitelist BEFORE the paywall — invalid/unpublished → 404, never a 402.
  if (!SLUG_RE.test(slug) || !findRecord(slug)) {
    return NextResponse.json({ error: "not found" }, { status: 404, headers: CORS });
  }

  const x402 = getSolHandler();
  const resourceUrl = new URL(req.url).toString();
  const requirements = await x402.createPaymentRequirements(
    {
      amount: solPriceForSlug(slug),
      asset: { address: SOL_USDC_MINT, decimals: SOL_USDC_DECIMALS },
      description: `Citely — paid article (Solana): ${slug}`,
    },
    resourceUrl,
  );

  const paymentHeader = x402.extractPayment(req.headers);
  if (!paymentHeader) {
    const r = x402.create402Response(requirements, resourceUrl);
    return NextResponse.json(r.body, { status: r.status, headers: CORS });
  }

  const verified = await x402.verifyPayment(paymentHeader, requirements);
  if (!verified.isValid) {
    return NextResponse.json(
      { error: "invalid payment", reason: verified.invalidReason },
      { status: 402, headers: CORS },
    );
  }

  await x402.settlePayment(paymentHeader, requirements);
  return NextResponse.json(getPaidArticleBody(slug), { headers: CORS });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export const dynamic = "force-dynamic";
```

- [ ] **Step 2: Type-check**

Run: `pnpm build`
Expected: `✓ Compiled successfully`, and the route appears as `/api/v1/sol/articles/[slug]` in the route list. If `createPaymentRequirements` / `create402Response` / `verifyPayment` / `extractPayment` signatures differ from the README, reconcile against `node_modules/x402-solana/dist/**/*.d.ts` and adjust.

- [ ] **Step 3: Commit**

```bash
git add app/api/v1/sol/articles/
git commit -m "feat: Solana devnet x402 paid-unlock endpoint /api/v1/sol/articles/[slug]"
```

---

### Task 5: `scripts/sol-x402-verify.ts` — e2e payer

**Files:** Create `scripts/sol-x402-verify.ts`

Pays the running endpoint with a funded throwaway keypair and asserts `402 → pay → 200`. `x402-solana/client`'s `createX402Client` takes a wallet adapter (not a raw keypair), so wrap the keypair.

- [ ] **Step 1: Confirm the client signature**

Read `node_modules/x402-solana/dist/**/*.d.ts` (or `client.d.ts`) for the exact `createX402Client` config and the adapter interface (the method it calls to sign — `signTransaction(tx)` per the README). Note the exact wrapped fetch / pay call it returns.

- [ ] **Step 2: Write the script** (adjust the adapter/call to match Step 1's findings)

Create `scripts/sol-x402-verify.ts`:
```ts
/**
 * E2E: pay the Solana x402 endpoint with a funded throwaway keypair.
 *   pnpm sol:verify <slug>            (default slug: yaoqian-crypto-liability)
 * Requires: a running app (pnpm dev), SOL_TEST_PAYER_SECRET (base58) funded with
 * devnet SOL + devnet USDC-SPL, SOLANA_DEVNET_RPC.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Keypair, Connection } from "@solana/web3.js";
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
const connection = new Connection(process.env.SOLANA_DEVNET_RPC ?? "https://api.devnet.solana.com", "confirmed");

// Wrap the keypair as the wallet adapter createX402Client expects (signTransaction).
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
  const client = createX402Client({ wallet, connection });
  const res = await client.fetch(url); // wrapped fetch: 402 → pay → retry → 200
  console.log("final status:", res.status);
  if (res.status !== 200) {
    console.error("body:", await res.text());
    throw new Error(`expected 200, got ${res.status}`);
  }
  const body = await res.json();
  console.log("OK — title:", body.title, "| content chars:", body.content?.length, "| author:", body.citation?.author);
}
main();
```

- [ ] **Step 3: Type-check**

Run: `pnpm build` (the script is checked by tsc).
Expected: no type errors in this file. Reconcile the `createX402Client({...})` config and `client.fetch` against the types from Step 1 if needed.

- [ ] **Step 4: Commit**

```bash
git add scripts/sol-x402-verify.ts
git commit -m "test: e2e Solana x402 payer script (sol:verify)"
```

---

### Task 6: Run the real devnet e2e verification

**Files:** none (runtime verification). Requires `SOL_TEST_PAYER_SECRET` funded on devnet.

- [ ] **Step 1: Create + fund a throwaway payer (if not already)**

```bash
# generate a keypair, print base58 secret for .env.local
pnpm tsx -e "import {Keypair} from '@solana/web3.js'; import bs58 from 'bs58'; const k=Keypair.generate(); console.log('PUBKEY', k.publicKey.toBase58()); console.log('SECRET', bs58.encode(k.secretKey));"
```
Put the SECRET into `.env.local` as `SOL_TEST_PAYER_SECRET=` (do NOT commit). Then fund the PUBKEY on devnet:
- devnet SOL (gas): `solana airdrop 1 <PUBKEY> --url devnet` (or https://faucet.solana.com).
- devnet USDC-SPL: mint/transfer the devnet USDC `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` to `<PUBKEY>` (e.g. a Circle/SPL devnet faucet) — at least the article price ($0.30).

- [ ] **Step 2: Start the app**

Run: `pnpm dev` (separate shell). Confirm the endpoint is reachable:
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/v1/sol/articles/yaoqian-crypto-liability
```
Expected: `402` (payment required — the Solana requirements path works).

- [ ] **Step 3: Run the payer**

Run: `pnpm sol:verify yaoqian-crypto-liability`
Expected: prints `final status: 200` and `OK — title: …`, proving `402 → pay → 200` settled on devnet via PayAI. Confirm the USDC-SPL transfer to `SOL_PAYTO` on a devnet explorer (e.g. solscan devnet).

- [ ] **Step 4: Record the result**

No commit. Note the settlement signature / explorer link in the PR or issue. If settlement fails, capture the facilitator error from the 402 reason and the `sol:verify` output for debugging.

---

## Self-Review notes

- **Spec coverage:** separate route (Task 4), PayAI facilitator + solana-devnet + USDC-SPL (Task 2/4), payTo from SOL_PAYTO (Task 2), price reused from index (Task 2), shared 200 body (Task 3), unit tests for pure logic (Task 2/3), 402-shape via curl (Task 6 Step 2), real devnet 402→pay→200 (Task 6). Base route untouched (new route only). Out-of-scope items (agent payer, human UI, Solana publish, discovery path, per-author payTo) intentionally absent.
- **Types consistent:** `solPriceForSlug`/`solPayTo`/`SOL_USDC_MINT`/`SOL_USDC_DECIMALS`/`getSolHandler` defined in Task 2 and used in Task 4; `getPaidArticleBody`/`PaidArticleBody` defined in Task 3, used in Task 4.
- **Known library unknowns (flagged, not placeholders):** exact `x402-solana` server/client signatures — Tasks 2/4/5 each say to reconcile against the installed `.d.ts`. This is unavoidable: the README is the only public reference and the package is the source of truth once installed.
