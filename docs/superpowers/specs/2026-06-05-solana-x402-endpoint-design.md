# Solana devnet x402 paid-unlock endpoint (parallel lane)

**Date:** 2026-06-05
**Branch:** sol-dev
**Context:** Citely's paid read currently runs on Base (Sepolia) via `@x402/evm` + CDP
facilitator. This adds a **parallel** Solana devnet x402 lane for the same paid
content, so x402-on-Solana agents (e.g. pay.sh-style payers) can pay.

## Scope

**IN:** A Solana devnet x402 **resource server** — one new paid-unlock endpoint that
returns `402` with Solana payment requirements, verifies + settles the payment via the
**PayAI** facilitator, and on success returns the same body as the Base endpoint (full
text + companion + citation). End-to-end verified with a throwaway Solana keypair payer.

**OUT (separate concerns / future):**
- The agent payer program (Cobo or otherwise) — done by a **separate** program; not built here.
- Human-reader Solana payment UI.
- Publishing/attestation on Solana (stays on Base EAS).
- Adding the Solana read path to the free discovery endpoint (small follow-up).
- Per-author Solana payTo (this iteration uses one demo address).

## Locked decisions

- **Exposure:** a **separate route** `app/api/v1/sol/articles/[slug]/route.ts`. The
  existing Base route `app/api/v1/articles/[slug]/route.ts` is **not touched**.
- **Facilitator:** **PayAI** (`x402-solana`), Solana-first, supports `solana-devnet`.
- **Network / asset:** `solana-devnet`, devnet **USDC-SPL** mint
  `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` (6 decimals).
- **payTo:** a single demo Solana devnet address from env `SOL_PAYTO` (covers all
  articles this iteration).
- **price:** reuse the existing per-slug `priceUSDC` from `data/attestation-index.json`
  (6-decimal micro-USDC — same units as SPL USDC, so the number carries over directly).
- **Verification:** a real devnet `402 → pay → 200` using a throwaway funded Solana
  keypair (NOT the agent program).

## Architecture

```
agent ──GET /api/v1/sol/articles/<slug>──▶ 402 Payment Required
                                            network: solana-devnet
                                            asset:   USDC-SPL (4zMMC9…ncDU)
                                            payTo:   $SOL_PAYTO   amount: priceUSDC
agent signs SPL transfer (x402-solana) ──X-Payment──▶ retry
  server verify+settle via PayAI facilitator ──ok──▶ 200 { slug, title, content, companion, citation }
```

The endpoint reuses the content layer unchanged: `findRecord`, `getReportMeta`,
`getReportBody`, `getCompanionPaidZone`. The 200 JSON body is identical to the Base
endpoint's (`app/api/v1/articles/[slug]/route.ts`).

## Components / files

- **Create `lib/x402-solana-server.ts`** — Solana lane config, mirroring
  `lib/x402-server.ts`:
  - `SOL_NETWORK = "solana-devnet"`, `SOL_USDC_MINT` constant.
  - `solPayTo(): string` — reads `SOL_PAYTO` (throws if unset).
  - `priceMicroUsdForSlug(slug): string` — reuse `priceUSDC` from the index.
  - PayAI facilitator client/config (base URL; devnet). Exact x402-solana
    resource-server API (build-requirements + verify + settle helpers) confirmed
    against the `x402-solana` package at implementation time.
- **Create `app/api/v1/sol/articles/[slug]/route.ts`** — GET handler:
  - slug whitelist `^[a-z0-9-]{1,80}$` + `findRecord` → 404 before any 402 (mirrors Base).
  - No `X-Payment` → 402 with the Solana requirements above.
  - With `X-Payment` → verify+settle via PayAI; on success return the shared 200 body;
    on failure return 402 with the facilitator's reason.
  - `force-dynamic`; CORS headers identical to the Base route.
- **Reuse:** content + index libs (no changes).
- **`.env.local.example`** — add `SOL_PAYTO`, `SOLANA_DEVNET_RPC` (default public
  devnet RPC), and any PayAI facilitator var the library needs.

## Testing

- **Unit (pure):** `solPayTo` (env present/absent), `priceMicroUsdForSlug` (reads index),
  and the 402 payment-requirements object shape (network/asset/payTo/amount).
- **Integration — 402 shape:** GET the endpoint with no payment → assert `402` and that
  the requirements name `solana-devnet` + the USDC-SPL mint + `$SOL_PAYTO` + the slug's price.
- **End-to-end (real devnet):** a throwaway Solana keypair funded with devnet SOL +
  USDC-SPL pays via the `x402-solana` client; assert `402 → pay → 200` and that the 200
  body matches the content. This is a scripted manual verification (network + facilitator
  + funded wallet), not a CI unit test.

## Open items to confirm at implementation time

- Exact `x402-solana` resource-server API (requirements builder + facilitator
  verify/settle) and whether PayAI devnet needs any key/config beyond the facilitator URL.
- Whether `@x402/core`'s scheme registry can host an SVM scheme alongside EVM, or the
  Solana lane uses `x402-solana` standalone (leaning standalone, since the route is separate).

## Risks

- **PayAI devnet availability / funding** — facilitator is a hosted dependency and a
  potential single point of failure; surface its errors in the 402 reason.
- **Price units** — confirm SPL USDC devnet uses 6 decimals so `priceUSDC` carries over
  unchanged (it does for `4zMMC9…ncDU`).
- **No Solana payTo per author yet** — single demo address; revenue routing per author is
  a later iteration.
