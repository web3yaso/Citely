import { describe, it, expect } from "vitest";
import { buildArticleFiles } from "./article-download";
import type { ArticlePaid } from "./x402-client";

const sample: ArticlePaid = {
  slug: "yaoqian-crypto-liability",
  title: "从姚前案说起",
  content: "# 正文标题\n\n这是报告全文内容。",
  companion: "### A1. 文章原文\n\n### A2. 术语表\n\n### A3. 误区表",
  starterPrompts: [
    { title: "看懂主线", prompt: "用这个配套包讲清主线。" },
    { title: "套到我的角色", prompt: "我这些动作还能不能做？" },
  ],
  citation: {
    author: "Web3风险官",
    attestationUID: "0xabc123",
    publishedAt: "2026-02-01",
  },
};

describe("buildArticleFiles", () => {
  it("derives the three file names from the slug", () => {
    const files = buildArticleFiles(sample);
    expect(files.zipName).toBe("citely-yaoqian-crypto-liability.zip");
    expect(files.reportName).toBe("yaoqian-crypto-liability.md");
    expect(files.companionName).toBe("yaoqian-crypto-liability-companion.md");
    expect(files.promptsName).toBe("yaoqian-crypto-liability-prompts.md");
  });

  it("puts the citation fields and the article body in the report file", () => {
    const { reportMd } = buildArticleFiles(sample);
    expect(reportMd).toContain("Web3风险官");
    expect(reportMd).toContain("0xabc123");
    expect(reportMd).toContain("2026-02-01");
    expect(reportMd).toContain("这是报告全文内容。");
  });

  it("puts the paid companion (原文/术语表/误区表) in the companion file", () => {
    const { companionMd } = buildArticleFiles(sample);
    expect(companionMd).toContain("A1. 文章原文");
    expect(companionMd).toContain("A2. 术语表");
    expect(companionMd).toContain("A3. 误区表");
  });

  it("puts the REAL 〔C〕 starter prompts (title + prompt) in the prompts file", () => {
    const { promptsMd } = buildArticleFiles(sample);
    expect(promptsMd).toContain("看懂主线");
    expect(promptsMd).toContain("用这个配套包讲清主线。");
    expect(promptsMd).toContain("套到我的角色");
    expect(promptsMd).toContain("我这些动作还能不能做？");
    // it must NOT be the companion content (that goes in the companion file)
    expect(promptsMd).not.toContain("A1. 文章原文");
  });
});
