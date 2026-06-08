import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import matter from "gray-matter";
import { decryptContent } from "./content-crypto";
import { readIndex, type AttestationRecord } from "./attestation-index";

const REPORTS_DIR = resolve(process.cwd(), "content/reports");
const SLUG_RE = /^[a-z0-9-]{1,80}$/;

export type ReportMeta = {
  slug: string;
  title: string;
  authorName: string;
  authorOrg?: string;
  tags: string[];
  summary: string;
  publishedAt: string;
  sourceUrl?: string;
};

function assertSlug(slug: string): void {
  if (!SLUG_RE.test(slug)) throw new Error(`invalid slug: ${slug}`);
}

export function listReportSlugs(): string[] {
  return readdirSync(REPORTS_DIR)
    .filter((f) => f.endsWith(".mdx"))
    .map((f) => f.replace(/\.mdx$/, ""))
    .filter((s) => SLUG_RE.test(s));
}

export function getReportMeta(slug: string): ReportMeta {
  assertSlug(slug);
  const file = resolve(REPORTS_DIR, `${slug}.mdx`);
  if (!existsSync(file)) throw new Error(`report not found: ${slug}`);
  const { data } = matter(readFileSync(file, "utf8"));
  return { slug, ...(data as Omit<ReportMeta, "slug">) };
}

/** Decrypts the body server-side. Requires CONTENT_ENC_KEY. Never call from client code. */
export function getReportBody(slug: string): string {
  assertSlug(slug);
  const key = process.env.CONTENT_ENC_KEY;
  if (!key) throw new Error("CONTENT_ENC_KEY not set");
  const file = resolve(REPORTS_DIR, `${slug}.enc`);
  if (!existsSync(file)) throw new Error(`encrypted body not found: ${slug}`);
  return decryptContent(readFileSync(file, "utf8"), key);
}

export type PublishedReport = {
  meta: ReportMeta;
  record: AttestationRecord;
  priceUsd: string; // formatted "$0.30"
};

function formatUsdc(priceUSDC: string): string {
  return "$" + (Number(BigInt(priceUSDC)) / 1e6).toFixed(2);
}

/** Reports that have an on-chain attestation recorded in the index. */
export async function listPublishedReports(): Promise<PublishedReport[]> {
  return (await readIndex())
    .filter((r) => { try { getReportMeta(r.slug); return true; } catch { return false; } })
    .map((r) => ({ meta: getReportMeta(r.slug), record: r, priceUsd: formatUsdc(r.priceUSDC) }));
}

/** The home "收录文章" catalog: every published report, newest first. No hardcoded
 *  exclusions — a freshly published article (e.g. the /publish import example) appears
 *  here as soon as it lands in the index, matching the /reports page. */
export async function listReaderCatalog(): Promise<PublishedReport[]> {
  return (await listPublishedReports()).sort((a, b) =>
    a.meta.publishedAt < b.meta.publishedAt ? 1 : a.meta.publishedAt > b.meta.publishedAt ? -1 : 0,
  );
}

/** Public, agent-facing catalog item — metadata only, never the article body. */
export type CatalogItem = {
  slug: string;
  title: string;
  summary: string;
  author: string;
  authorOrg?: string;
  tags: string[];
  price: string;        // "$0.30"
  priceUSDC: string;    // "300000" (base units)
  publishedAt: string;
  attestationUID: string;
  read: string;         // paid endpoint path to fetch this article, e.g. "/api/v1/articles/<slug>"
};

/** Project a published report to the public catalog shape (no `content`). */
export function toCatalogItem(r: PublishedReport): CatalogItem {
  return {
    slug: r.meta.slug,
    title: r.meta.title,
    summary: r.meta.summary,
    author: r.meta.authorName,
    authorOrg: r.meta.authorOrg,
    tags: r.meta.tags,
    price: r.priceUsd,
    priceUSDC: r.record.priceUSDC,
    publishedAt: r.meta.publishedAt,
    attestationUID: r.record.attestationUID,
    read: `/api/v1/articles/${r.meta.slug}`,
  };
}

/** Case-insensitive substring match over title / summary / author / org / tags. */
export function catalogMatches(item: CatalogItem, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const hay = [item.title, item.summary, item.author, item.authorOrg, ...item.tags]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(needle);
}

export type CatalogFilters = {
  q?: string;       // free-text over title/summary/author/org/tags
  tag?: string;     // substring match on any tag
  author?: string;  // substring match on author name or org
};

/** The agent-facing catalog (GET /api/v1/articles): published reports, newest
 *  first, metadata only, narrowed by any combination of q / tag / author (AND). */
export async function listAgentCatalog(filters: CatalogFilters = {}): Promise<CatalogItem[]> {
  const q = filters.q?.trim();
  const tag = filters.tag?.trim().toLowerCase();
  const author = filters.author?.trim().toLowerCase();
  let items = (await listReaderCatalog()).map(toCatalogItem);
  if (q) items = items.filter((i) => catalogMatches(i, q));
  if (tag) items = items.filter((i) => i.tags.some((t) => t.toLowerCase().includes(tag)));
  if (author)
    items = items.filter(
      (i) => i.author.toLowerCase().includes(author) || (i.authorOrg ?? "").toLowerCase().includes(author),
    );
  return items;
}

/** Public, agent-facing author summary derived from the published catalog. Grouped
 *  by author name (not on-chain address, per the leaderboard convention) — never the
 *  body, never the payout address. */
export type AuthorSummary = {
  name: string;
  org?: string;
  articleCount: number;
  tags: string[]; // deduped union of tags across this author's published articles
  articles: { slug: string; title: string; read: string }[];
};

/** The agent-facing authors list (GET /api/v1/authors): every author with at least
 *  one published article, grouped by name, most articles first then name. Derived from
 *  the same published catalog as /api/v1/articles, so it stays in sync. */
export async function listAuthors(): Promise<AuthorSummary[]> {
  const byName = new Map<string, AuthorSummary>();
  for (const item of await listAgentCatalog()) {
    const cur = byName.get(item.author) ?? {
      name: item.author,
      org: item.authorOrg,
      articleCount: 0,
      tags: [],
      articles: [],
    };
    cur.articleCount += 1;
    cur.articles.push({ slug: item.slug, title: item.title, read: item.read });
    for (const t of item.tags) if (!cur.tags.includes(t)) cur.tags.push(t);
    byName.set(item.author, cur);
  }
  return [...byName.values()].sort(
    (a, b) => b.articleCount - a.articleCount || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );
}

/** A single published report, or null if the slug is not published (not in the index). */
export async function getPublishedReport(slug: string): Promise<PublishedReport | null> {
  const rec = (await readIndex()).find((r) => r.slug === slug);
  if (!rec) return null;
  let meta: ReportMeta;
  try { meta = getReportMeta(slug); } catch { return null; }
  return { meta, record: rec, priceUsd: formatUsdc(rec.priceUSDC) };
}
