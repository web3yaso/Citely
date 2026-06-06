import { NextRequest, NextResponse } from "next/server";
import {
  getSolHandler,
  solPriceForSlug,
  SOL_USDC_MINT,
  SOL_USDC_DECIMALS,
} from "@/lib/x402-solana-server";
import { getPaidArticleBody } from "@/lib/paid-article";
import { findRecord } from "@/lib/attestation-index";

const SLUG_RE = /^[a-z0-9-]{1,80}$/;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  // slug whitelist BEFORE the paywall — invalid/unpublished → 404, never a 402.
  if (!SLUG_RE.test(slug) || !findRecord(slug)) {
    return NextResponse.json({ error: "not found" }, { status: 404, headers: CORS });
  }

  const x402 = getSolHandler();
  const resourceUrl = new URL(req.url).toString();
  const requirements = await x402.createPaymentRequirements(
    {
      amount: solPriceForSlug(slug),
      asset: { address: SOL_USDC_MINT, decimals: SOL_USDC_DECIMALS },
      description: `Citely — paid article (Solana): ${slug}`,
    },
    resourceUrl,
  );

  const paymentHeader = x402.extractPayment(req.headers);
  if (!paymentHeader) {
    const r = x402.create402Response(requirements, resourceUrl);
    return NextResponse.json(r.body, { status: r.status, headers: CORS });
  }

  const verified = await x402.verifyPayment(paymentHeader, requirements);
  if (!verified.isValid) {
    return NextResponse.json(
      { error: "invalid payment", reason: verified.invalidReason },
      { status: 402, headers: CORS },
    );
  }

  const settled = await x402.settlePayment(paymentHeader, requirements);
  if (!settled.success) {
    return NextResponse.json(
      { error: "settlement failed", reason: settled.errorReason },
      { status: 402, headers: CORS },
    );
  }
  return NextResponse.json(getPaidArticleBody(slug), { headers: CORS });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export const dynamic = "force-dynamic";
