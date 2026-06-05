/**
 * Ingest a WeChat (or generic) article URL into a committable plaintext source:
 *   scripts/ingest-wechat.ts <url> <slug>
 *     -> downloads images to public/reports/<slug>/img-N.<ext>
 *     -> writes content/reports/_plaintext/<slug>.md (frontmatter + clean body)
 * Then fill the TODO frontmatter and run scripts/encrypt-content.ts <slug>.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, extname } from "node:path";
import { chromium } from "playwright";
import { extractArticle, rewriteImageSrcs } from "../lib/wechat-extract";
import { buildPlaintext } from "../lib/plaintext";

const url = process.argv[2];
const slug = process.argv[3];
if (!url || !slug || !/^[a-z0-9-]{1,80}$/.test(slug)) {
  throw new Error("usage: ingest-wechat <url> <slug:[a-z0-9-]>");
}
const root = resolve(__dirname, "..");

async function fetchRenderedHtml(target: string): Promise<string> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    });
    await page.goto(target, { waitUntil: "networkidle", timeout: 60000 });
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1500);
    return await page.content();
  } finally {
    await browser.close();
  }
}

function extFromUrl(u: string): string {
  const e = extname(new URL(u).pathname).toLowerCase();
  return /^\.(png|jpe?g|gif|webp)$/.test(e) ? e : ".png";
}

async function rehostImages(markdown: string, imageUrls: string[]): Promise<string> {
  if (imageUrls.length === 0) return markdown;
  const dir = resolve(root, `public/reports/${slug}`);
  mkdirSync(dir, { recursive: true });
  const mapping: Record<string, string> = {};
  let i = 0;
  for (const u of imageUrls) {
    i += 1;
    const name = `img-${i}${extFromUrl(u)}`;
    try {
      const res = await fetch(u, { headers: { referer: "https://mp.weixin.qq.com/" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      writeFileSync(resolve(dir, name), buf);
      mapping[u] = `/reports/${slug}/${name}`;
      console.log(`  image ${i}: ${u} -> ${mapping[u]}`);
    } catch (e) {
      console.warn(`  image ${i} SKIPPED (${(e as Error).message}): ${u}`);
    }
  }
  return rewriteImageSrcs(markdown, mapping);
}

async function main() {
  console.log(`fetching ${url} ...`);
  const html = await fetchRenderedHtml(url);
  const article = extractArticle(html);
  console.log(`extracted "${article.title}" (${article.imageUrls.length} images)`);
  const body = await rehostImages(article.markdown, article.imageUrls);
  const out = buildPlaintext(
    { slug, title: article.title, authorOrg: article.authorOrg, publishedAt: article.publishedAt, sourceUrl: url },
    body,
  );
  const dest = resolve(root, `content/reports/_plaintext/${slug}.md`);
  mkdirSync(resolve(root, "content/reports/_plaintext"), { recursive: true });
  writeFileSync(dest, out);
  console.log(`wrote ${dest}\nNext: fill TODO frontmatter, then: pnpm tsx scripts/encrypt-content.ts ${slug}`);
}

main();
