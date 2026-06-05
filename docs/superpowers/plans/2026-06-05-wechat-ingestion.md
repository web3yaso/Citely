# WeChat Ingestion Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local CLI that turns a WeChat article URL into clean canonical markdown (no platform chrome, images downloaded locally, structure preserved), feeding the existing encrypt/attest flow; then migrate the 3 existing articles onto it.

**Architecture:** `scripts/ingest-wechat.ts <url> <slug>` orchestrates four stages — Playwright fetch → pure `extractArticle(html)` (jsdom chrome-strip + #js_content/Readability + Turndown) → `rehostImages` (download to `public/reports/<slug>/`) → emit `content/reports/_plaintext/<slug>.md`. The pure extraction/rewrite/frontmatter logic is unit-tested against synthetic fixtures; fetch and download are side-effecting and verified by a real run.

**Tech Stack:** TypeScript, jsdom (existing), @mozilla/readability, turndown + turndown-plugin-gfm, Playwright; Vitest for tests.

**Spec:** `docs/superpowers/specs/2026-06-04-wechat-ingestion-design.md`

---

## File Structure

- Create `lib/wechat-extract.ts` — pure extraction: `extractArticle(html)`, `normalizeDate(s)`, `rewriteImageSrcs(md, mapping)`.
- Create `lib/wechat-extract.test.ts` — unit tests against fixtures.
- Create `test/fixtures/wechat/sample.html` — a synthetic but representative WeChat page.
- Create `lib/plaintext.ts` — pure `buildPlaintext(frontmatter, body)`.
- Create `lib/plaintext.test.ts`.
- Create `scripts/ingest-wechat.ts` — CLI orchestrator (Playwright fetch, rehost, write).
- Modify `package.json` — add deps + `"ingest": "tsx scripts/ingest-wechat.ts"`.
- Output images → `public/reports/<slug>/img-N.<ext>` (created at runtime).

---

### Task 1: Add dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install runtime + dev deps**

Run:
```bash
pnpm add @mozilla/readability turndown turndown-plugin-gfm playwright
pnpm add -D @types/turndown
```
Expected: all four added to `dependencies`, `@types/turndown` to `devDependencies`.

- [ ] **Step 2: Install the Playwright Chromium browser**

Run:
```bash
pnpm exec playwright install chromium
```
Expected: Chromium downloaded (one-time, ~150MB).

- [ ] **Step 3: Add the `ingest` script**

In `package.json` `"scripts"`, add after `"seed"`:
```json
"ingest": "tsx scripts/ingest-wechat.ts",
```

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "build: add WeChat ingestion deps (readability, turndown, playwright)"
```

---

### Task 2: Synthetic WeChat fixture

**Files:**
- Create: `test/fixtures/wechat/sample.html`

- [ ] **Step 1: Create the fixture**

Create `test/fixtures/wechat/sample.html` capturing WeChat structure + chrome to strip + content structures to preserve:

```html
<!doctype html><html><head>
<meta property="og:title" content="测试标题：链上风险报告" />
<meta property="og:site_name" content="Web3风险官" />
</head><body>
<h1 id="activity-name">测试标题：链上风险报告</h1>
<em id="publish_time">2026年02月06日 13:47</em>
<div id="js_content">
  <p>第一段<strong>正文</strong>内容。</p>
  <blockquote>这是一段引用。</blockquote>
  <ul><li>列表项一</li><li>列表项二</li></ul>
  <table><thead><tr><th>列</th><th>值</th></tr></thead>
    <tbody><tr><td>A</td><td>1</td></tr></tbody></table>
  <p><img data-src="https://mmbiz.qpic.cn/pic_a.png" src="" /></p>
  <p><img data-src="https://mmbiz.qpic.cn/pic_b.jpg" src="" /></p>
  <script>var x=1;</script>
  <mpvoice>语音组件</mpvoice>
</div>
<div id="js_pc_qr_code">扫码关注</div>
<div id="js_profile_qrcode"><p>微信扫一扫关注该公众号</p></div>
</body></html>
```

- [ ] **Step 2: Commit**

```bash
git add test/fixtures/wechat/sample.html
git commit -m "test: add synthetic WeChat fixture"
```

---

### Task 3: `normalizeDate` (pure)

**Files:**
- Create: `lib/wechat-extract.ts`
- Test: `lib/wechat-extract.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/wechat-extract.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { normalizeDate } from "./wechat-extract";

describe("normalizeDate", () => {
  it("parses WeChat Chinese date to ISO", () => {
    expect(normalizeDate("2026年02月06日 13:47")).toBe("2026-02-06");
  });
  it("pads single-digit month/day", () => {
    expect(normalizeDate("2026年2月6日")).toBe("2026-02-06");
  });
  it("returns empty string when no date", () => {
    expect(normalizeDate("无日期")).toBe("");
  });
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `pnpm test lib/wechat-extract.test.ts`
Expected: FAIL — cannot import `normalizeDate` (module missing).

- [ ] **Step 3: Minimal implementation**

Create `lib/wechat-extract.ts`:
```ts
export function normalizeDate(s: string): string {
  const m = s.match(/(\d{4})[年\-/.](\d{1,2})[月\-/.](\d{1,2})/);
  if (!m) return "";
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}
```

- [ ] **Step 4: Run, verify it passes**

Run: `pnpm test lib/wechat-extract.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/wechat-extract.ts lib/wechat-extract.test.ts
git commit -m "feat: normalizeDate for WeChat date strings"
```

---

### Task 4: `rewriteImageSrcs` (pure)

**Files:**
- Modify: `lib/wechat-extract.ts`
- Test: `lib/wechat-extract.test.ts`

- [ ] **Step 1: Write the failing test** (append to `lib/wechat-extract.test.ts`)

```ts
import { rewriteImageSrcs } from "./wechat-extract";

describe("rewriteImageSrcs", () => {
  it("rewrites mapped image URLs and leaves unmapped ones", () => {
    const md = "![](https://a.png)\n![alt](https://b.jpg)";
    const out = rewriteImageSrcs(md, { "https://a.png": "/reports/x/img-1.png" });
    expect(out).toBe("![](/reports/x/img-1.png)\n![alt](https://b.jpg)");
  });
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `pnpm test lib/wechat-extract.test.ts`
Expected: FAIL — `rewriteImageSrcs` is not a function.

- [ ] **Step 3: Minimal implementation** (append to `lib/wechat-extract.ts`)

```ts
export function rewriteImageSrcs(markdown: string, mapping: Record<string, string>): string {
  return markdown.replace(
    /(!\[[^\]]*\]\()([^)\s]+)/g,
    (full, pre, url) => (mapping[url] ? pre + mapping[url] : full),
  );
}
```

- [ ] **Step 4: Run, verify it passes**

Run: `pnpm test lib/wechat-extract.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/wechat-extract.ts lib/wechat-extract.test.ts
git commit -m "feat: rewriteImageSrcs pure helper"
```

---

### Task 5: `extractArticle` — chrome strip + content + structure + images

**Files:**
- Modify: `lib/wechat-extract.ts`
- Test: `lib/wechat-extract.test.ts`

- [ ] **Step 1: Write the failing test** (append)

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { extractArticle } from "./wechat-extract";

const html = readFileSync(resolve(__dirname, "../test/fixtures/wechat/sample.html"), "utf8");

describe("extractArticle", () => {
  const a = extractArticle(html);

  it("extracts title, authorOrg, publishedAt", () => {
    expect(a.title).toBe("测试标题：链上风险报告");
    expect(a.authorOrg).toBe("Web3风险官");
    expect(a.publishedAt).toBe("2026-02-06");
  });
  it("drops chrome (qr code, 关注 widget, script, mpvoice)", () => {
    expect(a.markdown).not.toContain("扫码关注");
    expect(a.markdown).not.toContain("微信扫一扫");
    expect(a.markdown).not.toContain("var x");
    expect(a.markdown).not.toContain("语音组件");
  });
  it("preserves structure: blockquote, list, table", () => {
    expect(a.markdown).toContain("> 这是一段引用");
    expect(a.markdown).toMatch(/[-*] 列表项一/);
    expect(a.markdown).toContain("| 列 | 值 |");
  });
  it("materializes data-src images and collects URLs in order", () => {
    expect(a.imageUrls).toEqual([
      "https://mmbiz.qpic.cn/pic_a.png",
      "https://mmbiz.qpic.cn/pic_b.jpg",
    ]);
  });
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `pnpm test lib/wechat-extract.test.ts`
Expected: FAIL — `extractArticle` not exported.

- [ ] **Step 3: Implement `extractArticle`** (prepend imports at top of `lib/wechat-extract.ts`, add the function)

At the top of the file:
```ts
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

export type ExtractedArticle = {
  title: string;
  authorOrg: string;
  publishedAt: string;
  markdown: string;
  imageUrls: string[];
};

const CHROME_SELECTORS = [
  "script", "style", "noscript",
  "#js_pc_qr_code", ".qr_code_pc_outer", ".qr_code_pc",
  "#js_profile_qrcode", ".profile_container",
  "#js_sponsor_ad_area", ".reward_area", "#js_reward_area",
  "mpvoice", "qqmusic", "mp-common-product", "mpcps",
];

function toMarkdown(html: string): string {
  const td = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
  });
  td.use(gfm);
  return td.turndown(html).trim();
}
```

Then the function:
```ts
export function extractArticle(html: string): ExtractedArticle {
  const dom = new JSDOM(html);
  const doc = dom.window.document;

  const ogTitle = doc.querySelector('meta[property="og:title"]')?.getAttribute("content") ?? "";
  const ogSite = doc.querySelector('meta[property="og:site_name"]')?.getAttribute("content") ?? "";
  const title = ogTitle || doc.querySelector("#activity-name")?.textContent?.trim() ||
    doc.querySelector("h1")?.textContent?.trim() || "";
  const authorOrg = ogSite || doc.querySelector("#js_name")?.textContent?.trim() || "";
  const publishedAt = normalizeDate(doc.querySelector("#publish_time")?.textContent?.trim() || "");

  // WeChat: content lives in #js_content. Generic pages: fall back to Readability.
  let contentHtml: string;
  const wechat = doc.querySelector("#js_content");
  if (wechat) {
    CHROME_SELECTORS.forEach((sel) => wechat.querySelectorAll(sel).forEach((el) => el.remove()));
    wechat.querySelectorAll("img").forEach((img) => {
      const lazy = img.getAttribute("data-src");
      if (lazy && !img.getAttribute("src")) img.setAttribute("src", lazy);
    });
    contentHtml = wechat.innerHTML;
  } else {
    const parsed = new Readability(doc).parse();
    contentHtml = parsed?.content ?? doc.body.innerHTML;
  }

  const markdown = toMarkdown(contentHtml);
  const imageUrls = [...markdown.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)].map((m) => m[1]);
  return { title, authorOrg, publishedAt, markdown, imageUrls };
}
```

- [ ] **Step 4: Run, verify it passes**

Run: `pnpm test lib/wechat-extract.test.ts`
Expected: PASS (all describe blocks). If the table assertion fails, check that `turndown-plugin-gfm`'s `gfm` is applied (Step 3 `td.use(gfm)`).

- [ ] **Step 5: Run full suite (no regressions)**

Run: `pnpm test`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add lib/wechat-extract.ts lib/wechat-extract.test.ts
git commit -m "feat: extractArticle — structure-aware WeChat extraction"
```

