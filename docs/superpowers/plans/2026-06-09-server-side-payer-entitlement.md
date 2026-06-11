# Server-Side Payer Entitlement Implementation Plan (issue #12)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the browser `localStorage` full-text unlock cache with server-side payer verification — a paid reader re-reads by signing a wallet message (SIWE-style) that the server verifies against the payment log, and the full text is never persisted in the browser.

**Architecture:** (1) Capture the *real* payer by decoding the `X-PAYMENT` request header in the paid handler (today it wrongly logs the author). (2) A new `lib/entitlement.ts` builds/parses a signed message and checks `verifyEntitlement` against the payment log. (3) A new free `POST /api/v1/articles/[slug]/entitlement` returns the full article JSON when the signer has paid. (4) `UnlockGate` drops the localStorage cache and gains a "验证解锁" button that signs + calls the endpoint. Base human-reading lane only; agent/Solana lanes untouched.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, viem (`recoverMessageAddress`, `privateKeyToAccount`), Vitest (+ jsdom + Testing Library), `@x402/*`.

**Spec:** `docs/superpowers/specs/2026-06-09-server-side-payer-entitlement-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/x402-payer.ts` (create) | Decode `X-PAYMENT` → real payer address |
| `lib/x402-payer.test.ts` (create) | Unit tests for the decode |
| `app/api/v1/articles/[slug]/route.ts` (modify) | Log the real payer instead of author fallback |
| `lib/entitlement.ts` (create) | `buildEntitlementMessage` / `parseEntitlementMessage` / `hasPaidFor` / `verifyEntitlement` |
| `lib/entitlement.test.ts` (create) | Unit tests (real viem signatures, mocked payment log) |
| `app/api/v1/articles/[slug]/entitlement/route.ts` (create) | Free POST endpoint → full JSON on verified entitlement |
| `app/api/v1/articles/[slug]/entitlement/route.test.ts` (create) | Route tests (200 / 403 / 400) |
| `components/reports/UnlockGate.tsx` (modify) | Remove localStorage cache; add verify-unlock flow |
| `components/reports/UnlockGate.test.tsx` (create) | Regression: legacy cache is ignored; verify control present |
| `public/SKILL.md`, `public/openapi.json`, `DEPLOY.md` (modify) | Document the entitlement endpoint + persistence note |

Key facts already verified in this codebase:
- `X-PAYMENT` header = `base64(JSON.stringify(paymentPayload))`; payer is at `payload.authorization.from` (exact-evm, lowercased via `getAddress` server-side).
- `PaymentEntry = { slug, payer, amount, txHash, ts }` (`lib/payment-log.ts`); `readPaymentLog()` is async and store-backed.
- `getPaidArticleBody(slug)` (`lib/paid-article.ts`) returns the shared paid JSON and works in tests (`.env.local` loaded by `vitest.setup.ts`, content decrypts).
- Tests mock the store/payment-log by `vi.mock` (see `lib/payment-log.test.ts`).
- `UnlockGate` is shared by `HumanUnlockGate` and `AgentUnlockGate`; both inherit these changes.

---

## Task 1: `lib/x402-payer.ts` — decode the real payer from X-PAYMENT

**Files:**
- Create: `lib/x402-payer.ts`
- Test: `lib/x402-payer.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/x402-payer.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { payerFromXPayment } from "./x402-payer";

/** Build a base64 X-PAYMENT header like the x402 client sends (exact-evm). */
function xPaymentHeader(from: string): string {
  const payload = {
    x402Version: 1,
    scheme: "exact",
    network: "eip155:84532",
    payload: {
      signature: "0xsig",
      authorization: { from, to: "0xto", value: "300000", validAfter: "0", validBefore: "9", nonce: "0x00" },
    },
  };
  return Buffer.from(JSON.stringify(payload), "utf-8").toString("base64");
}

describe("payerFromXPayment", () => {
  it("decodes the exact-evm payer (lowercased) from the X-PAYMENT header", () => {
    const req = new Request("http://x", {
      headers: { "X-PAYMENT": xPaymentHeader("0xAbC0000000000000000000000000000000000123") },
    });
    expect(payerFromXPayment(req)).toBe("0xabc0000000000000000000000000000000000123");
  });

  it("returns null when the header is missing", () => {
    expect(payerFromXPayment(new Request("http://x"))).toBeNull();
  });

  it("returns null on garbage / non-JSON payloads", () => {
    const req = new Request("http://x", { headers: { "X-PAYMENT": "@@not-base64-json@@" } });
    expect(payerFromXPayment(req)).toBeNull();
  });

  it("returns null when authorization.from is absent", () => {
    const b64 = Buffer.from(JSON.stringify({ payload: {} }), "utf-8").toString("base64");
    const req = new Request("http://x", { headers: { "X-PAYMENT": b64 } });
    expect(payerFromXPayment(req)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run lib/x402-payer.test.ts`
