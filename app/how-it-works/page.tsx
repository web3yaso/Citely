import Link from "next/link";
import { Masthead } from "@/components/home/Masthead";
import { Footer } from "@/components/home/Footer";

export const metadata = {
  title: "How it works · Citely",
  description:
    "一篇报告,三方付费,款项全程直达作者。合规作者签名上链,真人和 AI Agent 用同一个价格付费解锁——EAS + x402 on Base,平台 0% 抽成。",
};

export default function HowItWorksPage() {
  return (
    <>
      <Masthead />

      <main className="howto" data-screen-label="How it works">
        <p className="eyebrow">How it works · 三方付费闭环</p>
        <h1 className="display">
          一篇报告,<em>三方付费</em>,款项<em>全程直达作者</em>。
        </h1>
        <p className="lede">
          合规作者把文章签名上链;真人和 AI Agent 用同一个价格付费解锁同一篇报告。没有平台抽成、没有 API
          key、没有对账纠纷 —— 谁是作者、内容是否被改、付了多少,全部写在 Base 上,任何人可验证。
        </p>

        {/* LOOP DIAGRAM */}
        <div className="loop">
          <p className="loop-lbl">The loop · Base Sepolia</p>
          <div className="loop-grid">
            {/* Author */}
            <div className="node author">
              <span className="nstep">1</span>
              <div className="nhead">
                <span className="nico">✍</span>
                <div>
                  <div className="nt">作者</div>
                  <div className="ntag">@cryptolaw_cn</div>
                </div>
              </div>
              <p className="ndesc">导入文章、自己定价,用钱包签名写入一条 EAS 存证。</p>
              <span className="nchip">
                EAS <b>attest</b>
              </span>
            </div>

            {/* arrow */}
            <div className="arrow">
              <span className="alab">
                <span className="at">签名上链</span>
                <span className="ac">contentHash + price</span>
              </span>
              <span className="line"></span>
            </div>

            {/* Catalog */}
            <div className="node catalog">
              <span className="nstep">2</span>
              <div className="nhead">
                <span className="nico">▤</span>
                <div>
                  <div className="nt">报告目录</div>
                  <div className="ntag">/reports</div>
                </div>
              </div>
              <p className="ndesc">存证一上链,报告自动进目录,带 on-chain ✓ 徽章可验证。</p>
              <span className="nchip">
                EAS <b>GraphQL</b>
              </span>
            </div>

            {/* arrow */}
            <div className="arrow pay">
              <span className="alab">
                <span className="at">付费解锁 · 同价</span>
                <span className="ac">x402 · USDC</span>
              </span>
              <span className="line"></span>
            </div>

            {/* Payers */}
            <div className="node payer">
              <span className="nstep">3</span>
              <div className="nhead">
                <span className="nico">⇄</span>
                <div>
                  <div className="nt">真人 + Agent</div>
                  <div className="ntag">x402 / MCP</div>
                </div>
              </div>
              <p className="ndesc">真人点 Unlock、Agent 走 402→pay→200,USDC 即时结算。</p>
              <span className="nchip">
                USDC <b>on Base</b>
              </span>
            </div>
          </div>

          {/* settlement back to author */}
          <div className="settle">
            <span className="sico">↩</span>
            <div className="stext">
              <b>每一笔都直付作者钱包</b> —— 平台 <span className="smono">0%</span>{" "}
              抽成,结算实时上链,可在 basescan 验证。收益变化即刻反映到首页 Top Earning Authors 榜单。
            </div>
          </div>
        </div>

        {/* STEPS */}
        <div className="steps-head">
          <h2>完整生命周期,五步走</h2>
          <p>
            从一篇文章被签名,到真人和 Agent 各自付费、作者看见收益上涨 —— 每一步都链上可验证。
          </p>
        </div>

        <div className="step">
          <div className="step-num">
            01<span className="who">作者</span>
          </div>
          <div>
            <h3>签名上链</h3>
            <p>
              作者从首页导入公众号 / Mirror / Substack 文章,确认标题、标签、作者地址并自己设定价格。前端算出{" "}
              <code>contentHash = keccak256(正文)</code>,作者点 &ldquo;Sign + Attest&rdquo;,钱包签名把一条
              EAS 存证写入 Base,返回 attestation UID 与 tx hash。
            </p>
            <div className="step-meta">
              <span className="smeta">
                <span className="dot"></span>schema: <b>contentHash, author, priceUSDC, slug, title</b>
              </span>
              <span className="smeta">
                <span className="dot"></span>recipient = author · revocable
              </span>
            </div>
            <Link href="/publish" className="step-link">
              去 /publish 走一遍 →
            </Link>
          </div>
        </div>

        <div className="step">
          <div className="step-num">
            02<span className="who">目录</span>
          </div>
          <div>
            <h3>报告进目录</h3>
            <p>
              站点读取存证索引,对每个 UID 调 EAS GraphQL 拉取 attester、时间戳和撤销状态,与本地 MDX
              frontmatter 双源对账后渲染。每张卡片右上角带 &ldquo;on-chain ✓ · EAS:0x…&rdquo; 徽章,hover
              直跳 EAS Explorer 验证。
            </p>
            <div className="step-meta">
              <span className="smeta">
                <span className="dot"></span>source: <b>EAS GraphQL + 本地索引</b>
              </span>
              <span className="smeta">
                <span className="dot"></span>降级:超时则徽章变灰显 &ldquo;indexing…&rdquo;
              </span>
            </div>
            <Link href="/reports" className="step-link">
              看 /reports 目录 →
            </Link>
          </div>
        </div>

        <div className="step">
          <div className="step-num">
            03<span className="who">真人读者</span>
          </div>
          <div>
            <h3>真人 x402 付费</h3>
            <p>
              读者打开报告页,先看到约 24% 的预览和 paywall。点 &ldquo;Unlock&rdquo;,钱包发一笔 USDC,全文立即出现并
              <b>永久可读</b> —— 同一钱包重访不再付费。整笔结算通过 x402 在 Base 上完成。
            </p>
            <div className="step-meta">
              <span className="smeta ok">
                <span className="dot"></span>x402 on Base · <b>USDC</b>
              </span>
              <span className="smeta ok">
                <span className="dot"></span>付一次永久解锁
              </span>
            </div>
          </div>
        </div>

        <div className="step">
          <div className="step-num">
            04<span className="who">Agent</span>
          </div>
          <div>
            <h3>Agent 付费调用</h3>
            <p>
              AI Agent 通过 AgentCash MCP 调用同一篇报告的付费 API:<code>GET</code> 返回{" "}
              <code>402 Payment Required</code>,Agent 自动付款后重试拿到 <code>200</code> 全文。和真人
              <b>完全同价</b>,无需 API key、无需人工协同。
            </p>
            <div className="step-meta">
              <span className="smeta ok">
                <span className="dot"></span>402 → pay → <b>200</b>
              </span>
              <span className="smeta ok">
                <span className="dot"></span>真人 / Agent <b>同价</b>
              </span>
            </div>
            <Link href="/#agents" className="step-link">
              查看 For Agents 接入 →
            </Link>
          </div>
        </div>

        <div className="step">
          <div className="step-num">
            05<span className="who">作者</span>
          </div>
          <div>
            <h3>收益可见</h3>
            <p>
              真人付费和 Agent 付费两笔款项直达作者钱包后,刷新首页 For Writers 的 Top Earning Authors
              榜单,该作者那行的 EARNED 数字即刻上升 —— 增量正好等于价格 × 2,且每一笔都能在 basescan
              上对到链上交易。
            </p>
            <div className="step-meta">
              <span className="smeta ok">
                <span className="dot"></span>结算:<b>实时 · 直付钱包</b>
              </span>
              <span className="smeta ok">
                <span className="dot"></span>平台抽成 <b>0%</b>
              </span>
            </div>
          </div>
        </div>

        {/* WHY ON-CHAIN */}
        <div className="why">
          <h2>为什么要上链</h2>
          <div className="why-grid">
            <div className="why-card">
              <span className="wico">⛨</span>
              <h3>出处可证</h3>
              <p>
                contentHash 在服务端重算比对,attester 必须等于 frontmatter
                里的作者地址。文章被篡改或冒名,直接拒绝上索引。
              </p>
              <span className="wlink">keccak256 · EAS attester</span>
            </div>
            <div className="why-card">
              <span className="wico">⇄</span>
              <h3>真人 Agent 同价</h3>
              <p>
                价格由作者写在链上,真人 x402 和 Agent MCP 读到的是同一个数字。没有歧视性定价,也没有隐藏的平台加价。
              </p>
              <span className="wlink">priceUSDC · uint96</span>
            </div>
            <div className="why-card">
              <span className="wico">↩</span>
              <h3>0 抽成直付</h3>
              <p>
                每笔付费通过 x402 实时结算到作者钱包,平台不碰钱、不做中间账户。链上可查,无需信任对账。
              </p>
              <span className="wlink">x402 · basescan</span>
            </div>
          </div>
        </div>

        {/* CTA */}
        <div className="cta">
          <div className="ct">
            <h2>把你的第一篇报告上链</h2>
            <p>导入一篇文章,自己定价,一次签名就进目录 —— 真人和 Agent 立刻能付费阅读。</p>
          </div>
          <div className="cta-actions">
            <Link href="/publish" className="primary">
              发布报告 →
            </Link>
            <Link href="/reports" className="ghost">
              浏览目录
            </Link>
          </div>
        </div>
      </main>

      <Footer />
    </>
  );
}