---

### Task 6: `buildPlaintext` frontmatter emitter (pure)

**Files:**
- Create: `lib/plaintext.ts`
- Test: `lib/plaintext.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/plaintext.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import matter from "gray-matter";
import { buildPlaintext } from "./plaintext";

describe("buildPlaintext", () => {
  it("emits frontmatter with auto fields + placeholders and the body", () => {
    const out = buildPlaintext(
      { slug: "x", title: "标题", authorOrg: "Org", publishedAt: "2026-02-06", sourceUrl: "https://mp.weixin.qq.com/s/abc" },
      "正文内容",
    );
    const { data, content } = matter(out);
    expect(data.slug).toBe("x");
    expect(data.title).toBe("标题");
    expect(data.authorOrg).toBe("Org");
    expect(data.publishedAt).toBe("2026-02-06");
    expect(data.sourceUrl).toBe("https://mp.weixin.qq.com/s/abc");
    expect(data.authorName).toBe("TODO");      // placeholder for human
    expect(data.tags).toEqual(["TODO"]);
    expect(data.summary).toBe("TODO");
    expect(content.trim()).toBe("正文内容");
  });
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `pnpm test lib/plaintext.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Minimal implementation**

Create `lib/plaintext.ts`:
```ts
import matter from "gray-matter";

export type PlaintextFrontmatter = {
  slug: string;
  title: string;
  authorOrg: string;
  publishedAt: string;
  sourceUrl: string;
};

export function buildPlaintext(fm: PlaintextFrontmatter, body: string): string {
  const data = {
    title: fm.title,
    slug: fm.slug,
    authorName: "TODO",
    authorOrg: fm.authorOrg,
    tags: ["TODO"],
    summary: "TODO",
    publishedAt: fm.publishedAt,
    sourceUrl: fm.sourceUrl,
  };
  return matter.stringify("\n" + body.trim() + "\n", data);
}
```