Expected: FAIL — `payerFromXPayment` is not exported / module not found.

- [ ] **Step 3: Write the minimal implementation**

Create `lib/x402-payer.ts`:

```ts
/**
 * x402-payer.ts
 *
 * Recover the real paying wallet from the `X-PAYMENT` request header. The header
 * is base64(JSON) of the x402 PaymentPayload; for the exact-EVM scheme the payer
 * is `payload.authorization.from`. The handler runs AFTER x402 verified the
 * payment, so this address is trustworthy. Returns a lowercased 0x address, or
 * null when the header is absent/unparseable.
 */
export function payerFromXPayment(req: Request): string | null {
  const header = req.headers.get("X-PAYMENT");
  if (!header) return null;
  try {
    const decoded = JSON.parse(Buffer.from(header, "base64").toString("utf-8"));
    const from = decoded?.payload?.authorization?.from;
    if (typeof from === "string" && /^0x[0-9a-fA-F]{40}$/.test(from)) {
      return from.toLowerCase();
    }
    return null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run lib/x402-payer.test.ts`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add lib/x402-payer.ts lib/x402-payer.test.ts
git commit -m "feat: payerFromXPayment — decode real payer from X-PAYMENT header (#12)"
```

---

## Task 2: Log the real payer in the paid article handler

**Files:**
- Modify: `app/api/v1/articles/[slug]/route.ts` (imports + handler payer line)

No new unit test: the only logic (decoding) is covered by Task 1; this is a one-line wiring change verified by typecheck. (Route-level behavior is exercised by manual e2e at the end.)

- [ ] **Step 1: Add the import**

In `app/api/v1/articles/[slug]/route.ts`, add to the imports near the top (after the `@/lib/payment-log` import):

```ts
import { payerFromXPayment } from "@/lib/x402-payer";
```

- [ ] **Step 2: Use the real payer in the log entry**

Replace this line inside `handler` (currently line ~28):

```ts
      payer: req.headers.get("x-payer") ?? rec.author,
```

with:

```ts
      payer: payerFromXPayment(req) ?? rec.author,
```

- [ ] **Step 3: Verify typecheck/build passes**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/v1/articles/[slug]/route.ts
git commit -m "fix: record the real payer (X-PAYMENT) in the payment log, not the author (#12)"
```

---

## Task 3: `lib/entitlement.ts` — build & parse the signed message

**Files:**
- Create: `lib/entitlement.ts`
- Test: `lib/entitlement.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/entitlement.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildEntitlementMessage, parseEntitlementMessage } from "./entitlement";

describe("buildEntitlementMessage / parseEntitlementMessage", () => {
  const issuedAt = Date.parse("2026-06-09T00:00:00.000Z");
  const msg = buildEntitlementMessage("yaoqian-crypto-liability", "0xAbc123", issuedAt, "nonce-1");

  it("includes slug, address, time and nonce lines", () => {
    expect(msg).toContain("文章: yaoqian-crypto-liability");
    expect(msg).toContain("地址: 0xAbc123");
    expect(msg).toContain("nonce: nonce-1");
    expect(msg).toContain("时间: 2026-06-09T00:00:00.000Z");
  });

  it("round-trips slug and issuedAt", () => {
    expect(parseEntitlementMessage(msg)).toEqual({ slug: "yaoqian-crypto-liability", issuedAt });
  });

  it("returns null for a malformed message", () => {
    expect(parseEntitlementMessage("not a citely message")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run lib/entitlement.test.ts`
Expected: FAIL — module/exports not found.

- [ ] **Step 3: Write the minimal implementation**

Create `lib/entitlement.ts` with just the message helpers for now:

