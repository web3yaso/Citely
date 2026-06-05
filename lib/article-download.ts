/**
 * article-download.ts
 *
 * After a human reader pays to unlock an article, auto-download a zip with the
 * full report and its companion prompts. See
 * docs/superpowers/specs/2026-06-04-auto-download-after-payment-design.md.
 *
 * `buildArticleFiles` is pure (unit-tested). `downloadArticleZip` is the
 * browser side-effect (fflate.zipSync + a temporary <a download>), best-effort
 * — a blocked/failed download is intentionally not recoverable (no button).
 */
import { zipSync, strToU8 } from "fflate";
import { normalizeMarkdown } from "./markdown";
import type { ArticlePaid } from "./x402-client";

const EAS_EXPLORER = "https://base-sepolia.easscan.org/attestation/view/";

export function buildArticleFiles(full: ArticlePaid): {
  reportMd: string;
  promptsMd: string;
  zipName: string;
  reportName: string;
  promptsName: string;
} {
  const { slug, title, content, companion, citation } = full;

  const reportMd =
    `# ${title}\n\n` +
    `> 作者：${citation.author}\n` +
    `> EAS attestation：${citation.attestationUID}\n` +
    `> 发布日期：${citation.publishedAt}\n` +
    `> 链上出处：${EAS_EXPLORER}${citation.attestationUID}\n` +
    `>\n` +
    `> 正文经显示层清洗，便于阅读；其字节与链上 contentHash 不一致，` +
    `如需校验哈希请使用链上原文。\n\n` +
    `---\n\n` +
    `${normalizeMarkdown(content, { title })}\n`;

  const promptsMd =
    `# ${title} · 配套 Prompts\n\n` +
    `> 作者：${citation.author} · EAS：${citation.attestationUID}\n\n` +
    `---\n\n` +
    `${companion}\n`;

  return {
    reportMd,
    promptsMd,
    zipName: `citely-${slug}.zip`,
    reportName: `${slug}.md`,
    promptsName: `${slug}-prompts.md`,
  };
}

export function downloadArticleZip(full: ArticlePaid): void {
  try {
    const { reportMd, promptsMd, zipName, reportName, promptsName } =
      buildArticleFiles(full);
    const zipped = zipSync({
      [reportName]: strToU8(reportMd),
      [promptsName]: strToU8(promptsMd),
    });
    // Copy into a fresh ArrayBuffer-backed Uint8Array for Blob (avoids SAB typing).
    const blob = new Blob([new Uint8Array(zipped)], { type: "application/zip" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = zipName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch {
    // best-effort: a blocked/failed download is intentionally not recovered.
  }
}
