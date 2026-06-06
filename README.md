# Citely — Agentic Commerce Proposal

一句话

专家把 Web3 法律/合规/安全风险报告签名上链（EAS on Base），真人或 AI Agent 用 USDC 按篇 x402 付费解锁全文；收入 100% 归作者、平台 0
抽成，出处与定价全部链上可验证。

目标用户

- 供给侧：想靠专业内容直接变现的合规/法律/安全作者，不愿被平台抽成、需要可证明的署名与定价。
- 需求侧：需要付费获取风险报告的真人读者，以及需要按需消费这些知识的 AI Agent（真人与 Agent 同价、无需 API Key/预注册）。

真实场景

一个 Research/合规 Agent 接到任务「为 web3 公司工作有什么法律风险？」→ 免费检索目录命中《姚前案》《违法用工》等实名作者文章 → 自主用钱包付 $0.25–$0.30 USDC
解锁全文 → 带作者 + EAS 出处给出风险作答。Agent 全程不依赖人类预注册，付费即得权威来源。

最小功能（已实现）

- 发现：GET /api/v1/articles?q= &tag= &author= 免费返回元数据 + 每项 read 路径。
- 付费解锁：GET /api/v1/articles/[slug] 走 x402 paywall（402 → 付款 → 200 全文+companion+citation），正文付费后服务端解密。
- 发布上链：/publish 钱包签名 → EAS attestation（contentHash+author+price）→ 服务端复核链上真值后入目录。
- 真人/Agent 同价、收益实时聚合到首页排行榜。

验证方式

主链路 Demo：Agent（Cobo Agentic Wallet）发现 → 取 read → 命中 402 → 在 pact 授权边界内付 USDC → 200 拿全文。成功判据：yaoqian-crypto-liability 端到端
402→pay→200 跑通，链上可在 basescan 验到 USDC 直付作者地址、在 EAS Explorer 验到署名存证。并行验证一条 Solana devnet x402 通道（PayAI facilitator），用临时
keypair 跑通真实 402→付款→200，证明链路跨链、协议级。

风险边界

- 风险教育非法律意见；正文为微信导出，仅在显示层清洗、不改上链哈希。
- 支付授权受 Cobo pact 约束（花多少/付给谁/哪条链），越界即拒；测试网/极小额。
- 已知阻塞：Cobo + Base Sepolia 该枚 USDC 无法 x402 结算、MetaMask Smart Transactions 在测试网发不出 attest（均已记录，分别用主网分支 / OKX 直发 / Solana
通道规避）。
- 自付被 facilitator 拒（payer 不能是作者地址）。
