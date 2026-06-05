# Auto-download report + prompts after payment (#8)

**Date:** 2026-06-04
**Issue:** [#8](https://github.com/web3yaso/Citely/issues/8) — Download report and prompts automatically after payment
**Branch:** dev

## Goal

When a **human reader** successfully pays to unlock an article, the browser
**automatically** downloads a zip containing the full report and its companion
prompts. No button, no manual step.

## Decisions (locked)

- **Trigger:** pure auto-download. Fires **once**, on the actual payment-success
  event only. Does **not** fire on the `localStorage` cache-restore path (revisits
  do not re-download).
- **Packaging:** a zip of **two files**.
- **No fallback UI.** If the browser blocks the programmatic download (stale user
  gesture after the async payment, Safari/iOS, popup blockers) or the user is on a
  platform with poor zip support, the file is lost with no way to re-download. This
  is an **accepted limitation** (see Known limitations).

## Package contents

`citely-<slug>.zip` containing:

| File | Contents |
| --- | --- |
| `<slug>.md` | Citation header (作者 / EAS UID / 发布日期 / 链上出处链接) + a one-line note that the body is display-normalized, then the full report body run through `normalizeMarkdown`. |
| `<slug>-prompts.md` | Short header + the `companion` paid-zone markdown (starter prompts + agent manual), verbatim. |

`<slug>` comes from `ArticlePaid.slug` (already constrained to `[a-z0-9-]`), so the
filename is filesystem-safe.

### Report body: normalized, not hash-exact

The report body is run through `normalizeMarkdown` (same cleaning as the on-screen
view) for readability. This means the downloaded bytes will **not** match the
on-chain `contentHash` (keccak256 of the raw body). The citation header states this
explicitly so a reader who wants to verify the hash knows to use the on-chain
original. Readability is the priority for the downloaded artifact.

## Components

### `lib/article-download.ts` (client)

```ts
// Pure — unit-tested.
export function buildArticleFiles(full: ArticlePaid): {
  reportMd: string;     // citation header + normalized body
  promptsMd: string;    // header + companion
  zipName: string;      // `citely-${slug}.zip`
  reportName: string;   // `${slug}.md`
  promptsName: string;  // `${slug}-prompts.md`
};

// Side-effecting — NOT unit-tested (fflate.zipSync + anchor + object URL).
export function downloadArticleZip(full: ArticlePaid): void;
```

`downloadArticleZip` zips the two files via `fflate.zipSync`, wraps the bytes in a
`Blob`, and triggers download through a temporary `<a download>` + `URL.createObjectURL`,
revoking the URL afterward. Any error is swallowed (best-effort; never throws into
the caller).

### `components/reports/UnlockGate.tsx`

Add an optional callback so the download fires **only on the human path** and
**only on payment**, never on cache-restore and never in agent mode:

```ts
onUnlocked?: (full: ArticlePaid) => void;
```

- Called in `onUnlock`'s success branch, right after `setFull(data)`.
- **Not** called from the `useEffect` cache-restore branch.

`HumanUnlockGate` passes `onUnlocked={downloadArticleZip}`. `AgentUnlockGate` passes
nothing — agent-mode unlocks never download.

## Data flow

```
reader clicks "用钱包付 … 解锁全文"
  → UnlockGate.onUnlock: unlockArticle() → ArticlePaid
  → localStorage cache + setFull(data)
  → onUnlocked?.(data)            // human path only
      → downloadArticleZip(data)
          → buildArticleFiles(data)
          → fflate.zipSync({ "<slug>.md": reportMd, "<slug>-prompts.md": promptsMd })
          → Blob → <a download="citely-<slug>.zip"> → click → revoke
```

## Dependency

Add **`fflate`** (~8KB, zero-dep, browser `zipSync`). Lighter than jszip.

## Testing (TDD)

`lib/article-download.test.ts` covering `buildArticleFiles` only:

- `reportMd` contains the citation fields (author, attestationUID, publishedAt) and
  the article content.
- `promptsMd` contains the companion text.
- `zipName` / `reportName` / `promptsName` derive correctly from the slug.

The zip + DOM side-effect (`downloadArticleZip`) is not unit-tested — `zipSync` and
`URL.createObjectURL` are awkward under jsdom and the logic is thin.

## Scope guards (YAGNI)

- Human unlock path only. No agent-mode download.
- No download button, no re-download link, no PDF, no per-file (non-zip) download.

## Known limitations (accepted)

- **No recovery.** A blocked/failed auto-download cannot be retried — no button, and
  cache-restore intentionally does not re-trigger. A user who paid may end up with no
  file. Accepted per product decision.
- **Mobile/Safari** programmatic zip downloads are unreliable; same accepted risk.
- **`companion` always present:** `getCompanionPaidZone` throws on a missing `.A.enc`,
  so a successful unlock guarantees a non-empty companion — `prompts.md` is never empty.
  (Publishing an article without a companion 500s the paid endpoint — a separate,
  pre-existing issue, out of scope for #8.)
