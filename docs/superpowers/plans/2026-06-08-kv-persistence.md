# KV Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/publish` and the payment-log persist on Vercel's read-only serverless filesystem by routing the attestation index + payment log through a store abstraction (file backend locally/CI, Upstash Redis in prod).

**Architecture:** A new `lib/store.ts` exposes an all-async `CitelyStore` (getIndex/addIndexRecord/getPaymentLog/addPaymentEntry). One backend is chosen at module load: `FileStore` (default) or `RedisStore` (when Upstash env present). `attestation-index.ts` + `payment-log.ts` become async and delegate to the store; the async-ness propagates up through `reports.ts`, `leaderboard.ts`, `paid-article.ts`, the API routes, and the server components.

**Tech Stack:** TypeScript, `@upstash/redis` (HTTP client), Next.js App Router, Vitest. Branch `dev`.

**Spec:** `docs/superpowers/specs/2026-06-03-kv-persistence-design.md`

**Scope note:** Publishing stays Base-only (EAS). Solana is a read-only lane; it reads the same KV-backed index. No Solana publish.

---

## File structure

- Create `lib/store.ts` — `CitelyStore` interface, `FileStore`, `RedisStore`, `getStore()` (memoized backend selection).
- Create `lib/store.test.ts` — FileStore (real temp files) + RedisStore (in-memory `@upstash/redis` mock).
- Modify `lib/attestation-index.ts` — `readIndex`/`hasSlug`/`findRecord`/`appendIndex` → async, delegate to store. `validateAttestationInput` stays sync.
- Modify `lib/payment-log.ts` — `readPaymentLog`/`appendPaymentLog` → async, delegate to store.
- Modify `lib/reports.ts` — every fn that calls `readIndex` becomes async (`listPublishedReports`, `listReaderCatalog`, `listAgentCatalog`, `listAuthors`, `getPublishedReport`). `getReportMeta`/`getReportBody` stay sync (read committed content files).
- Modify `lib/leaderboard.ts` — `listLeaderboard`/`getWriterStats` → async.
- Modify `lib/paid-article.ts` — `getPaidArticleBody` → async.
- Modify `lib/x402-solana-server.ts` — `solPriceForSlug` → async.
- Modify routes: `app/api/v1/articles/route.ts`, `app/api/v1/articles/[slug]/route.ts`, `app/api/v1/sol/articles/[slug]/route.ts`, `app/api/v1/authors/route.ts`, `app/api/internal/attestations/route.ts`.
- Modify server components: `app/page.tsx`, `app/reports/page.tsx`, `app/reports/[slug]/page.tsx`.
- Modify tests: `lib/reports.test.ts`, `lib/leaderboard.test.ts`, `lib/leaderboard-consistency.test.ts`, `lib/paid-article.test.ts`, `lib/payment-log.test.ts`, `lib/x402-solana-server.test.ts` (any that call now-async fns → `await`).
- Create `scripts/seed-kv.ts` + `package.json` `seed-kv`. Modify `scripts/reset-demo.ts` to go through the store.
- Modify `data/attestation-index.json` — remove the DAO record (keep 2 seeds).
- Modify `.env.local.example` — add Upstash creds (blank = file backend).

Notes:
- pnpm only. Never stage `data/payment-log.json` unless a task says so.
- The x402 paywall `accepts.payTo`/`price` are currently passed as `(ctx)=>string` functions. Plan resolves the record async in the route handler and passes sync closures over it — no async x402 resolver.
- After this lands, `lib/x402-server.ts` `payToForSlug`/`priceUsdForSlug` become unused (inlined into the route) — remove them in Task 6.

---

### Task 1: Dependency + env

**Files:** Modify `package.json`, `.env.local.example`

- [ ] **Step 1: Install the Redis client**

```bash
pnpm add @upstash/redis
```

