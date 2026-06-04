import { NextResponse } from "next/server";
import { listAuthors } from "@/lib/reports";

// Free, public discovery endpoint: an agent lists the published authors (derived
// from the on-chain attestation index, grouped by name) here, then fetches a
// specific author's articles via each item's `read` path under /api/v1/articles/.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

export async function GET() {
  const authors = listAuthors();
  return NextResponse.json({ count: authors.length, authors }, { headers: CORS });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

// Reads the attestation index per request (newly published articles show up live).
export const dynamic = "force-dynamic";
