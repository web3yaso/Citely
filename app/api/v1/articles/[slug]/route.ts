import { NextRequest, NextResponse } from "next/server";
import { withX402 } from "@x402/next";
import {
  getX402Server,
  X402_NETWORK,
  slugFromPath,
  priceUsdFromRec,
} from "@/lib/x402-server";
import { getPaidArticleBody } from "@/lib/paid-article";
import { findRecord } from "@/lib/attestation-index";
import { appendPaymentLog } from "@/lib/payment-log";
import type { HTTPRequestContext } from "@x402/core/server";

const SLUG_RE = /^[a-z0-9-]{1,80}$/;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

const handler = async (req: NextRequest): Promise<NextResponse> => {
  const slug = slugFromPath(new URL(req.url).pathname);
  const rec = await findRecord(slug);
  // Handler only runs after the facilitator verified payment → log it (for the leaderboard, Phase 5).
  if (rec) {
    await appendPaymentLog({
      slug,
      payer: req.headers.get("x-payer") ?? rec.author,
      amount: rec.priceUSDC,
      txHash: rec.attestationUID,
      ts: Date.now(),
    });
  }
  // Shared body (full text + companion + 〔C〕 starter prompts + citation) — same on both lanes.
  return NextResponse.json(await getPaidArticleBody(slug), { headers: CORS });
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  // §8.4: slug whitelist BEFORE the paywall. Invalid/unpublished → 404, never a 402 paywall.
  const rec = SLUG_RE.test(slug) ? await findRecord(slug) : undefined;
  if (!rec) {
    return NextResponse.json({ error: "not found" }, { status: 404, headers: CORS });
  }
  // Build the paywall per-request with sync closures over the already-resolved record
  // (the x402 accepts resolver must be sync; the record is fetched async above).
  const paid = withX402(
    handler,
    {
      accepts: {
        scheme: "exact",
        network: X402_NETWORK,
        payTo: (_ctx: HTTPRequestContext) => rec.author,
        price: (_ctx: HTTPRequestContext) => priceUsdFromRec(rec),
      },
      mimeType: "application/json",
      description: "Citely — paid article full text + companion",
    },
    getX402Server(),
  );
  return paid(req);
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export const dynamic = "force-dynamic";
