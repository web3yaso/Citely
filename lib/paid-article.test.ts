import { describe, it, expect } from "vitest";
import { getPaidArticleBody } from "./paid-article";

describe("getPaidArticleBody", () => {
  it("returns slug/title/content/companion/citation for a seeded slug", () => {
    const b = getPaidArticleBody("yaoqian-crypto-liability");
    expect(b.slug).toBe("yaoqian-crypto-liability");
    expect(typeof b.title).toBe("string");
    expect(b.content.length).toBeGreaterThan(100);
    expect(b.companion.length).toBeGreaterThan(0);
    expect(b.citation.author).toBeTruthy();
    expect(b.citation.attestationUID).toMatch(/^0x[0-9a-f]+$/i);
    expect(b.citation.publishedAt).toBeTruthy();
  });
});
