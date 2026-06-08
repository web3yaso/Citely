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
  it("reset replaces the index and clearPayments empties the log", async () => {
    await s.addIndexRecord(rec("a"));
    await s.addPaymentEntry(pay("a"));
    await s.reset([rec("b"), rec("c")]);
    await s.clearPayments();
    expect((await s.getIndex()).map((r) => r.slug)).toEqual(["b", "c"]);
    expect((await s.getPaymentLog()).length).toBe(0);
  });
});

describe("RedisStore", () => {
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
      async del(key: string) { const had = hashes.delete(key); lists.delete(key); return had ? 1 : 0; },
    };
  }
  it("HSETNX gives first-write-wins; HGETALL round-trips", async () => {
    const s = new RedisStore(fakeRedis() as any);
    await s.addIndexRecord(rec("a"));
    await expect(s.addIndexRecord(rec("a"))).rejects.toThrow(/already published/i);
    expect((await s.getIndex()).map((r) => r.slug)).toEqual(["a"]);
  });
  it("reset + clearPayments via redis", async () => {
    const s = new RedisStore(fakeRedis() as any);
    await s.addIndexRecord(rec("a"));
    await s.reset([rec("b")]);
    expect((await s.getIndex()).map((r) => r.slug)).toEqual(["b"]);
  });
  it("addPaymentEntry returns false when redis throws", async () => {
    const bad = { rpush: async () => { throw new Error("down"); } } as any;
    expect(await new RedisStore(bad).addPaymentEntry(pay("a"))).toBe(false);
  });
});
