import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeDate, rewriteImageSrcs, extractArticle } from "./wechat-extract";

const html = readFileSync(resolve(__dirname, "../test/fixtures/wechat/sample.html"), "utf8");

describe("normalizeDate", () => {
  it("parses WeChat Chinese date to ISO", () => {
    expect(normalizeDate("2026年02月06日 13:47")).toBe("2026-02-06");
  });
  it("pads single-digit month/day", () => {
    expect(normalizeDate("2026年2月6日")).toBe("2026-02-06");
  });
  it("returns empty string when no date", () => {
    expect(normalizeDate("无日期")).toBe("");
  });
});

describe("rewriteImageSrcs", () => {
  it("rewrites mapped image URLs and leaves unmapped ones", () => {
    const md = "![](https://a.png)\n![alt](https://b.jpg)";
    const out = rewriteImageSrcs(md, { "https://a.png": "/reports/x/img-1.png" });
    expect(out).toBe("![](/reports/x/img-1.png)\n![alt](https://b.jpg)");
  });
});

describe("extractArticle", () => {
  const a = extractArticle(html);

  it("extracts title, authorOrg, publishedAt", () => {
    expect(a.title).toBe("测试标题：链上风险报告");
    expect(a.authorOrg).toBe("Web3风险官");
    expect(a.publishedAt).toBe("2026-02-06");
  });
  it("drops chrome (qr code, 关注 widget, script, mpvoice)", () => {
    expect(a.markdown).not.toContain("扫码关注");
    expect(a.markdown).not.toContain("微信扫一扫");
    expect(a.markdown).not.toContain("var x");
    expect(a.markdown).not.toContain("语音组件");
  });
  it("preserves structure: blockquote, list, table", () => {
    expect(a.markdown).toContain("> 这是一段引用");
    expect(a.markdown).toMatch(/[-*] 列表项一/);
    expect(a.markdown).toContain("| 列 | 值 |");
  });
  it("materializes data-src images and collects URLs in order", () => {
    expect(a.imageUrls).toEqual([
      "https://mmbiz.qpic.cn/pic_a.png",
      "https://mmbiz.qpic.cn/pic_b.jpg",
    ]);
  });
});