```ts
/**
 * entitlement.ts
 *
 * Server-side "has this wallet paid for this article?" check (issue #12). A
 * returning reader signs a short message; the server recovers the address and
 * matches it against the payment log. Replaces the browser localStorage cache —
 * no full text is persisted client-side.
 */

const SLUG_PREFIX = "文章: ";
const TIME_PREFIX = "时间: ";

/** The exact text the wallet signs. issuedAt is epoch ms; stored as ISO. */
export function buildEntitlementMessage(
  slug: string,
  address: string,
  issuedAt: number,
  nonce: string,
): string {
  return [
    "Citely 阅读验证",
    `${SLUG_PREFIX}${slug}`,
    `地址: ${address}`,
    `${TIME_PREFIX}${new Date(issuedAt).toISOString()}`,
    `nonce: ${nonce}`,
  ].join("\n");
}

/** Read back slug + issuedAt (ms) from a signed message; null if malformed. */
export function parseEntitlementMessage(message: string): { slug: string; issuedAt: number } | null {
  const lines = message.split("\n");
  const slugLine = lines.find((l) => l.startsWith(SLUG_PREFIX));
  const timeLine = lines.find((l) => l.startsWith(TIME_PREFIX));
  if (!slugLine || !timeLine) return null;
  const slug = slugLine.slice(SLUG_PREFIX.length).trim();
  const issuedAt = Date.parse(timeLine.slice(TIME_PREFIX.length).trim());
  if (!slug || Number.isNaN(issuedAt)) return null;
  return { slug, issuedAt };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run lib/entitlement.test.ts`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add lib/entitlement.ts lib/entitlement.test.ts
git commit -m "feat: entitlement message build/parse helpers (#12)"
```

---

## Task 4: `hasPaidFor` — match payer against the payment log

**Files:**
- Modify: `lib/entitlement.ts` (add `hasPaidFor`)
- Modify: `lib/entitlement.test.ts` (add `hasPaidFor` tests + payment-log mock)

- [ ] **Step 1: Write the failing test**

At the TOP of `lib/entitlement.test.ts` (before the existing imports), add a hoisted mock of the payment log, and add a new describe block. The full file becomes:

```ts
import { vi, describe, it, expect, beforeEach } from "vitest";

const paymentLog = vi.hoisted(() => ({ entries: [] as { slug: string; payer: string; amount: string; txHash: string; ts: number }[] }));
vi.mock("./payment-log", () => ({
  readPaymentLog: async () => paymentLog.entries,
  appendPaymentLog: async () => true,
}));

import { buildEntitlementMessage, parseEntitlementMessage, hasPaidFor } from "./entitlement";

beforeEach(() => {
  paymentLog.entries = [];
});

describe("buildEntitlementMessage / parseEntitlementMessage", () => {
  const issuedAt = Date.parse("2026-06-09T00:00:00.000Z");
  const msg = buildEntitlementMessage("yaoqian-crypto-liability", "0xAbc123", issuedAt, "nonce-1");

  it("includes slug, address, time and nonce lines", () => {
    expect(msg).toContain("文章: yaoqian-crypto-liability");
    expect(msg).toContain("地址: 0xAbc123");
    expect(msg).toContain("nonce: nonce-1");
    expect(msg).toContain("时间: 2026-06-09T00:00:00.000Z");
  });

  it("round-trips slug and issuedAt", () => {
    expect(parseEntitlementMessage(msg)).toEqual({ slug: "yaoqian-crypto-liability", issuedAt });
  });

  it("returns null for a malformed message", () => {
    expect(parseEntitlementMessage("not a citely message")).toBeNull();
  });
});

