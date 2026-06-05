import { describe, it, expect } from "vitest";
import { buildArticleFiles } from "./article-download";
import type { ArticlePaid } from "./x402-client";

const sample: ArticlePaid = {
  slug: "yaoqian-crypto-liability",
  title: "从姚前案说起",
  content: "# 正文标题\n\n这是报告全文内容。",
  companion: "## 〔C〕配套 prompts\n\n> 用这个配套包讲清主线。",
  citation: {
    author: "Web3风险官",
    attestationUID: "0xabc123",
    publishedAt: "2026-02-01",
  },
};

describe("buildArticleFiles", () => {
  it("derives file names from the slug", () => {
    const files = buildArticleFiles(sample);
    expect(files.zipName).toBe("citely-yaoqian-crypto-liability.zip");
    expect(files.reportName).toBe("yaoqian-crypto-liability.md");
    expect(files.promptsName).toBe("yaoqian-crypto-liability-prompts.md");
  });

  it("puts the citation fields and the article body in the report file", () => {
    const { reportMd } = buildArticleFiles(sample);
    expect(reportMd).toContain("Web3风险官");
    expect(reportMd).toContain("0xabc123");
    expect(reportMd).toContain("2026-02-01");
    expect(reportMd).toContain("这是报告全文内容。");
  });

  it("puts the companion text in the prompts file", () => {
    const { promptsMd } = buildArticleFiles(sample);
    expect(promptsMd).toContain("用这个配套包讲清主线。");
  });
});
