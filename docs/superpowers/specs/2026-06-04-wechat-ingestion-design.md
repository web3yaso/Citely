# WeChat article ingestion: real scraper + structure-aware cleaning + image rehost (#4)

**Date:** 2026-06-04
**Issue:** [#4](https://github.com/web3yaso/Citely/issues/4)
**Branch:** dev

## Goal

Replace the manual, regex-based WeChat ingestion with a real pipeline: a WeChat
article URL → clean canonical markdown (no platform chrome, images intact,
structure preserved) → the existing encrypt/attest flow. Cleaning happens **at
ingestion, before encryption**, so the on-chain `contentHash` covers clean content.
Also migrate the 3 existing articles (incl. seed) onto the new clean pipeline.

## Locked decisions

- **Scraper:** TS-native — Playwright (headless fetch) + Mozilla Readability
  (extraction) + Turndown + turndown-plugin-gfm (HTML→markdown). Not the Python
  tool, not Jina.
- **Where it runs:** local CLI script. Not live in `/publish` (serverless can't run
  headless Chromium easily; live ingestion is deferred).
- **Images:** download to local `public/reports/<slug>/img-N.<ext>` (committed),
  rewrite markdown `src` → `/reports/<slug>/img-N.<ext>`. Sequential `img-N`
  numbering. Image paths become part of the encrypted body (and thus the on-chain
  hash).
- **Migration:** delete + re-ingest + re-attest the 3 existing articles
  (`yaoqian-crypto-liability`, `web3-illegal-employment`, `onchain-partnership-rwa`).
  Real WeChat URLs supplied by the user.

## Architecture — `scripts/ingest-wechat.ts <url> <slug>`

```
url ─▶ ① fetch ─▶ ② extract+clean ─▶ ③ rehost images ─▶ ④ emit _plaintext
       Playwright   (pure, tested)      public/reports/    → human fills frontmatter
                                                            → existing encrypt-content
```

1. **fetch** — `fetchRenderedHtml(url): Promise<string>` (Playwright): load the URL
   with a realistic UA, scroll to materialize `data-src` lazy images, return rendered
   HTML. Side-effecting. (WeChat bodies are largely in the initial HTML; a plain
   `fetch` fallback is possible but Playwright is primary per the chosen approach.)
2. **extract + clean** — `extractArticle(html): { title, authorOrg, publishedAt,
   markdown, imageUrls }`. **Pure, unit-tested.**
   - Structure-aware chrome removal: drop known WeChat widgets by selector (QR code,
     关注/赞赏/js_profile/reward, nav rows) — not string regex.
   - Mozilla Readability (with jsdom) extracts the `#js_content` main article.
   - Turndown (+ turndown-plugin-gfm) → markdown, preserving tables / blockquotes /
     ordered & unordered lists / footnotes.
   - Collect image URLs (resolving `data-src`).
3. **rehost images** — `rehostImages(markdown, slug): Promise<string>`: download each
   image to `public/reports/<slug>/img-N.<ext>`, rewrite `src` → local path. A
   403/expired image is skipped and logged (never aborts the run).
4. **emit** — write `content/reports/_plaintext/<slug>.md`: auto-fill `title`,
   `authorOrg` (公众号 name), `publishedAt`, `sourceUrl = url`; leave `authorName`,
   `tags`, `summary` as placeholders for the human; followed by the cleaned,
   image-rewritten body.

Then: human fills the placeholder frontmatter → existing `pnpm tsx
scripts/encrypt-content.ts <slug>` → `.mdx` + `.enc` (now hashing **clean** content).
Encryption/attestation flow unchanged.

## Code units (small, single-purpose)

- `lib/wechat-extract.ts` → `extractArticle(html)` — **pure**, tested against fixtures.
- `scripts/ingest-wechat.ts` — orchestrates the side effects (fetch → extract →
  rehost → write).
- `fetchRenderedHtml` (Playwright) and `rehostImages` (download) — side-effecting,
  verified by integration/manual run, not unit-tested.

## Dependencies to add

`playwright`, `@mozilla/readability`, `turndown`, `turndown-plugin-gfm`. (`jsdom`
already present.) Playwright is local-CLI-only; never runs on Vercel.

## Testing (TDD)

`lib/wechat-extract.test.ts` against real WeChat HTML in `test/fixtures/wechat/`:

- Output markdown has **no chrome** (no QR/关注/timestamp/原创-byline lines).
- `title` extracted correctly.
- **Structure preserved**: at least one table, one list, one blockquote round-trip.
- `imageUrls` collected (count matches the fixture's figures).

This replaces the regex whack-a-mole with structure-aware assertions.

## Migration (the 3 existing articles)

Re-ingesting changes the body → changes `contentHash` → the **existing EAS
attestations no longer match**. So each migrated article must be **re-attested**.
For seed/demo articles this goes through `pnpm seed`, which attests via
`DEMO_AUTHOR_PRIVATE_KEY` (`0x8dF5…38e1D`, a direct-broadcast EOA — not the MetaMask
Smart-Transactions relay that fails on Base Sepolia, see #9).

Per article, for each of `yaoqian-crypto-liability`, `web3-illegal-employment`,
`onchain-partnership-rwa`:

1. Delete old artifacts: `content/reports/<slug>.mdx`, `.enc`, and the index entry in
   `data/attestation-index.json`.
2. `scripts/ingest-wechat.ts <real-wechat-url> <slug>` → clean `_plaintext` + images.
3. Carry over the known frontmatter (authorName, tags, summary, price) from git
   history / the old `.mdx`.
4. `scripts/encrypt-content.ts <slug>` → new clean `.mdx` + `.enc`.
5. `pnpm seed <slug>` → re-attest on Base Sepolia (new clean hash) + rewrite index.

The user supplies the 3 real `mp.weixin.qq.com/s/...` URLs.

## `normalizeMarkdown` (display regex)

Kept as-is this iteration (harmless on clean bodies; still covers any not-yet-migrated
content). Not touched here. Once all bodies are clean, it can be slimmed in a later
pass — out of scope for #4.

## Scope

**IN:** the CLI, pure extraction + fixtures/tests, local image rehost, emit
`_plaintext`, and migrating the 3 existing articles (delete → re-ingest → re-attest).

**DEFERRED (separate issues):**
- Wiring `/publish` to fetch a URL **live** (serverless headless-browser problem).
- LLM-assisted cleanup pass.
- Replacing the `lib/publish-data.ts` seed stub.
- Slimming `normalizeMarkdown` after migration.

## Known constraints / risks

- **Re-attest required** for migrated articles (handled via `pnpm seed` / `0x8dF5`).
- **Real source URLs required** — the stored `sourceUrl` is a placeholder
  `https://mp.weixin.qq.com/`; the user provides the real article links.
- **Playwright is heavy** (downloads a browser) — acceptable for a local-only CLI.
- **WeChat anti-scraping** — public article pages are generally fetchable; if blocked,
  Playwright stealth (realistic UA / headers) is the mitigation. Image hotlinks
  (`mmbiz.qpic.cn`) may 403 even from a browser context; such images are skipped+logged.
