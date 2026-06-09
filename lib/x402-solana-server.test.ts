import { describe, it, expect, afterEach } from "vitest";
import { solPriceForSlug, solPayTo, SOL_NETWORK, SOL_USDC_MINT } from "./x402-solana-server";

describe("solPriceForSlug", () => {
  it("returns the index priceUSDC (atomic units) for a seeded slug", async () => {
    expect(await solPriceForSlug("yaoqian-crypto-liability")).toBe("300000");
    expect(await solPriceForSlug("web3-illegal-employment")).toBe("250000");
  });
  it("throws for an unknown slug", async () => {
    await expect(solPriceForSlug("nope")).rejects.toThrow(/no published record/i);
  });
});

describe("solPayTo", () => {
  const saved = process.env.SOL_PAYTO;
  afterEach(() => { process.env.SOL_PAYTO = saved; });
  it("returns the configured devnet address", () => {
    process.env.SOL_PAYTO = "6bMe95k9itoYTvef4mE9rCDw1K11BgzMmZxgvjjkoH9s";
    expect(solPayTo()).toBe("6bMe95k9itoYTvef4mE9rCDw1K11BgzMmZxgvjjkoH9s");
  });
  it("throws when SOL_PAYTO is unset", () => {
    delete process.env.SOL_PAYTO;
    expect(() => solPayTo()).toThrow(/SOL_PAYTO/);
  });
});

describe("constants", () => {
  it("targets solana-devnet + devnet USDC-SPL mint", () => {
    expect(SOL_NETWORK).toBe("solana-devnet");
    expect(SOL_USDC_MINT).toBe("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
  });
});
