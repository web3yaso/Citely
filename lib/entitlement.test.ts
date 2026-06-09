import { vi, describe, it, expect, beforeEach } from "vitest";
import { privateKeyToAccount } from "viem/accounts";

const paymentLog = vi.hoisted(() => ({ entries: [] as { slug: string; payer: string; amount: string; txHash: string; ts: number }[] }));
vi.mock("./payment-log", () => ({
  readPaymentLog: async () => paymentLog.entries,
  appendPaymentLog: async () => true,
}));

import { buildEntitlementMessage, parseEntitlementMessage, hasPaidFor, verifyEntitlement } from "./entitlement";

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

  it("bad_signature when the message is validly signed but not a Citely entitlement message", async () => {
    const message = "hello from some other app";
    const signature = await account.signMessage({ message });
    const res = await verifyEntitlement({ slug: SLUG, message, signature });
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
