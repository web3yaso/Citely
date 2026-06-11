# 服务端按 payer 验证、前端不存全文 — 设计 (issue #12)

> Status: approved design, ready for implementation plan.
> Scope: 仅 Base 人类网页阅读链路。Agent 链路（直接付费读 JSON）与 Solana 端点不变。

## 目标

把「解锁状态」从浏览器 `localStorage` 全文缓存，改为**服务端按 payer 验证**：

- 前端**不再持久化全文**（消除「一次付费的全文可复制到别的浏览器/设备免费看」的外传漏洞）。
- 已付费读者重读时，用**钱包签名（SIWE 风格）**向服务端证明身份，服务端按付费记录核验后返回全文。
- 解锁**绑钱包地址**、**不可搬运**、浏览器不留持久化全文。

非目标（YAGNI / 留作日后）：服务端 nonce 存储式严格防重放；跨设备「无感」重读（本设计每次重读需一次签名）；Solana / agent 链路的 entitlement。

## 背景：当前实现与问题

- `components/reports/UnlockGate.tsx`：付费成功后把整个 `ArticlePaid`（含全文 `content`+`companion`）写入 `localStorage` 的 `citely_unlocked_<slug>`（仅按 slug），挂载时读回。后果：按浏览器而非地址、永久、可搬运。
- `app/api/v1/articles/[slug]/route.ts`：付费 handler 记录付费日志时 `payer: req.headers.get("x-payer") ?? rec.author`，但**没有任何地方设置 `x-payer`**，所以 payer 实际一直是 `rec.author`（兜底），对「按 payer 验证」无用。
- 付费记录持久化：`lib/payment-log.ts` → `lib/store.ts`，本地 FileStore / 线上 Upstash Redis（list `citely:payments`）。`appendPaymentLog` 为 best-effort。

x402 中间件流程（`@x402/next` `withX402`）：`processHTTPRequest` 验证付款 → 调用我们的 `routeHandler(request)` → `handleSettlement` 结算。**handler 运行时 `X-PAYMENT` 请求头已在**（base64 的 PaymentPayload），exact-evm scheme 的 `payload.authorization.from` 即真实付款地址。结算后的 `payer` 只进响应头（发往客户端），服务端 handler 取不到，故采用解码 `X-PAYMENT` 请求头的方式拿 payer。

## 架构总览

```
首次付费（不变 + 去缓存）：
  UnlockGate.onUnlock → x402 paidFetch GET /api/v1/articles/<slug>
    → 402 → 钱包签名付款 → 200 全文 JSON
    → setFull(data)  // 仅内存，不再写 localStorage
    （handler 侧：payerFromXPayment(req) 记真实 payer 进 payment-log）

重读（新增 SIWE）：
  UnlockGate「验证解锁」按钮 → 钱包 signMessage(buildEntitlementMessage)
    → POST /api/v1/articles/<slug>/entitlement {message, signature}
    → 服务端 verifyEntitlement: 还原地址 → 校验 slug/时间戳 → hasPaidFor
    → 200 全文 JSON（getPaidArticleBody，与付费 200 同一份）/ 403
    → setFull(data)
```

全文只在「付款 200」或「entitlement 验证 200」后进入 React 内存态，刷新即失、重读需重新签名。

## 组件设计

### 1. `lib/x402-payer.ts`（新建）— 真实 payer 捕获

```ts
/** 从 X-PAYMENT 请求头解出 exact-evm 付款方地址（小写）；拿不到返回 null。 */
export function payerFromXPayment(req: Request): string | null
```

- 读 `req.headers.get("X-PAYMENT")`；为空返回 `null`。
- base64 解码 → `JSON.parse`；取 `payload.authorization.from`（exact-evm）。
- 校验是 `0x` + 40 hex；`toLowerCase()` 后返回。任何异常 → `null`（不抛）。

**接入** `app/api/v1/articles/[slug]/route.ts` handler：
`payer: payerFromXPayment(req) ?? rec.author`。其余字段不变。

### 2. `lib/entitlement.ts`（新建）— 验证逻辑

```ts
export type EntitlementOk = { ok: true; address: string };
export type EntitlementFail = { ok: false; reason: "bad_signature" | "slug_mismatch" | "expired" | "not_paid" };

export function buildEntitlementMessage(
  slug: string, address: string, issuedAt: number, nonce: string,
): string;

export async function hasPaidFor(slug: string, address: string): Promise<boolean>;

export async function verifyEntitlement(input: {
  slug: string; message: string; signature: `0x${string}`;
}): Promise<EntitlementOk | EntitlementFail>;
```

- `buildEntitlementMessage` 固定多行格式，例：
  ```
  Citely 阅读验证
  文章: <slug>
  地址: <address>
  时间: <ISO(issuedAt)>
  nonce: <nonce>
  ```
  解析时按行前缀回读：`文章:` → slug、`时间:` → ISO 经 `Date.parse` 得 `issuedAt`（毫秒）。地址/nonce 仅作绑定，不单独回读。
