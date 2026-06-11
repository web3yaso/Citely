import { describe, it, expect } from "vitest";
import { payerFromXPayment } from "./x402-payer";

/** Build a base64 X-PAYMENT header like the x402 client sends (exact-evm). */
function xPaymentHeader(from: string): string {
  const payload = {
    x402Version: 1,
    scheme: "exact",
    network: "eip155:84532",
    payload: {
      signature: "0xsig",
      authorization: { from, to: "0xto", value: "300000", validAfter: "0", validBefore: "9", nonce: "0x00" },
    },
  };
  return Buffer.from(JSON.stringify(payload), "utf-8").toString("base64");
}

describe("payerFromXPayment", () => {
  it("decodes the exact-evm payer (lowercased) from the X-PAYMENT header", () => {
    const req = new Request("http://x", {
      headers: { "X-PAYMENT": xPaymentHeader("0xAbC0000000000000000000000000000000000123") },
    });
    expect(payerFromXPayment(req)).toBe("0xabc0000000000000000000000000000000000123");
  });

  it("returns null when the header is missing", () => {
    expect(payerFromXPayment(new Request("http://x"))).toBeNull();
  });

  it("returns null on garbage / non-JSON payloads", () => {
    const req = new Request("http://x", { headers: { "X-PAYMENT": "@@not-base64-json@@" } });
    expect(payerFromXPayment(req)).toBeNull();
  });

  it("returns null when authorization.from is absent", () => {
    const b64 = Buffer.from(JSON.stringify({ payload: {} }), "utf-8").toString("base64");
    const req = new Request("http://x", { headers: { "X-PAYMENT": b64 } });
    expect(payerFromXPayment(req)).toBeNull();
  });

  it("returns null on an empty header value", () => {
    const req = new Request("http://x", { headers: { "X-PAYMENT": "" } });
    expect(payerFromXPayment(req)).toBeNull();
  });
});
