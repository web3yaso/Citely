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