- `hasPaidFor`：`readPaymentLog()` → 过滤 `e.slug === slug && e.payer.toLowerCase() === address.toLowerCase()`，存在即 `true`。
- `verifyEntitlement`：
  1. viem `recoverMessageAddress({ message, signature })` 得 `recovered`；异常 → `bad_signature`。
  2. 从 message 解出 `slug`、`issuedAt`；message 的 slug ≠ 入参 slug → `slug_mismatch`。
  3. `Date.now() - issuedAt > 5min`（允许少量未来偏差）→ `expired`。
  4. `hasPaidFor(slug, recovered)` 否 → `not_paid`。
  5. 通过 → `{ ok: true, address: recovered.toLowerCase() }`。
- 时间戳由客户端传入并写进签名 message（无服务端 nonce 存储）。

### 3. `app/api/v1/articles/[slug]/entitlement/route.ts`（新建）— 免费验证端点

- `POST`，CORS 与付费端点一致（`Access-Control-Allow-Origin: *` 等），`OPTIONS` 返回 204。
- slug 先过 `SLUG_RE` 白名单 + `findRecord`，未发布 → 404。
- body `{ message, signature }`；缺失 → 400。
- `verifyEntitlement` → `ok` 返回 `NextResponse.json(await getPaidArticleBody(slug))`；`fail` → 403，body `{ error: <reason 对应中文> }`。
- `export const dynamic = "force-dynamic"`。

### 4. `components/reports/UnlockGate.tsx`（改造）

- **删除**：`cacheKey`、挂载读缓存的 `useEffect`、付款成功后的 `localStorage.setItem`。
- 付款成功仍 `setFull(data)` + `onUnlocked?.(data)`（不变，只是不写缓存）。
- 新增状态 `verifying`，新增动作「已付过费?验证解锁」（次级按钮/链接，置于付款按钮旁）：
  1. 未连钱包 → 触发 `connect`。
  2. 构造 `issuedAt = Date.now()`、`nonce`（`crypto.randomUUID()`）、`message = buildEntitlementMessage(slug, address, issuedAt, nonce)`。
  3. `walletClient.signMessage({ account: address, message })`。
  4. `POST /api/v1/articles/<slug>/entitlement`；200 → `setFull(data)`（**不**触发 `onUnlocked`，重读不重复下载）；非 200 → 显示中文错误。
- `onUnlocked` 文档注释更新：仅付款成功触发，验证重读不触发。

## 数据流与持久化

- 付费记录 = entitlement 真值来源，复用 `payment-log`（无新存储）。线上 Redis、本地 File 均已支持。
- `hasPaidFor` 为线性扫描 list，demo 规模足够；如需可后续加索引（YAGNI）。
- best-effort 写日志的既有风险延续：若付费结算成功但 `appendPaymentLog` 落库失败，该读者首次仍拿到全文，但**重读验证会查不到记录**。本设计不改变该 best-effort 语义，仅在 DEPLOY 备注中提示「entitlement 依赖 payment-log 持久化」。

## 错误处理

| 场景 | 返回 | UnlockGate 展示 |
|---|---|---|
| 签名无效 | 403 `bad_signature` | 「签名验证失败,请重试」|
| slug 不符 | 403 `slug_mismatch` | 「验证信息不匹配」|
| 时间戳过期 | 403 `expired` | 「验证已过期,请重新点击验证」|
| 该地址未付费 | 403 `not_paid` | 「该钱包未购买本文,请先付费解锁」|
| 缺 body | 400 | 「请求无效」|
| 未发布 slug | 404 | （按钮不显示 / 通用错误）|

## 测试（TDD）

- `lib/x402-payer.test.ts`：给定一段构造的 X-PAYMENT base64（含 `payload.authorization.from`）→ 返回小写地址；空头 / 非 base64 / 缺字段 → `null`。
- `lib/entitlement.test.ts`（用 viem `privateKeyToAccount` 生成测试账号实际签名）：
  - `buildEntitlementMessage` 含 slug/地址/时间/nonce 各行。
  - `verifyEntitlement`：正确签名 + 该地址有付费记录 → `ok` 且 `address` 为还原地址；
  - 篡改签名 → `bad_signature`；message slug ≠ 入参 → `slug_mismatch`；`issuedAt` 早于 6 分钟 → `expired`；地址无付费记录 → `not_paid`。
  - `hasPaidFor`：付费记录存在/不存在、大小写不敏感。
  - 测试用 FileStore（默认）并预置 payment-log 数据。
- 端点与 UnlockGate 改造以 lib 单测为主 + 手动 e2e 验证（线上付费后重读）。

## 影响面 / 不改动

- 不动：Solana 端点、agent 发现/付费链路、付费端点的 x402 配置与价格逻辑、EAS、目录组装。
- payer 捕获修复对 agent 透明（agent 同样带 X-PAYMENT，记录更准；leaderboard 按 authorName 分组，不受 payer 影响）。
- 文档：`public/SKILL.md` / `openapi.json` 增补免费 entitlement 端点（人类重读用，agent 一般不需要）；`DEPLOY.md` 备注 entitlement 依赖 payment-log 持久化。
