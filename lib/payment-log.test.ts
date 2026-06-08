import { vi, describe, it, expect } from "vitest";

// The write path now lives in the store (FileStore). Simulate a read-only
// serverless FS by making the store's addPaymentEntry fail (returns false),
// while reads still return an array. (Previously this mocked node:fs.writeFileSync,
// but the destructured named import inside store.ts isn't intercepted by that mock.)
vi.mock("./store", () => ({
  getStore: () => ({
    getPaymentLog: async () => [],
    addPaymentEntry: async () => false,
  }),
}));

import { readPaymentLog, appendPaymentLog } from "./payment-log";

describe("readPaymentLog", () => {
  it("returns an array", async () => {
    expect(Array.isArray(await readPaymentLog())).toBe(true);
  });
});

describe("appendPaymentLog (best-effort)", () => {
  const entry = { slug: "x", payer: "0x0", amount: "1", txHash: "0x0", ts: 1 };

  it("does not throw and returns false when the write fails (read-only fs, e.g. Vercel)", async () => {
    // A settled paid unlock must still return content even if logging can't persist.
    await expect(appendPaymentLog(entry)).resolves.not.toThrow();
    expect(await appendPaymentLog(entry)).toBe(false);
  });
});
