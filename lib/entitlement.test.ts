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
