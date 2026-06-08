import { describe, it, expect, vi } from "vitest";

// Controlled IO: index has ONE article (slug "a", author A); the payment log has
// two payments for "a" plus one ORPHAN payment for a slug no longer in the index
// (e.g. an article removed by reset-demo). The orphan must not inflate the totals.
vi.mock("./payment-log", () => ({
  readPaymentLog: () => [
    { slug: "a", amount: "300000", payer: "0x", txHash: "0x", ts: 1 },
    { slug: "a", amount: "300000", payer: "0x", txHash: "0x", ts: 2 },
    { slug: "removed", amount: "300000", payer: "0x", txHash: "0x", ts: 3 },
  ],
}));
vi.mock("./attestation-index", () => ({
  readIndex: () => [{ slug: "a", priceUSDC: "300000" }],
}));
vi.mock("./reports", () => ({
  getReportMeta: (slug: string) => {
    if (slug === "a") return { authorName: "Author A", authorOrg: "Org", tags: ["t"] };
    throw new Error(`no report ${slug}`);
  },
}));

import { listLeaderboard, getWriterStats } from "./leaderboard";

const cents = (s: string) => Math.round(Number(s.replace(/[$,]/g, "")) * 100);

describe("leaderboard ↔ writer-stats consistency", () => {
  it("excludes orphaned payments so the total equals the per-author breakdown", () => {
    const stats = getWriterStats();
    const rows = listLeaderboard();
    const sumRows = rows.reduce((acc, r) => acc + cents(r.earned), 0);

    expect(cents(stats.totalEarned)).toBe(sumRows); // total == sum of rows
    expect(stats.totalEarned).toBe("$0.60"); // 2 × $0.30 for "a"; orphan excluded
    expect(stats.totalPurchased).toBe(2); // 2 resolvable payments, not 3
  });
});