describe("hasPaidFor", () => {
  it("matches slug + payer case-insensitively", async () => {
    paymentLog.entries = [
      { slug: "s", payer: "0xABCdef0000000000000000000000000000000001", amount: "1", txHash: "0x0", ts: 1 },
    ];
    expect(await hasPaidFor("s", "0xabcdef0000000000000000000000000000000001")).toBe(true);
    expect(await hasPaidFor("s", "0x0000000000000000000000000000000000000002")).toBe(false);
    expect(await hasPaidFor("other-slug", "0xABCdef0000000000000000000000000000000001")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run lib/entitlement.test.ts`
Expected: FAIL — `hasPaidFor` is not exported.

- [ ] **Step 3: Add the implementation**

In `lib/entitlement.ts`, add at the top (after the file header comment):

```ts
import { readPaymentLog } from "./payment-log";
```

and add this function below `parseEntitlementMessage`:

```ts
/** True if `address` appears as the payer for `slug` in the payment log. */
export async function hasPaidFor(slug: string, address: string): Promise<boolean> {
  const addr = address.toLowerCase();
  const log = await readPaymentLog();
  return log.some((e) => e.slug === slug && e.payer.toLowerCase() === addr);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run lib/entitlement.test.ts`
Expected: PASS (4/4 — 3 message + 1 hasPaidFor).

- [ ] **Step 5: Commit**

```bash
git add lib/entitlement.ts lib/entitlement.test.ts
git commit -m "feat: hasPaidFor — match payer+slug in the payment log (#12)"
```

---

## Task 5: `verifyEntitlement` — recover signer, validate, check payment

**Files:**
- Modify: `lib/entitlement.ts` (add `verifyEntitlement` + types)
- Modify: `lib/entitlement.test.ts` (add `verifyEntitlement` tests with real viem signatures)

- [ ] **Step 1: Write the failing test**

Append to `lib/entitlement.test.ts`. First add this import at the top with the other imports:

```ts
import { privateKeyToAccount } from "viem/accounts";
```

Then add this describe block at the end of the file:

```ts
describe("verifyEntitlement", () => {
  // Well-known anvil/hardhat test key #0 — deterministic, not a real fund.
  const account = privateKeyToAccount(
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  );
  const SLUG = "yaoqian-crypto-liability";

  async function signFor(slug: string, issuedAt: number) {
    const message = buildEntitlementMessage(slug, account.address, issuedAt, "n1");
    const signature = await account.signMessage({ message });
    return { message, signature };
  }

  it("ok when signature valid, slug matches, fresh, and the signer has paid", async () => {
    // payer stored upper-cased to prove case-insensitive match
    paymentLog.entries = [{ slug: SLUG, payer: account.address.toUpperCase(), amount: "300000", txHash: "0x0", ts: 1 }];
    const { message, signature } = await signFor(SLUG, Date.now());
    expect(await verifyEntitlement({ slug: SLUG, message, signature })).toEqual({
      ok: true,
      address: account.address.toLowerCase(),
    });
  });

  it("bad_signature when the signature is invalid", async () => {
    const { message } = await signFor(SLUG, Date.now());
    const res = await verifyEntitlement({ slug: SLUG, message, signature: "0x00" });
    expect(res).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("slug_mismatch when the signed slug differs from the requested slug", async () => {
    paymentLog.entries = [{ slug: SLUG, payer: account.address, amount: "1", txHash: "0x0", ts: 1 }];
    const { message, signature } = await signFor("some-other-article", Date.now());
    const res = await verifyEntitlement({ slug: SLUG, message, signature });
    expect(res).toEqual({ ok: false, reason: "slug_mismatch" });
  });

  it("expired when the message is older than 5 minutes", async () => {
    paymentLog.entries = [{ slug: SLUG, payer: account.address, amount: "1", txHash: "0x0", ts: 1 }];
    const { message, signature } = await signFor(SLUG, Date.now() - 6 * 60 * 1000);
    const res = await verifyEntitlement({ slug: SLUG, message, signature });
    expect(res).toEqual({ ok: false, reason: "expired" });
  });

  it("not_paid when the signer has no payment record for the slug", async () => {
    const { message, signature } = await signFor(SLUG, Date.now());
    const res = await verifyEntitlement({ slug: SLUG, message, signature });
    expect(res).toEqual({ ok: false, reason: "not_paid" });
  });
});
```

Also add `verifyEntitlement` to the existing top import line so it reads:

```ts
import { buildEntitlementMessage, parseEntitlementMessage, hasPaidFor, verifyEntitlement } from "./entitlement";
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run lib/entitlement.test.ts`
Expected: FAIL — `verifyEntitlement` is not exported.

- [ ] **Step 3: Add the implementation**

In `lib/entitlement.ts`, add `recoverMessageAddress` to a viem import at the top:

```ts
import { recoverMessageAddress } from "viem";
```

Add the result type near the top (after the imports):

```ts
export type EntitlementResult =
  | { ok: true; address: string }
  | { ok: false; reason: "bad_signature" | "slug_mismatch" | "expired" | "not_paid" };

const MAX_AGE_MS = 5 * 60 * 1000;
const FUTURE_SKEW_MS = 60 * 1000;
```

Add the function at the end of the file:

```ts
/**
 * Verify a signed entitlement request: recover the signer, confirm the message
 * targets this slug and is recent (≤5min, small future skew allowed), then check
 * the payment log. Replay window is bounded by the timestamp; a server-issued
 * nonce store is intentionally out of scope (see spec).
 */
export async function verifyEntitlement(input: {
  slug: string;
  message: string;
  signature: `0x${string}`;
}): Promise<EntitlementResult> {
  let recovered: string;
  try {
    recovered = (await recoverMessageAddress({ message: input.message, signature: input.signature })).toLowerCase();
  } catch {
    return { ok: false, reason: "bad_signature" };
  }
  const parsed = parseEntitlementMessage(input.message);
  if (!parsed || parsed.slug !== input.slug) return { ok: false, reason: "slug_mismatch" };
  const age = Date.now() - parsed.issuedAt;
  if (age > MAX_AGE_MS || age < -FUTURE_SKEW_MS) return { ok: false, reason: "expired" };
  if (!(await hasPaidFor(input.slug, recovered))) return { ok: false, reason: "not_paid" };
  return { ok: true, address: recovered };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run lib/entitlement.test.ts`
Expected: PASS (9/9).

- [ ] **Step 5: Commit**

```bash
git add lib/entitlement.ts lib/entitlement.test.ts
git commit -m "feat: verifyEntitlement — recover signer + validate + payment check (#12)"
```

---

## Task 6: Free entitlement endpoint `POST /api/v1/articles/[slug]/entitlement`

**Files:**
- Create: `app/api/v1/articles/[slug]/entitlement/route.ts`
- Test: `app/api/v1/articles/[slug]/entitlement/route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/api/v1/articles/[slug]/entitlement/route.test.ts`:

```ts
import { vi, describe, it, expect, beforeEach } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { NextRequest } from "next/server";

const paymentLog = vi.hoisted(() => ({ entries: [] as { slug: string; payer: string; amount: string; txHash: string; ts: number }[] }));
vi.mock("@/lib/payment-log", () => ({
  readPaymentLog: async () => paymentLog.entries,
  appendPaymentLog: async () => true,
}));

import { POST } from "./route";
import { buildEntitlementMessage } from "@/lib/entitlement";

const account = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);
const SLUG = "yaoqian-crypto-liability"; // a seeded, published article in data/attestation-index.json

function postReq(bodyObj: unknown) {
  return new NextRequest(`http://localhost/api/v1/articles/${SLUG}/entitlement`, {
    method: "POST",
    body: JSON.stringify(bodyObj),
    headers: { "content-type": "application/json" },
  });
}
const params = Promise.resolve({ slug: SLUG });

beforeEach(() => {
  paymentLog.entries = [];
});

describe("POST /api/v1/articles/[slug]/entitlement", () => {
  it("returns 200 with the full article JSON when the signer has paid", async () => {
    paymentLog.entries = [{ slug: SLUG, payer: account.address, amount: "300000", txHash: "0x0", ts: 1 }];
    const message = buildEntitlementMessage(SLUG, account.address, Date.now(), "n1");
    const signature = await account.signMessage({ message });
    const res = await POST(postReq({ message, signature }), { params });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.slug).toBe(SLUG);
    expect(json.content.length).toBeGreaterThan(100);
  });

  it("returns 403 when the signer has not paid", async () => {
    const message = buildEntitlementMessage(SLUG, account.address, Date.now(), "n1");
    const signature = await account.signMessage({ message });
    const res = await POST(postReq({ message, signature }), { params });
    expect(res.status).toBe(403);
  });

  it("returns 400 when body fields are missing", async () => {
    const res = await POST(postReq({}), { params });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run "app/api/v1/articles/[slug]/entitlement/route.test.ts"`
Expected: FAIL — `./route` has no `POST` export / module not found.

- [ ] **Step 3: Write the implementation**

Create `app/api/v1/articles/[slug]/entitlement/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { findRecord } from "@/lib/attestation-index";
import { getPaidArticleBody } from "@/lib/paid-article";
import { verifyEntitlement } from "@/lib/entitlement";

const SLUG_RE = /^[a-z0-9-]{1,80}$/;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};
const REASON_CN: Record<string, string> = {
  bad_signature: "签名验证失败,请重试",
  slug_mismatch: "验证信息不匹配",
  expired: "验证已过期,请重新验证",
  not_paid: "该钱包未购买本文,请先付费解锁",
};

/**
 * Free entitlement endpoint (issue #12): a returning paid reader proves ownership
 * by signing buildEntitlementMessage(). On success returns the SAME full JSON as
 * the paid 200 — no payment, no localStorage. Human-reading lane only.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const rec = SLUG_RE.test(slug) ? await findRecord(slug) : undefined;
  if (!rec) {
    return NextResponse.json({ error: "not found" }, { status: 404, headers: CORS });
  }

  let body: { message?: unknown; signature?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求无效" }, { status: 400, headers: CORS });
  }
  const { message, signature } = body;
  if (typeof message !== "string" || typeof signature !== "string" || !signature.startsWith("0x")) {
    return NextResponse.json({ error: "请求无效" }, { status: 400, headers: CORS });
  }

  const result = await verifyEntitlement({ slug, message, signature: signature as `0x${string}` });
  if (!result.ok) {
    return NextResponse.json({ error: REASON_CN[result.reason] }, { status: 403, headers: CORS });
  }
  return NextResponse.json(await getPaidArticleBody(slug), { headers: CORS });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export const dynamic = "force-dynamic";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run "app/api/v1/articles/[slug]/entitlement/route.test.ts"`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add "app/api/v1/articles/[slug]/entitlement/route.ts" "app/api/v1/articles/[slug]/entitlement/route.test.ts"
git commit -m "feat: free entitlement endpoint — full JSON on verified payer (#12)"
```

---

## Task 7: `UnlockGate` — drop localStorage cache, add verify-unlock

**Files:**
- Modify: `components/reports/UnlockGate.tsx`
- Test: `components/reports/UnlockGate.test.tsx`

The full wallet sign→pay round-trip is validated by manual e2e (Phase: Verify below); the unit tests lock the two behaviors that matter for #12: a planted legacy cache must NOT unlock, and the verify control must be present.

- [ ] **Step 1: Write the failing test**

Create `components/reports/UnlockGate.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { UnlockGate } from "./UnlockGate";
import type { ArticlePaid } from "@/lib/x402-client";

// Disconnected wallet: render path needs no viem/signing.
vi.mock("wagmi", () => ({
  useAccount: () => ({ isConnected: false, address: undefined, connector: undefined }),
  useConnect: () => ({ connect: vi.fn() }),
}));
vi.mock("wagmi/connectors", () => ({ injected: () => ({}) }));

const SLUG = "yaoqian-crypto-liability";
const renderFull = (full: ArticlePaid) => <div>{full.content}</div>;

beforeEach(() => {
  localStorage.clear();
});

describe("UnlockGate (#12 — no client-side full-text cache)", () => {
  it("ignores any legacy localStorage cache — full text is never restored from the browser", () => {
    localStorage.setItem(
      `citely_unlocked_${SLUG}`,
      JSON.stringify({ slug: SLUG, title: "t", content: "LEAKED-FULL-TEXT", companion: "", starterPrompts: [], citation: { author: "a", attestationUID: "0x0", publishedAt: "2026" } }),
    );
    render(<UnlockGate slug={SLUG} priceUsd="$0.30" preview={<div>PREVIEW-ONLY</div>} renderFull={renderFull} />);
    expect(screen.queryByText("LEAKED-FULL-TEXT")).not.toBeInTheDocument();
    expect(screen.getByText("PREVIEW-ONLY")).toBeInTheDocument();
  });

  it("offers a verify-unlock action for returning paid readers", () => {
    render(<UnlockGate slug={SLUG} priceUsd="$0.30" preview={<div>PREVIEW-ONLY</div>} renderFull={renderFull} />);
    expect(screen.getByRole("button", { name: /验证解锁/ })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run components/reports/UnlockGate.test.tsx`
Expected: FAIL — the legacy cache test fails (current code restores from cache and shows "LEAKED-FULL-TEXT"), and there is no "验证解锁" button.

- [ ] **Step 3: Rewrite `UnlockGate.tsx`**

Replace the entire contents of `components/reports/UnlockGate.tsx` with:

```tsx
"use client";
import { useState } from "react";
import { useAccount, useConnect } from "wagmi";
import { injected } from "wagmi/connectors";
import { createWalletClient, custom, type EIP1193Provider } from "viem";
import { baseSepolia } from "viem/chains";
import { unlockArticle, type ArticlePaid } from "@/lib/x402-client";
import { buildEntitlementMessage } from "@/lib/entitlement";

export function UnlockGate({
  slug,
  priceUsd,
  preview,
  renderFull,
  ctaClassName,
  onUnlocked,
}: {
  slug: string;
  priceUsd: string;
  preview: React.ReactNode;
  renderFull: (full: ArticlePaid) => React.ReactNode;
  ctaClassName?: string;
  /** Fired once on PAYMENT success only — NOT on verify-unlock. Human path passes the auto-download here. */
  onUnlocked?: (full: ArticlePaid) => void;
}) {
  const { isConnected, address, connector } = useAccount();
  const { connect } = useConnect();
  const [full, setFull] = useState<ArticlePaid | null>(null);
  const [status, setStatus] = useState<"idle" | "paying" | "verifying" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);

  // Build a wallet client on-demand from the live connector provider (avoids the
  // reactive useWalletClient() hook lagging after cookie reconnect).
  async function getWalletClient() {
    const provider = (await connector!.getProvider()) as EIP1193Provider;
    return createWalletClient({ account: address!, chain: baseSepolia, transport: custom(provider) });
  }

  async function onUnlock() {
    setErr(null);
    if (!isConnected || !address || !connector?.getProvider) {
      connect({ connector: injected({ target: "metaMask" }) });
      return;
    }
    setStatus("paying");
    try {
      const data = await unlockArticle(await getWalletClient(), slug);
      setFull(data); // in-memory only — never persisted to localStorage (#12)
      setStatus("idle");
      onUnlocked?.(data);
    } catch (e) {
      setErr((e as Error).message ?? "unlock failed");
      setStatus("error");
    }
  }

  // Returning paid reader: prove ownership by signing, server checks the payment log.
  async function onVerify() {
    setErr(null);
    if (!isConnected || !address || !connector?.getProvider) {
      connect({ connector: injected({ target: "metaMask" }) });
      return;
    }
    setStatus("verifying");
    try {
      const walletClient = await getWalletClient();
      const message = buildEntitlementMessage(slug, address, Date.now(), crypto.randomUUID());
      const signature = await walletClient.signMessage({ account: address, message });
      const res = await fetch(`/api/v1/articles/${slug}/entitlement`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, signature }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `验证失败 (${res.status})`);
      }
      setFull((await res.json()) as ArticlePaid); // in-memory only; no download on re-read
      setStatus("idle");
    } catch (e) {
      setErr((e as Error).message ?? "verify failed");
      setStatus("error");
    }
  }

  if (full) return <>{renderFull(full)}</>;
  const busy = status === "paying" || status === "verifying";
  return (
    <>
      {preview}
      <div style={{ marginTop: 14 }}>
        <button className={ctaClassName ?? "pw-cta"} onClick={onUnlock} disabled={busy}>
          {status === "paying"
            ? "付款中…"
            : !isConnected
            ? `连接钱包付 ${priceUsd} 解锁全文`
            : `用钱包付 ${priceUsd} 解锁全文`}
        </button>
        <button
          className="pw-verify"
          onClick={onVerify}
          disabled={busy}
          style={{ marginLeft: 12, background: "none", border: "none", color: "var(--ink-mute)", cursor: "pointer", textDecoration: "underline" }}
        >
          {status === "verifying" ? "验证中…" : "已付过费?验证解锁"}
        </button>
        {err && (
          <p className="pw-fine" style={{ color: "var(--crimson)" }}>
            {err}
          </p>
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run components/reports/UnlockGate.test.tsx`
Expected: PASS (2/2). The button name `已付过费?验证解锁` matches `/验证解锁/`.

- [ ] **Step 5: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add components/reports/UnlockGate.tsx components/reports/UnlockGate.test.tsx
git commit -m "feat: UnlockGate drops localStorage cache, adds verify-unlock (#12)"
```

---

## Task 8: Document the entitlement endpoint

**Files:**
- Modify: `public/openapi.json` (add the path)
- Modify: `public/SKILL.md` (note the endpoint)
- Modify: `DEPLOY.md` (persistence dependency note)

- [ ] **Step 1: Read the current files to find insertion points**

Run: `pnpm exec sed -n '1,40p' public/openapi.json` and skim `public/SKILL.md`, `DEPLOY.md`. (Read enough to locate the `paths` object and the relevant sections.)

- [ ] **Step 2: Add the OpenAPI path**

In `public/openapi.json`, inside the top-level `"paths"` object, add this entry (mind the trailing comma on the preceding entry):

```json
"/api/v1/articles/{slug}/entitlement": {
  "post": {
    "summary": "Re-unlock a previously paid article by signing a wallet message (no payment).",
    "description": "Free. A returning reader who already paid proves ownership with a wallet signature; the server recovers the address, checks the payment log, and returns the same full article JSON as the paid 200. Human-reading lane.",
    "parameters": [
      { "name": "slug", "in": "path", "required": true, "schema": { "type": "string" } }
    ],
    "requestBody": {
      "required": true,
      "content": {
        "application/json": {
          "schema": {
            "type": "object",
            "required": ["message", "signature"],
            "properties": {
              "message": { "type": "string", "description": "Output of buildEntitlementMessage: lines 文章/地址/时间(ISO)/nonce." },
              "signature": { "type": "string", "description": "personal_sign of message by the paying wallet." }
            }
          }
        }
      }
    },
    "responses": {
      "200": { "description": "Full article JSON (slug, title, content, companion, starterPrompts, citation)." },
      "400": { "description": "Missing/invalid body." },
      "403": { "description": "bad_signature / slug_mismatch / expired / not_paid." },
      "404": { "description": "Unknown or unpublished slug." }
    }
  }
}
```

- [ ] **Step 3: Note it in SKILL.md**

In `public/SKILL.md`, under the section that lists the article endpoints, add a short bullet:

```markdown
- `POST /api/v1/articles/{slug}/entitlement` (free) — re-unlock an article you already paid for by signing a short wallet message (`buildEntitlementMessage`: 文章/地址/时间/nonce). The server recovers the signer, checks the payment log, and returns the full article JSON. This is for the human web reader (replaces a browser-side cache); agents normally just re-pay or keep the JSON they fetched.
```

- [ ] **Step 4: Note the persistence dependency in DEPLOY.md**

In `DEPLOY.md`, near the existing payment-log/KV note, add:

```markdown
> **Entitlement (#12):** re-reading a paid article verifies the signer against the **payment log**, so durable payment-log persistence (KV/Redis in prod) is required for re-unlock to work across requests. `appendPaymentLog` is best-effort — if a settlement's log write fails, that reader still got the content on first payment but won't be able to re-unlock until they pay again.
```

- [ ] **Step 5: Validate JSON + commit**

Run: `pnpm exec node -e "JSON.parse(require('node:fs').readFileSync('public/openapi.json','utf8')); console.log('openapi.json OK')"`
Expected: `openapi.json OK`

```bash
git add public/openapi.json public/SKILL.md DEPLOY.md
git commit -m "docs: document the entitlement endpoint + persistence note (#12)"
```

---

## Phase: Verify (after all tasks)

- [ ] **Full test suite:** `pnpm test` — all green (new files + no regressions).
- [ ] **Build/typecheck:** `pnpm build` — succeeds.
- [ ] **Manual e2e (local, `pnpm dev`):**
  1. Open a seeded article in a fresh browser (no localStorage). Confirm the paywall + preview show, plus the "已付过费?验证解锁" button.
  2. Pay with a reader wallet (Base Sepolia, not the author). Confirm full text renders and (human gate) the zip downloads.
  3. Reload the page. Confirm full text is GONE (paywall again) — no localStorage restore.
  4. Click "验证解锁", sign the message. Confirm full text returns via the entitlement endpoint and NO second download.
  5. In DevTools → Application → Local Storage, confirm there is no `citely_unlocked_*` key with article content.
  6. With a different wallet that never paid, click "验证解锁" → expect "该钱包未购买本文,请先付费解锁".
- [ ] **Final review:** dispatch the final code reviewer for the whole change set, then use `superpowers:finishing-a-development-branch`.

---

## Self-Review (against the spec)

**Spec coverage:**
- ① payer 捕获 → Task 1 (`payerFromXPayment`) + Task 2 (wiring). ✓
- ② entitlement (`buildEntitlementMessage`/`hasPaidFor`/`verifyEntitlement`, 5-min window, nonce) → Tasks 3–5. ✓
- ③ free endpoint `POST …/entitlement` (CORS, 404/400/403/200) → Task 6. ✓
- ④ UnlockGate (remove cache, verify button, onUnlocked payment-only) → Task 7. ✓
- 防重放/错误处理/测试 → Task 5 (age + reasons), Task 6 (REASON_CN), tests throughout. ✓
- 文档 (SKILL.md/openapi.json/DEPLOY.md) → Task 8. ✓
- Out of scope honored: Solana/agent paid lanes untouched; payer fix is shared infra. ✓

**Type consistency:** `ArticlePaid` (x402-client) used in UnlockGate; `PaymentEntry` shape reused in test fixtures; `EntitlementResult` reasons (`bad_signature|slug_mismatch|expired|not_paid`) match `REASON_CN` keys and Task 5 tests; `buildEntitlementMessage(slug,address,issuedAt,nonce)` signature identical across Tasks 3/5/6/7. ✓

**Placeholder scan:** none — every code step has complete code and exact commands. ✓