- [ ] **Step 2: Add env placeholders.** In `.env.local.example`, after the `SOLANA_DEVNET_RPC` block, add:
```
# ── KV persistence (prod: Upstash Redis; blank → local file backend) ─────────
# On Vercel, add the Upstash Redis Marketplace integration; it injects these.
# Leave blank locally/CI to use data/*.json files.
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

- [ ] **Step 3: Commit**
```bash
git add package.json pnpm-lock.yaml .env.local.example
git commit -m "build: add @upstash/redis + KV env placeholders"
```

---

### Task 2: `lib/store.ts` — the store abstraction (TDD)

**Files:** Create `lib/store.ts`, Test `lib/store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/store.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileStore, RedisStore } from "./store";
import type { AttestationRecord } from "./attestation-index";
import type { PaymentEntry } from "./payment-log";

const rec = (slug: string): AttestationRecord => ({
  slug, attestationUID: "0x" + "a".repeat(64), txHash: "0x" + "b".repeat(64),
  author: "0xCC2D5DC5148d8Ad52Da32bd7C6B6F9d43510A392", priceUSDC: "300000",
  publishedAt: 1770000000, version: 1, disclaimerHash: "0x" + "c".repeat(64),
});
const pay = (slug: string): PaymentEntry => ({ slug, payer: "0x", amount: "300000", txHash: "0x", ts: 1 });

describe("FileStore", () => {
  let dir: string, indexPath: string, logPath: string, s: FileStore;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "citely-store-"));
    indexPath = join(dir, "index.json"); logPath = join(dir, "log.json");
    writeFileSync(indexPath, "[]\n"); writeFileSync(logPath, "[]\n");
    s = new FileStore(indexPath, logPath);
  });
  it("round-trips index records", async () => {
    await s.addIndexRecord(rec("a"));
    expect((await s.getIndex()).map((r) => r.slug)).toEqual(["a"]);
  });
  it("first-write-wins: throws on duplicate slug", async () => {
    await s.addIndexRecord(rec("a"));
    await expect(s.addIndexRecord(rec("a"))).rejects.toThrow(/already published/i);
  });
  it("appends payment entries", async () => {
    expect(await s.addPaymentEntry(pay("a"))).toBe(true);
    expect((await s.getPaymentLog()).length).toBe(1);
  });
});

