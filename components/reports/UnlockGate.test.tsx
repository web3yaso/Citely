import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { UnlockGate } from "./UnlockGate";
import type { ArticlePaid } from "@/lib/x402-client";

// Disconnected wallet: render path needs no viem/signing.
vi.mock("wagmi", () => ({
  useAccount: () => ({ isConnected: false, address: undefined, connector: undefined }),
  useConnect: () => ({ connect: vi.fn() }),
}));
vi.mock("wagmi/connectors", () => ({ injected: () => ({}) }));

// Node 25 ships a built-in localStorage without .clear()/.setItem() — stub it so
// jsdom's storage semantics apply uniformly across Node versions.
const _store: Record<string, string> = {};
vi.stubGlobal("localStorage", {
  getItem: (k: string) => _store[k] ?? null,
  setItem: (k: string, v: string) => { _store[k] = v; },
  removeItem: (k: string) => { delete _store[k]; },
  clear: () => { Object.keys(_store).forEach((k) => delete _store[k]); },
  get length() { return Object.keys(_store).length; },
  key: (i: number) => Object.keys(_store)[i] ?? null,
});

const SLUG = "yaoqian-crypto-liability";
const renderFull = (full: ArticlePaid) => <div>{full.content}</div>;

beforeEach(() => {
  localStorage.clear();
});

describe("UnlockGate (#12 — no client-side full-text cache)", () => {
  it("ignores any legacy localStorage cache — full text is never restored from the browser", () => {
    localStorage.setItem(
      `citely_unlocked_${SLUG}`,
      JSON.stringify({ slug: SLUG, title: "t", content: "LEAKED-FULL-TEXT", companion: "", starterPrompts: [], citation: { author: "a", attestationUID: "0x0", publishedAt: "2026" } }),
    );
    render(<UnlockGate slug={SLUG} priceUsd="$0.30" preview={<div>PREVIEW-ONLY</div>} renderFull={renderFull} />);
    expect(screen.queryByText("LEAKED-FULL-TEXT")).not.toBeInTheDocument();
    expect(screen.getByText("PREVIEW-ONLY")).toBeInTheDocument();
  });

  it("offers a verify-unlock action for returning paid readers", () => {
    render(<UnlockGate slug={SLUG} priceUsd="$0.30" preview={<div>PREVIEW-ONLY</div>} renderFull={renderFull} />);
    expect(screen.getByRole("button", { name: /验证解锁/ })).toBeInTheDocument();
  });
});
