import { vi, describe, it, expect, beforeEach } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { NextRequest } from "next/server";

const paymentLog = vi.hoisted(() => ({ entries: [] as { slug: string; payer: string; amount: string; txHash: string; ts: number }[] }));
vi.mock("@/lib/payment-log", () => ({
  readPaymentLog: async () => paymentLog.entries,
  appendPaymentLog: async () => true,
}));

import { POST } from "./route";
import { buildEntitlementMessage } from "@/lib/entitlement";

const account = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);
const SLUG = "yaoqian-crypto-liability"; // a seeded, published article in data/attestation-index.json

function postReq(bodyObj: unknown) {
  return new NextRequest(`http://localhost/api/v1/articles/${SLUG}/entitlement`, {
    method: "POST",
    body: JSON.stringify(bodyObj),
    headers: { "content-type": "application/json" },
  });
}
const params = Promise.resolve({ slug: SLUG });

beforeEach(() => {
  paymentLog.entries = [];
});

describe("POST /api/v1/articles/[slug]/entitlement", () => {
  it("returns 200 with the full article JSON when the signer has paid", async () => {
    paymentLog.entries = [{ slug: SLUG, payer: account.address, amount: "300000", txHash: "0x0", ts: 1 }];
    const message = buildEntitlementMessage(SLUG, account.address, Date.now(), "n1");
    const signature = await account.signMessage({ message });
    const res = await POST(postReq({ message, signature }), { params });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.slug).toBe(SLUG);
    expect(json.content.length).toBeGreaterThan(100);
  });

  it("returns 403 when the signer has not paid", async () => {
    const message = buildEntitlementMessage(SLUG, account.address, Date.now(), "n1");
    const signature = await account.signMessage({ message });
    const res = await POST(postReq({ message, signature }), { params });
    expect(res.status).toBe(403);
  });

  it("returns 400 when body fields are missing", async () => {
    const res = await POST(postReq({}), { params });
    expect(res.status).toBe(400);
  });
});