describe("RedisStore", () => {
  // Minimal in-memory fake of the @upstash/redis surface we use.
  function fakeRedis() {
    const hashes = new Map<string, Map<string, string>>();
    const lists = new Map<string, string[]>();
    return {
      async hsetnx(key: string, field: string, value: string) {
        const h = hashes.get(key) ?? new Map(); hashes.set(key, h);
        if (h.has(field)) return 0; h.set(field, value); return 1;
      },
      async hgetall(key: string) {
        const h = hashes.get(key); if (!h) return null;
        return Object.fromEntries(h.entries());
      },
      async rpush(key: string, value: string) {
        const l = lists.get(key) ?? []; lists.set(key, l); l.push(value); return l.length;
      },
      async lrange(key: string) { return lists.get(key) ?? []; },
    };
  }
  it("HSETNX gives first-write-wins; HGETALL round-trips", async () => {
    const s = new RedisStore(fakeRedis() as any);
    await s.addIndexRecord(rec("a"));
    await expect(s.addIndexRecord(rec("a"))).rejects.toThrow(/already published/i);
    expect((await s.getIndex()).map((r) => r.slug)).toEqual(["a"]);
  });
  it("addPaymentEntry returns false when redis throws", async () => {
    const bad = { rpush: async () => { throw new Error("down"); } } as any;
    expect(await new RedisStore(bad).addPaymentEntry(pay("a"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `pnpm test lib/store.test.ts`
Expected: FAIL — `./store` not found.

- [ ] **Step 3: Implement** `lib/store.ts`:
```ts
import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { AttestationRecord } from "./attestation-index";
import type { PaymentEntry } from "./payment-log";

export interface CitelyStore {
  getIndex(): Promise<AttestationRecord[]>;
  addIndexRecord(rec: AttestationRecord): Promise<void>; // first-write-wins: throws on dup slug
  getPaymentLog(): Promise<PaymentEntry[]>;
  addPaymentEntry(e: PaymentEntry): Promise<boolean>;     // best-effort: false on failure
}

export class FileStore implements CitelyStore {
  constructor(
    private indexPath = resolve(process.cwd(), "data/attestation-index.json"),
    private logPath = resolve(process.cwd(), "data/payment-log.json"),
  ) {}
  private read<T>(path: string): T[] {
    if (!existsSync(path)) return [];
    return JSON.parse(readFileSync(path, "utf8"));
  }
  private writeAtomic(path: string, data: unknown): void {
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
    renameSync(tmp, path);
  }
  async getIndex() { return this.read<AttestationRecord>(this.indexPath); }
  async addIndexRecord(rec: AttestationRecord) {
    const all = this.read<AttestationRecord>(this.indexPath);
    if (all.some((r) => r.slug === rec.slug)) throw new Error("slug already published");
    all.push(rec);
    this.writeAtomic(this.indexPath, all);
  }
  async getPaymentLog() { return this.read<PaymentEntry>(this.logPath); }
  async addPaymentEntry(e: PaymentEntry) {
    try { this.writeAtomic(this.logPath, [...this.read<PaymentEntry>(this.logPath), e]); return true; }
    catch { return false; }
  }
}

// The slice of @upstash/redis we use (keeps the store testable with a fake).
type RedisLike = {
  hsetnx(key: string, field: string, value: string): Promise<number>;
  hgetall(key: string): Promise<Record<string, unknown> | null>;
  rpush(key: string, value: string): Promise<number>;
  lrange(key: string, start: number, stop: number): Promise<unknown[]>;
};
const K_INDEX = "citely:index";
const K_PAY = "citely:payments";

export class RedisStore implements CitelyStore {
  constructor(private redis: RedisLike) {}
  async getIndex() {
    const h = await this.redis.hgetall(K_INDEX);
    if (!h) return [];
    return Object.values(h).map((v) => (typeof v === "string" ? JSON.parse(v) : v)) as AttestationRecord[];
  }
  async addIndexRecord(rec: AttestationRecord) {
    const ok = await this.redis.hsetnx(K_INDEX, rec.slug, JSON.stringify(rec));
    if (ok === 0) throw new Error("slug already published");
  }
  async getPaymentLog() {
    const xs = await this.redis.lrange(K_PAY, 0, -1);
    return xs.map((v) => (typeof v === "string" ? JSON.parse(v) : v)) as PaymentEntry[];
  }
  async addPaymentEntry(e: PaymentEntry) {
    try { await this.redis.rpush(K_PAY, JSON.stringify(e)); return true; } catch { return false; }
  }
}

let _store: CitelyStore | null = null;
/** Memoized backend: Upstash Redis when its env is present, else the file backend. */
export function getStore(): CitelyStore {
  if (_store) return _store;
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (url && token) {
    // Lazy require so local/CI (no creds) never loads the client.
    const { Redis } = require("@upstash/redis") as typeof import("@upstash/redis");
    _store = new RedisStore(new Redis({ url, token }) as unknown as RedisLike);
  } else {
    _store = new FileStore();
  }
  return _store;
}
```

- [ ] **Step 4: Run, verify it passes**

Run: `pnpm test lib/store.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**
```bash
git add lib/store.ts lib/store.test.ts
git commit -m "feat: CitelyStore abstraction (FileStore + RedisStore)"
```

---

### Task 3: `lib/attestation-index.ts` → async (delegate to store)

**Files:** Modify `lib/attestation-index.ts`, Test `lib/attestation-index.test.ts` (if present), `lib/payment-log.ts` type export.

- [ ] **Step 1: Make the read/write fns async.** Replace the fs-based bodies (keep `AttestationRecord` type + `validateAttestationInput` unchanged):
```ts
import { isAddress } from "viem";
import { getStore } from "./store";
// ...AttestationRecord type + SLUG_RE/HEX32/PRICE_* + validateAttestationInput stay as-is...

export async function readIndex(): Promise<AttestationRecord[]> {
  return getStore().getIndex();
}
export async function hasSlug(slug: string): Promise<boolean> {
  return (await readIndex()).some((r) => r.slug === slug);
}
export async function findRecord(slug: string): Promise<AttestationRecord | undefined> {
  return (await readIndex()).find((r) => r.slug === slug);
}
/** first-write-wins is enforced by the store; validate format first. */
export async function appendIndex(rec: AttestationRecord): Promise<void> {
  await getStore().addIndexRecord(rec);
}
```
Remove the old `readFileSync`/`writeFileSync`/`renameSync`/`INDEX_PATH` code from this file.

- [ ] **Step 2: Type-check the file in isolation**

Run: `pnpm build` — expect MANY errors in callers (they await nothing yet). That's expected; this task only converts this module. Confirm the errors are all "missing await / Promise used as value" in caller files, NOT inside `attestation-index.ts`. (Callers are fixed in later tasks.)

- [ ] **Step 3: Update `lib/attestation-index.test.ts`** (if it exists) — add `await` to `readIndex`/`hasSlug`/`findRecord`/`appendIndex` calls and make the test fns `async`. Run `pnpm test lib/attestation-index.test.ts` → PASS.

- [ ] **Step 4: Commit**
```bash
git add lib/attestation-index.ts lib/attestation-index.test.ts
git commit -m "refactor: attestation-index async via store"
```

---

### Task 4: `lib/payment-log.ts` → async

**Files:** Modify `lib/payment-log.ts`, Test `lib/payment-log.test.ts`

- [ ] **Step 1: Make async, delegate to store** (keep the `PaymentEntry` type export):
```ts
import { getStore } from "./store";
// keep: export type PaymentEntry = { slug: string; payer: string; amount: string; txHash: string; ts: number };

export async function readPaymentLog(): Promise<PaymentEntry[]> {
  return getStore().getPaymentLog();
}
export async function appendPaymentLog(e: PaymentEntry): Promise<boolean> {
  return getStore().addPaymentEntry(e);
}
```
Remove the old fs code.

- [ ] **Step 2: Update `lib/payment-log.test.ts`** — `await` the calls, `async` test fns. Run `pnpm test lib/payment-log.test.ts` → PASS.

- [ ] **Step 3: Commit**
```bash
git add lib/payment-log.ts lib/payment-log.test.ts
git commit -m "refactor: payment-log async via store"
```

---

### Task 5: `lib/reports.ts` → async propagation

**Files:** Modify `lib/reports.ts`, Test `lib/reports.test.ts`

- [ ] **Step 1: Make the index-reading fns async.** Each fn that calls `readIndex()` becomes `async` and `await`s it. Concretely:
  - `listPublishedReports`: `export async function listPublishedReports(): Promise<PublishedReport[]> { return (await readIndex()).filter(...).map(...); }` — note `.filter`'s predicate calls `getReportMeta` (sync) so it stays a sync predicate over the awaited array.
  - `listReaderCatalog`: `export async function listReaderCatalog() { return (await listPublishedReports()).sort(...); }`
  - `listAgentCatalog`: `await listReaderCatalog()` inside.
  - `listAuthors`: `await readIndex()` inside.
  - `getPublishedReport`: `const rec = (await readIndex()).find(...)` inside; make it `async`.
  - `getReportMeta`, `getReportBody`, `toCatalogItem`, `catalogMatches`, `formatUsdc`, `listReportSlugs` stay **sync** (they read content files / are pure).

- [ ] **Step 2: Update `lib/reports.test.ts`** — `await` every call to the now-async fns; make those `it(...)` callbacks `async`.

- [ ] **Step 3: Run**

Run: `pnpm test lib/reports.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**
```bash
git add lib/reports.ts lib/reports.test.ts
git commit -m "refactor: reports.ts async (catalog/authors read the store)"
```

---

### Task 6: `lib/leaderboard.ts` + `lib/paid-article.ts` + `lib/x402-solana-server.ts` → async; remove dead x402 resolvers

**Files:** Modify `lib/leaderboard.ts`, `lib/paid-article.ts`, `lib/x402-solana-server.ts`, `lib/x402-server.ts`. Tests: `lib/leaderboard.test.ts`, `lib/leaderboard-consistency.test.ts`, `lib/paid-article.test.ts`, `lib/x402-solana-server.test.ts`.

- [ ] **Step 1: leaderboard.** `listLeaderboard` + `getWriterStats` → `async`; `await readIndex()` and `await readPaymentLog()` inside. Inside `listLeaderboard`, the `for (const r of index)` loop calls `getReportMeta` (sync) — fine. Update both fns and their loops to use the awaited arrays.

- [ ] **Step 2: paid-article.** `getPaidArticleBody` → `async`; `const rec = await findRecord(slug)`. Other calls (`getReportMeta`, `getReportBody`, `getCompanionPaidZone`, `getCompanionPublic`) stay sync.

- [ ] **Step 3: x402-solana-server.** `solPriceForSlug` → `async`; `const rec = await findRecord(slug)`. `solPayTo`/`SOL_*`/`getSolHandler` unchanged.

- [ ] **Step 4: x402-server.** Remove `payToForSlug` and `priceUsdForSlug` (they read the index synchronously and are replaced by per-request resolution in the route — Task 7). Keep `getX402Server`, `X402_NETWORK`, `slugFromPath`. Leave a 1-line helper `export function priceUsdFromRec(rec: { priceUSDC: string }): string { return "$" + (Number(BigInt(rec.priceUSDC)) / 1e6).toFixed(2); }` for the route to format price.

- [ ] **Step 5: Update tests** — `await` calls in `leaderboard.test.ts`, `leaderboard-consistency.test.ts` (its mocked `readIndex`/`readPaymentLog` must now return Promises — change the mock factories to `readIndex: async () => [...]`, `readPaymentLog: async () => [...]`), `paid-article.test.ts`, `x402-solana-server.test.ts` (`await solPriceForSlug(...)`).

- [ ] **Step 6: Run**

Run: `pnpm test lib/leaderboard.test.ts lib/leaderboard-consistency.test.ts lib/paid-article.test.ts lib/x402-solana-server.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**
```bash
git add lib/leaderboard.ts lib/leaderboard-consistency.test.ts lib/leaderboard.test.ts lib/paid-article.ts lib/paid-article.test.ts lib/x402-solana-server.ts lib/x402-solana-server.test.ts lib/x402-server.ts
git commit -m "refactor: leaderboard/paid-article/solana-server async; drop sync x402 resolvers"
```

---

### Task 7: API routes → async; per-request x402 paywall

**Files:** Modify `app/api/v1/articles/route.ts`, `app/api/v1/articles/[slug]/route.ts`, `app/api/v1/sol/articles/[slug]/route.ts`, `app/api/v1/authors/route.ts`, `app/api/internal/attestations/route.ts`

- [ ] **Step 1: `app/api/v1/articles/[slug]/route.ts`** — resolve the record async, build the paywall per-request:
```ts
import { getX402Server, X402_NETWORK, slugFromPath, priceUsdFromRec } from "@/lib/x402-server";
import { getPaidArticleBody } from "@/lib/paid-article";
import { findRecord } from "@/lib/attestation-index";
import { appendPaymentLog } from "@/lib/payment-log";
import type { HTTPRequestContext } from "@x402/core/server";
// ...SLUG_RE, CORS unchanged...

const handler = async (req: NextRequest): Promise<NextResponse> => {
  const slug = slugFromPath(new URL(req.url).pathname);
  const rec = await findRecord(slug);
  if (rec) {
    await appendPaymentLog({ slug, payer: req.headers.get("x-payer") ?? rec.author,
      amount: rec.priceUSDC, txHash: rec.attestationUID, ts: Date.now() });
  }
  return NextResponse.json(await getPaidArticleBody(slug), { headers: CORS });
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const rec = SLUG_RE.test(slug) ? await findRecord(slug) : undefined;
  if (!rec) return NextResponse.json({ error: "not found" }, { status: 404, headers: CORS });
  const paid = withX402(
    handler,
    { accepts: { scheme: "exact", network: X402_NETWORK,
        payTo: (_ctx: HTTPRequestContext) => rec.author,
        price: (_ctx: HTTPRequestContext) => priceUsdFromRec(rec) },
      mimeType: "application/json", description: "Citely — paid article full text + companion" },
    getX402Server(),
  );
  return paid(req);
}
export function OPTIONS() { return new NextResponse(null, { status: 204, headers: CORS }); }
export const dynamic = "force-dynamic";
```

- [ ] **Step 2: `app/api/v1/sol/articles/[slug]/route.ts`** — `await` the index + price + body:
  - `if (!SLUG_RE.test(slug) || !(await findRecord(slug)))` → 404.
  - `amount: await solPriceForSlug(slug)` in `createPaymentRequirements`.
  - `getPaidArticleBody(slug)` → `await getPaidArticleBody(slug)` on the 200 path.

- [ ] **Step 3: `app/api/v1/articles/route.ts`** — `const items = await listAgentCatalog(filters)` (now async); make the GET `async` and await it.

- [ ] **Step 4: `app/api/v1/authors/route.ts`** — `await listAuthors()`.

- [ ] **Step 5: `app/api/internal/attestations/route.ts`** — `await` the async index fns: `if (await hasSlug(body.slug))` (line ~20); `await appendIndex(record)` (line ~71) inside the existing try/catch. `getReportBody` stays sync.

- [ ] **Step 6: Type-check**

Run: `pnpm build`
Expected: `✓ Compiled successfully`. Any remaining "missing await" errors point to a caller this task missed — fix it. The route table still lists all routes as `ƒ`.

- [ ] **Step 7: Commit**
```bash
git add app/api/v1/
git commit -m "refactor: API routes async + per-request x402 paywall"
```

---

### Task 8: Server components → async

**Files:** Modify `app/page.tsx`, `app/reports/page.tsx`, `app/reports/[slug]/page.tsx`

- [ ] **Step 1: `app/page.tsx`** — make `Home` async, await the three calls:
```ts
export default async function Home() {
  const readerArticles = await listReaderCatalog();
  const leaderboard = await listLeaderboard();
  const writerStats = await getWriterStats();
  // ...rest unchanged...
}
```

- [ ] **Step 2: `app/reports/page.tsx`** — `export default async function ReportsPage() { const reports = await listPublishedReports(); ... }`.

- [ ] **Step 3: `app/reports/[slug]/page.tsx`** — the component is already `async`; change `const report = getPublishedReport(slug)` → `const report = await getPublishedReport(slug)`. `getReportBody`/`previewSlice`/`getCompanionPublic` stay sync.

- [ ] **Step 4: Build + full test suite**

Run: `pnpm build` then `pnpm test`
Expected: `✓ Compiled successfully` and all tests green. If a test still calls a now-async fn without `await`, fix it.

- [ ] **Step 5: Commit**
```bash
git add app/page.tsx app/reports/
git commit -m "refactor: home + reports server components async"
```

---

### Task 9: Seed/reset through the store + remove DAO from the committed index

**Files:** Create `scripts/seed-kv.ts`; Modify `scripts/reset-demo.ts`, `package.json`, `data/attestation-index.json`

- [ ] **Step 1: Remove the DAO record from the committed index.** Edit `data/attestation-index.json`: delete the `onchain-partnership-rwa` object, leaving `yaoqian-crypto-liability` + `web3-illegal-employment`. (Keep `content/reports/onchain-partnership-rwa.{mdx,enc}` — needed to compute contentHash at import time.)

- [ ] **Step 2: `scripts/reset-demo.ts` → go through the store.** Rewrite to use the store so it works for both backends:
```ts
import { getStore } from "../lib/store";
// (load .env.local as the other scripts do)
const DAO = "onchain-partnership-rwa";
async function main() {
  const store = getStore();
  const idx = (await store.getIndex()).filter((r) => r.slug !== DAO);
  // FileStore: rewrite index file without DAO + clear payment log.
  // For RedisStore add HDEL/DEL — only needed when run against prod env.
  // ...write idx back via a store.reset() helper (add it to CitelyStore)...
}
```
Add a `reset(records: AttestationRecord[]): Promise<void>` + `clearPayments(): Promise<void>` to `CitelyStore`/both backends (FileStore: writeAtomic; RedisStore: `del` then `hsetnx` each + `del` payments). Update `lib/store.test.ts` with a reset round-trip test (RED→GREEN).

- [ ] **Step 3: `scripts/seed-kv.ts`** — write the 2 committed seed records into the store (for prod Redis), clear payments:
```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getStore } from "../lib/store";
// load .env.local
async function main() {
  const seeds = JSON.parse(readFileSync(resolve(process.cwd(), "data/attestation-index.json"), "utf8"));
  const store = getStore();
  await store.reset(seeds);     // DAO already absent from the committed file
  await store.clearPayments();
  console.log(`seeded ${seeds.length} records to`, process.env.UPSTASH_REDIS_REST_URL ? "Redis" : "file");
}
main();
```
Add to `package.json` scripts: `"seed-kv": "tsx scripts/seed-kv.ts"`.

- [ ] **Step 4: Run reset locally**

Run: `pnpm reset-demo` → prints reset; `data/attestation-index.json` keeps 2 seeds; `data/payment-log.json` becomes `[]`.

- [ ] **Step 5: Commit**
```bash
git add scripts/seed-kv.ts scripts/reset-demo.ts package.json data/attestation-index.json lib/store.ts lib/store.test.ts
git commit -m "feat: store-backed reset-demo + seed-kv; drop DAO from committed index"
```

---

### Task 10: Vercel Upstash wiring + prod verification (runbook)

Operational — needs the Vercel project. No unit tests.

- [ ] **Step 1: Add Upstash Redis on Vercel.** Vercel dashboard → project `citely` → Storage → add **Upstash Redis** (Marketplace). It injects `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (or `KV_REST_API_*`) into the project env. Confirm with `npx vercel env ls production | grep -iE "UPSTASH|KV_REST"`.

- [ ] **Step 2: Seed prod Redis.** Pull the prod env locally and run seed-kv against it:
```bash
npx vercel env pull .env.prod.local
env $(grep -E "^(UPSTASH|KV_REST)" .env.prod.local | xargs) pnpm seed-kv
rm -f .env.prod.local
```
Expected: `seeded 2 records to Redis`.

- [ ] **Step 3: Redeploy + verify the live publish loop.**
```bash
npx vercel --prod --yes
```
Then on `https://citely-nine.vercel.app`: `GET /api/v1/articles` returns the 2 seeds; do a real `/publish` of the DAO article → it appears in `/api/v1/articles` and `/reports`; a real paid read makes the home leaderboard EARNED rise. This is the spec's acceptance criterion.

- [ ] **Step 4: Record the result** (no commit) — note the publish + leaderboard worked on prod, or capture errors for debugging.

---

## Self-Review notes

- **Spec coverage:** store abstraction + both backends (Task 2), index/payment async (3,4), async propagation through reports/leaderboard/paid-article/solana + callers/components (5–8), seed-kv + reset-demo + DAO removal (9), Upstash env + prod seed + acceptance (10). `@upstash/redis` dep + env (1). RedisStore read-fail throws (getIndex propagates), payment best-effort returns false (Task 2 impl + test).
- **New since the spec (covered):** the Solana route + `paid-article.ts` + `x402-solana-server.ts` async (Task 6/7); the x402 paywall is rebuilt per-request to avoid an async resolver (Task 7).
- **Type consistency:** `getStore()`/`CitelyStore` (Task 2) used by `attestation-index`/`payment-log` (3,4) and scripts (9); `priceUsdFromRec` defined in Task 6 (x402-server) and used in Task 7 (route).
- **Risk:** async-propagation misses are caught by `pnpm build` (Task 7/8 Step verifies). `leaderboard-consistency.test.ts` mocks must return Promises (Task 6 Step 5).
