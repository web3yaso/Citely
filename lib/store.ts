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
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Redis } = require("@upstash/redis") as typeof import("@upstash/redis");
    _store = new RedisStore(new Redis({ url, token }) as unknown as RedisLike);
  } else {
    _store = new FileStore();
  }
  return _store;
}
