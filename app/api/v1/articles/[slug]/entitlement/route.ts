import { NextRequest, NextResponse } from "next/server";
import { findRecord } from "@/lib/attestation-index";
import { getPaidArticleBody } from "@/lib/paid-article";
import { verifyEntitlement, type EntitlementFailureReason } from "@/lib/entitlement";

const SLUG_RE = /^[a-z0-9-]{1,80}$/;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};
// Exhaustive: a renamed/added reason in entitlement.ts becomes a compile error here.
const REASON_CN: Record<EntitlementFailureReason, string> = {
  bad_signature: "签名验证失败,请重试",
  slug_mismatch: "验证信息不匹配",
  expired: "验证已过期,请重新验证",
  not_paid: "该钱包未购买本文,请先付费解锁",
};

/**
 * Free entitlement endpoint (issue #12): a returning paid reader proves ownership
 * by signing buildEntitlementMessage(). On success returns the SAME full JSON as
 * the paid 200 — no payment, no localStorage. Human-reading lane only.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const rec = SLUG_RE.test(slug) ? await findRecord(slug) : undefined;
  if (!rec) {
    return NextResponse.json({ error: "not found" }, { status: 404, headers: CORS });
  }

  let body: { message?: unknown; signature?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求无效" }, { status: 400, headers: CORS });
  }
  const { message, signature } = body;
  if (typeof message !== "string" || typeof signature !== "string" || !signature.startsWith("0x")) {
    return NextResponse.json({ error: "请求无效" }, { status: 400, headers: CORS });
  }

  const result = await verifyEntitlement({ slug, message, signature: signature as `0x${string}` });
  if (!result.ok) {
    return NextResponse.json({ error: REASON_CN[result.reason] }, { status: 403, headers: CORS });
  }
  return NextResponse.json(await getPaidArticleBody(slug), { headers: CORS });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export const dynamic = "force-dynamic";
