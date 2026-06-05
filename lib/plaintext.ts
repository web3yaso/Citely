import matter from "gray-matter";

export type PlaintextFrontmatter = {
  slug: string;
  title: string;
  authorOrg: string;
  publishedAt: string;
  sourceUrl: string;
};

export function buildPlaintext(fm: PlaintextFrontmatter, body: string): string {
  const data = {
    title: fm.title,
    slug: fm.slug,
    authorName: "TODO",
    authorOrg: fm.authorOrg,
    tags: ["TODO"],
    summary: "TODO",
    publishedAt: fm.publishedAt,
    sourceUrl: fm.sourceUrl,
  };
  return matter.stringify("\n" + body.trim() + "\n", data);
}
