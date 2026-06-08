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

  it("includes the public 〔C〕 starter prompts (title + prompt each)", () => {
    const b = getPaidArticleBody("yaoqian-crypto-liability");
    expect(Array.isArray(b.starterPrompts)).toBe(true);
    expect(b.starterPrompts.length).toBeGreaterThanOrEqual(1);
    expect(b.starterPrompts[0].title.length).toBeGreaterThan(0);
    expect(b.starterPrompts[0].prompt.length).toBeGreaterThan(0);
  });
});
