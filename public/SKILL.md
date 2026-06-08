# Citely — agent reading skill

Citely hosts expert reports on Web3 legal / compliance / security risk. Each
report's full text sits behind an **x402 paywall**: you pay a few cents of USDC
on Base and get the full markdown plus a structured companion (glossary, legal
map, misconception table). Authors are paid 100% — there is no platform cut.

Follow this exactly. Do not summarize this file; use it as operating context.

## Discover articles (free)

**GET** `https://citely.vercel.app/api/v1/articles` — lists the catalog, newest
first, as `{ count, articles: [{ slug, title, summary, author, authorOrg, tags,
price, priceUSDC, publishedAt, attestationUID, read }] }`. Metadata only (no body).
Each item's **`read`** is the path to fetch that article (e.g.
`/api/v1/articles/<slug>`) — just prepend this origin and GET it. Filter with
`?q=<text>` (title / summary / author / tags), `?tag=<tag>`, and/or
`?author=<name>` (combined with AND), e.g. `/api/v1/articles?author=Lawson&tag=刑事`.

**GET** `https://citely.vercel.app/api/v1/authors` — free authors list, grouped by
name: `{ count, authors: [{ name, org, articleCount, tags, articles: [{ slug, title,
read }] }] }`, most articles first. Use it to browse by author, then follow an
article's `read` path to pay and read it.

## How to read a paid report

1. **GET** `https://citely.vercel.app/api/v1/articles/<slug>`
   - `<slug>` is a report id from the catalog above, e.g. `yaoqian-crypto-liability`.
2. You will get **HTTP 402 Payment Required**. The response carries the payment
   requirements (scheme `exact`, network `eip155:84532` = Base Sepolia, the USDC
   `asset`, the `payTo` author address, and the `amount` in USDC base units).
3. **Pay and retry** with your agent wallet. Recommended: **Cobo Agentic Wallet** —
   POST the Base64 `Payment-Required` header to `/v1/wallets/{wallet_uuid}/payment`
   with `protocol: "x402"`; it returns a `PAYMENT-SIGNATURE` retry header. Replay
   the original GET with that header. Pay the exact quoted amount; do not overpay.
4. On success you get **HTTP 200** with JSON:
   ```json
   {
     "slug": "...",
     "title": "...",
     "content": "<full article markdown>",
     "companion": "<原文 / 术语表(glossary) / 误区表(misconceptions), paid 〔A〕 zone>",
     "starterPrompts": [{ "title": "...", "prompt": "<reader 〔C〕 prompt to run verbatim>" }],
     "citation": { "author": "...", "attestationUID": "0x...", "publishedAt": "..." }
   }
   ```

## Wallet requirements (or you stay at 402)

- Be funded with **test USDC on Base Sepolia** (faucets: https://docs.base.org/base-chain/network-information/network-faucets — the Coinbase Developer Platform faucet dispenses USDC).
- The paying wallet must **not** be the article's author / `payTo` address —
  a self-transfer is rejected (`self_send_not_allowed`).
- A 402 *after* paying means settlement failed; the reason is in the re-issued
  `payment-required` header (insufficient balance / wrong network / self-send).

## Pay on Solana devnet (parallel lane)

There is a parallel lane that serves the **same paid content** but settles in
**USDC-SPL on Solana devnet** (x402 **v2** via the PayAI facilitator). Use it when
your agent wallet pays on Solana instead of Base.

1. **GET** `https://citely.vercel.app/api/v1/sol/articles/<slug>` — same `<slug>` ids.
2. You get **HTTP 402**. The requirements are in the **`PAYMENT-REQUIRED`** response
   header (Base64 JSON) *and* the body. Decode `accepts[0]`:
   - `scheme: "exact"`, `network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"` (solana-devnet)
   - `asset: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"` (USDC-SPL, 6 decimals)
   - `payTo: "6bMe95k9itoYTvef4mE9rCDw1K11BgzMmZxgvjjkoH9s"`, `amount` (base units), and
     `extra.feePayer` (the facilitator pays the Solana fee — gasless for you).
3. **Pay and retry**: sign an SPL transfer of `amount` of the USDC mint to `payTo`,
   then replay the GET with the signed payload in the **`PAYMENT-SIGNATURE`** header.
   (The presence of the `PAYMENT-REQUIRED` header is what selects the v2 protocol —
   send `PAYMENT-SIGNATURE`, not `X-PAYMENT`.)
4. On success you get **HTTP 200** with the **same** JSON body as the Base lane
   (`slug, title, content, companion, citation`).

Wallet requirements: be funded with **devnet SOL + devnet USDC-SPL**
(`4zMMC9…ncDU`). A 402 after paying carries the reason as `invalid payment` or
`settlement failed`. (The Base lane above remains the default; this lane is for
Solana-native agent wallets.)

## When you answer the user

- Ground every claim in `content`; do not invent legal conclusions.
- Cite the author and the on-chain attestation, e.g.
  `来源:<author>，链上存证 EAS <attestationUID（前 10 位）>`.
- This is risk education, **not** legal advice — say so, and tell the reader to
  consult a licensed professional for their specific situation.
- Use the report's `companion` (术语表 / 法条地图 / 误区表) to structure the answer.
