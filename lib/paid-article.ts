import { getReportBody, getReportMeta } from "./reports";
import { getCompanionPaidZone, getCompanionPublic, type StarterPrompt } from "./companions";
import { findRecord } from "./attestation-index";

export type PaidArticleBody = {
  slug: string;
  title: string;
  content: string;
  companion: string; // paid 〔A〕 zone: 原文 / 术语表 / 误区表
  starterPrompts: StarterPrompt[]; // public 〔C〕 reader starter prompts
  citation: { author: string; attestationUID: string; publishedAt: string };
};

/** The shared paid 200 body — identical shape on both the Base and Solana lanes. */
export async function getPaidArticleBody(slug: string): Promise<PaidArticleBody> {
  const meta = getReportMeta(slug);
  const rec = await findRecord(slug);
  if (!rec) throw new Error(`no published record for ${slug}`);
  return {
    slug,
    title: meta.title,
    content: getReportBody(slug),
    companion: getCompanionPaidZone(slug),
    starterPrompts: getCompanionPublic(slug).starterPrompts,
    citation: { author: meta.authorName, attestationUID: rec.attestationUID, publishedAt: meta.publishedAt },
  };
}
