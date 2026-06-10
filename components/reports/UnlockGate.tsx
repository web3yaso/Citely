"use client";
import { useState } from "react";
import { useAccount, useConnect } from "wagmi";
import { injected } from "wagmi/connectors";
import { createWalletClient, custom, type EIP1193Provider } from "viem";
import { baseSepolia } from "viem/chains";
import { unlockArticle, type ArticlePaid } from "@/lib/x402-client";
import { buildEntitlementMessage } from "@/lib/entitlement";

export function UnlockGate({
  slug,
  priceUsd,
  preview,
  renderFull,
  ctaClassName,
  onUnlocked,
}: {
  slug: string;
  priceUsd: string;
  preview: React.ReactNode;
  renderFull: (full: ArticlePaid) => React.ReactNode;
  ctaClassName?: string;
  /** Fired once on PAYMENT success only — NOT on verify-unlock. Human path passes the auto-download here. */
  onUnlocked?: (full: ArticlePaid) => void;
}) {
  const { isConnected, address, connector } = useAccount();
  const { connect } = useConnect();
  const [full, setFull] = useState<ArticlePaid | null>(null);
  const [status, setStatus] = useState<"idle" | "paying" | "verifying" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);

  // Build a wallet client on-demand from the live connector provider (avoids the
  // reactive useWalletClient() hook lagging after cookie reconnect).
  async function getWalletClient() {
    const provider = (await connector!.getProvider()) as EIP1193Provider;
    return createWalletClient({ account: address!, chain: baseSepolia, transport: custom(provider) });
  }

  async function onUnlock() {
    setErr(null);
    if (!isConnected || !address || !connector?.getProvider) {
      connect({ connector: injected({ target: "metaMask" }) });
      return;
    }
    setStatus("paying");
    try {
      const data = await unlockArticle(await getWalletClient(), slug);
      setFull(data); // in-memory only — never persisted to localStorage (#12)
      setStatus("idle");
      onUnlocked?.(data);
    } catch (e) {
      setErr((e as Error).message ?? "unlock failed");
      setStatus("error");
    }
  }

  // Returning paid reader: prove ownership by signing, server checks the payment log.
  async function onVerify() {
    setErr(null);
    if (!isConnected || !address || !connector?.getProvider) {
      connect({ connector: injected({ target: "metaMask" }) });
      return;
    }
    setStatus("verifying");
    try {
      const walletClient = await getWalletClient();
      const message = buildEntitlementMessage(slug, address, Date.now(), crypto.randomUUID());
      const signature = await walletClient.signMessage({ account: address, message });
      const res = await fetch(`/api/v1/articles/${slug}/entitlement`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, signature }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `验证失败 (${res.status})`);
      }
      setFull((await res.json()) as ArticlePaid); // in-memory only; no download on re-read
      setStatus("idle");
    } catch (e) {
      setErr((e as Error).message ?? "verify failed");
      setStatus("error");
    }
  }

  if (full) return <>{renderFull(full)}</>;
  const busy = status === "paying" || status === "verifying";
  return (
    <>
      {preview}
      <div style={{ marginTop: 14 }}>
        <button className={ctaClassName ?? "pw-cta"} onClick={onUnlock} disabled={busy}>
          {status === "paying"
            ? "付款中…"
            : !isConnected
            ? `连接钱包付 ${priceUsd} 解锁全文`
            : `用钱包付 ${priceUsd} 解锁全文`}
        </button>
        <button
          className="pw-verify"
          onClick={onVerify}
          disabled={busy}
          style={{ marginLeft: 12, background: "none", border: "none", color: "var(--ink-mute)", cursor: "pointer", textDecoration: "underline" }}
        >
          {status === "verifying" ? "验证中…" : "已付过费?验证解锁"}
        </button>
        {err && (
          <p className="pw-fine" style={{ color: "var(--crimson)" }}>
            {err}
          </p>
        )}
      </div>
    </>
  );
}
