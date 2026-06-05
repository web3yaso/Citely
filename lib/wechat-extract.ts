import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

export type ExtractedArticle = {
  title: string;
  authorOrg: string;
  publishedAt: string;
  markdown: string;
  imageUrls: string[];
};

const CHROME_SELECTORS = [
  "script", "style", "noscript",
  "#js_pc_qr_code", ".qr_code_pc_outer", ".qr_code_pc",
  "#js_profile_qrcode", ".profile_container",
  "#js_sponsor_ad_area", ".reward_area", "#js_reward_area",
  "mpvoice", "qqmusic", "mp-common-product", "mpcps",
];

function toMarkdown(html: string): string {
  const td = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
  });
  td.use(gfm);
  // Turndown pads list markers (e.g. "-   item") to align with the marker
  // width; the rest of the pipeline (and tests) expect a single space after
  // the bullet, so emit "- item" / "1. item" instead.
  td.addRule("singleSpaceListItem", {
    filter: "li",
    replacement(content, node, options) {
      const text = content
        .replace(/^\n+/, "")
        .replace(/\n+$/, "\n")
        .replace(/\n/gm, "\n    ");
      const parent = node.parentNode as HTMLElement;
      let prefix = options.bulletListMarker + " ";
      if (parent && parent.nodeName === "OL") {
        const start = parent.getAttribute("start");
        const index = Array.prototype.indexOf.call(parent.children, node);
        prefix = (start ? Number(start) + index : index + 1) + ". ";
      }
      return (
        prefix +
        text +
        (node.nextSibling && !/\n$/.test(text) ? "\n" : "")
      );
    },
  });
  return td.turndown(html).trim();
}

export function extractArticle(html: string): ExtractedArticle {
  const dom = new JSDOM(html);
  const doc = dom.window.document;

  const ogTitle = doc.querySelector('meta[property="og:title"]')?.getAttribute("content") ?? "";
  const ogSite = doc.querySelector('meta[property="og:site_name"]')?.getAttribute("content") ?? "";
  const title = ogTitle || doc.querySelector("#activity-name")?.textContent?.trim() ||
    doc.querySelector("h1")?.textContent?.trim() || "";
  const authorOrg = ogSite || doc.querySelector("#js_name")?.textContent?.trim() || "";
  const publishedAt = normalizeDate(doc.querySelector("#publish_time")?.textContent?.trim() || "");

  let contentHtml: string;
  const wechat = doc.querySelector("#js_content");
  if (wechat) {
    CHROME_SELECTORS.forEach((sel) => wechat.querySelectorAll(sel).forEach((el) => el.remove()));
    wechat.querySelectorAll("img").forEach((img) => {
      const lazy = img.getAttribute("data-src");
      if (lazy && !img.getAttribute("src")) img.setAttribute("src", lazy);
    });
    contentHtml = wechat.innerHTML;
  } else {
    const parsed = new Readability(doc).parse();
    contentHtml = parsed?.content ?? doc.body.innerHTML;
  }

  const markdown = toMarkdown(contentHtml);
  const imageUrls = [...markdown.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)].map((m) => m[1]);
  return { title, authorOrg, publishedAt, markdown, imageUrls };
}

export function normalizeDate(s: string): string {
  const m = s.match(/(\d{4})[年\-/.](\d{1,2})[月\-/.](\d{1,2})/);
  if (!m) return "";
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

export function rewriteImageSrcs(markdown: string, mapping: Record<string, string>): string {
  return markdown.replace(
    /(!\[[^\]]*\]\()([^)\s]+)/g,
    (full, pre, url) => (mapping[url] ? pre + mapping[url] : full),
  );
}
