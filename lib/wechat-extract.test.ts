import { describe, it, expect } from "vitest";
import { normalizeDate, rewriteImageSrcs } from "./wechat-extract";

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