- [ ] **Step 4: Run, verify it passes**

Run: `pnpm test lib/plaintext.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/plaintext.ts lib/plaintext.test.ts
git commit -m "feat: buildPlaintext frontmatter emitter"
```

---

### Task 7: CLI orchestrator `scripts/ingest-wechat.ts`

**Files:**
- Create: `scripts/ingest-wechat.ts`

This task wires the pure pieces with the side effects (Playwright fetch, image download, file writes). It is verified by a real run, not a unit test (network + browser).

- [ ] **Step 1: Write the script**

Create `scripts/ingest-wechat.ts`:
```ts
/**
 * Ingest a WeChat (or generic) article URL into a committable plaintext source:
 *   scripts/ingest-wechat.ts <url> <slug>
 *     -> downloads images to public/reports/<slug>/img-N.<ext>
 *     -> writes content/reports/_plaintext/<slug>.md (frontmatter + clean body)
 * Then fill the TODO frontmatter and run scripts/encrypt-content.ts <slug>.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, extname } from "node:path";
import { chromium } from "playwright";
import { extractArticle, rewriteImageSrcs } from "../lib/wechat-extract";
import { buildPlaintext } from "../lib/plaintext";

const url = process.argv[2];
const slug = process.argv[3];
if (!url || !slug || !/^[a-z0-9-]{1,80}$/.test(slug)) {
  throw new Error("usage: ingest-wechat <url> <slug:[a-z0-9-]>");
}
const root = resolve(__dirname, "..");

async function fetchRenderedHtml(target: string): Promise<string> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    });
    await page.goto(target, { waitUntil: "networkidle", timeout: 60000 });
    // trigger lazy-load of mmbiz images
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1500);
    return await page.content();
  } finally {
    await browser.close();
  }
}

function extFromUrl(u: string): string {
  const e = extname(new URL(u).pathname).toLowerCase();
  return /^\.(png|jpe?g|gif|webp)$/.test(e) ? e : ".png";
}

async function rehostImages(markdown: string, imageUrls: string[]): Promise<string> {
  if (imageUrls.length === 0) return markdown;
  const dir = resolve(root, `public/reports/${slug}`);
  mkdirSync(dir, { recursive: true });
  const mapping: Record<string, string> = {};
  let i = 0;
  for (const u of imageUrls) {
    i += 1;
    const name = `img-${i}${extFromUrl(u)}`;
    try {
      const res = await fetch(u, { headers: { referer: "https://mp.weixin.qq.com/" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      writeFileSync(resolve(dir, name), buf);
      mapping[u] = `/reports/${slug}/${name}`;
      console.log(`  image ${i}: ${u} -> ${mapping[u]}`);
    } catch (e) {
      console.warn(`  image ${i} SKIPPED (${(e as Error).message}): ${u}`);
    }
  }
  return rewriteImageSrcs(markdown, mapping);
}

async function main() {
  console.log(`fetching ${url} ...`);
  const html = await fetchRenderedHtml(url);
  const article = extractArticle(html);
  console.log(`extracted "${article.title}" (${article.imageUrls.length} images)`);
  const body = await rehostImages(article.markdown, article.imageUrls);
  const out = buildPlaintext(
    { slug, title: article.title, authorOrg: article.authorOrg, publishedAt: article.publishedAt, sourceUrl: url },
    body,
  );
  const dest = resolve(root, `content/reports/_plaintext/${slug}.md`);
  mkdirSync(resolve(root, "content/reports/_plaintext"), { recursive: true });
  writeFileSync(dest, out);
  console.log(`wrote ${dest}\nNext: fill TODO frontmatter, then: pnpm tsx scripts/encrypt-content.ts ${slug}`);
}

main();
```

