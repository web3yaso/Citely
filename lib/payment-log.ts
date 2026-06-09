import { getStore } from "./store";

export type PaymentEntry = { slug: string; payer: string; amount: string; txHash: string; ts: number };

export async function readPaymentLog(): Promise<PaymentEntry[]> {
  return getStore().getPaymentLog();
}

/**
 * Append a payment entry. Best-effort: serverless filesystems (e.g. Vercel) are
 * read-only, so a write failure must NOT break an already-settled paid unlock —
 * the caller has been paid and the reader is owed their content. Returns whether
 * the entry persisted (false on a read-only FS); for durable prod logging, back
 * this with KV/DB (see DEPLOY.md).
 */
export async function appendPaymentLog(e: PaymentEntry): Promise<boolean> {
  return getStore().addPaymentEntry(e);
}
