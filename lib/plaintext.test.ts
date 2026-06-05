import { describe, it, expect } from "vitest";
import matter from "gray-matter";
import { buildPlaintext } from "./plaintext";

describe("buildPlaintext", () => {
  it("emits frontmatter with auto fields + placeholders and the body", () => {
    const out = buildPlaintext(
      { slug: "x", title: "标题", authorOrg: "Org", publishedAt: "2026-02-06", sourceUrl: "https://mp.weixin.qq.com/s/abc" },
      "正文内容",
    );
    const { data, content } = matter(out);
    expect(data.slug).toBe("x");
    expect(data.title).toBe("标题");
    expect(data.authorOrg).toBe("Org");
    expect(data.publishedAt).toBe("2026-02-06");
    expect(data.sourceUrl).toBe("https://mp.weixin.qq.com/s/abc");
    expect(data.authorName).toBe("TODO");
    expect(data.tags).toEqual(["TODO"]);
    expect(data.summary).toBe("TODO");
    expect(content.trim()).toBe("正文内容");
  });
});