- [ ] **Step 2: Type-check**

Run: `pnpm build`
Expected: `✓ Compiled successfully` and `Finished TypeScript` with no errors. (The script isn't bundled into the app, but `tsc` checks it.)

- [ ] **Step 3: Smoke-test against a real URL** (needs one of the 3 real WeChat links)

Run: `pnpm ingest "<real-wechat-url>" yaoqian-crypto-liability`
Expected: prints `extracted "<title>" (N images)`, downloads images to `public/reports/yaoqian-crypto-liability/`, writes `content/reports/_plaintext/yaoqian-crypto-liability.md`. Open that file and confirm: no chrome, structure intact, image links point to `/reports/...`.

- [ ] **Step 4: Commit**

```bash
git add scripts/ingest-wechat.ts
git commit -m "feat: ingest-wechat CLI (fetch + rehost + emit plaintext)"
```

---

### Task 8: Migrate the 3 existing articles (runbook)

This is an operational task, not code. Requires the 3 real `mp.weixin.qq.com/s/...` URLs and a funded `DEMO_AUTHOR_PRIVATE_KEY` (`0x8dF5…`, direct-broadcast — avoids the MetaMask relay issue #9). Do one slug at a time; verify before moving on.

For each `<slug>` in `yaoqian-crypto-liability`, `web3-illegal-employment`, `onchain-partnership-rwa`:

- [ ] **Step 1: Remove the old index entry** (re-seed throws otherwise — `appendIndex` is first-write-wins)

Edit `data/attestation-index.json`: delete the object whose `slug` equals `<slug>`. Save.

- [ ] **Step 2: Delete old artifacts**

```bash
rm -f content/reports/<slug>.mdx content/reports/<slug>.enc
rm -rf public/reports/<slug>
```

- [ ] **Step 3: Re-ingest from the real URL**

```bash
pnpm ingest "<real-wechat-url>" <slug>
```
Expected: clean `content/reports/_plaintext/<slug>.md` + images under `public/reports/<slug>/`.

- [ ] **Step 4: Restore the known frontmatter**

Open `content/reports/_plaintext/<slug>.md`. Replace the `TODO` placeholders (`authorName`, `tags`, `summary`) with the values from the old `.mdx` recovered from git:
```bash
git show HEAD:content/reports/<slug>.mdx
```
Copy `authorName`, `tags`, `summary` across. Keep the auto-filled `title`/`authorOrg`/`publishedAt`/`sourceUrl`.

- [ ] **Step 5: Encrypt (produces clean .mdx + .enc)**

```bash
pnpm tsx scripts/encrypt-content.ts <slug>
```
Expected: `ingested <slug>: .mdx + .enc written`.

- [ ] **Step 6: Re-attest on-chain + write index**

```bash
pnpm seed <slug>
```
Expected: prints a new attestation UID + tx hash, appends the index entry. (Signs from `0x8dF5`; records the configured author for known slugs.)

- [ ] **Step 7: Verify the article renders + is on-chain**

Run: `pnpm dev`, open `http://localhost:3000/reports/<slug>`. Confirm: title/byline correct, body clean, images load, "on-chain ✓" badge links to a live EAS attestation.

- [ ] **Step 8: Commit the migrated article**

```bash
git add content/reports/<slug>.mdx content/reports/<slug>.enc public/reports/<slug> data/attestation-index.json
git commit -m "content: re-ingest <slug> via clean pipeline + re-attest"
```

---

## Self-Review notes

- **Spec coverage:** real scraper (Task 7), structure-aware cleaning (Task 5), image rehost (Task 7 `rehostImages` + Task 4 rewrite), structure preserved (Task 5 tests), fixtures/tests (Tasks 2–6), migration incl. re-attest (Task 8). Deferred items (live `/publish`, LLM, publish-data stub, slimming normalizeMarkdown) are intentionally absent.
- **Not wired to `/publish`:** by design — `lib/publish-data.ts` is untouched this iteration.
- **`normalizeMarkdown` untouched:** display layer unchanged; clean bodies just need less of it.
