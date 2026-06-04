# Spec: KV 持久化（让线上 publish + 排行榜真正生效）

- 日期：2026-06-03
- 分支：dev
- 状态：设计已批准（待实现）

## 1. 问题

Citely 部署在 Vercel。核心演示动线是**线上现场走 `/publish` 把 DAO 篇（`onchain-partnership-rwa`）导入** —— 签名上链 → 入库 → 出现在文章列表。当前这条动线在部署版上是坏的，原因有两个独立的坑：

- **A · 文章已存在 → 导入被拒**：提交进 git 的 `data/attestation-index.json` 里已有 `onchain-partnership-rwa`。`appendIndex` 是 first-write-wins，重复 slug 直接 `409 slug already published`。
- **B · 写不进去（根因）**：即使删掉它，`POST /api/internal/attestations` 最后的 `appendIndex()` 要写 `data/attestation-index.json`，而 Vercel serverless 文件系统**只读**（DEPLOY.md §2 已注明），写入抛错 → publish 失败，文章不入库。`appendPaymentLog` 同理失败 → 排行榜 EARNED 也不会现场上涨（Story 5）。

光"删文章"只解决 A，B 必须靠持久化。

## 2. 目标

- 线上 publish 能真正落库，DAO 篇导入后出现在 `/api/v1/articles`。
- 线上付费后 `payment-log` 落库，首页排行榜 EARNED 现场上涨。
- 每次部署从"没有 DAO 篇"的干净态起步；现场 import 负责把它加进来；演示前可一键 reset。
- 本地开发与 CI **不需要** Redis 凭证，现有测试照常跑。

## 3. 非目标

- 不引入关系型数据库 / ORM。
- 不做 entitlement（"买一次反复读"）持久化 —— 仍按 x402 per-request（HACKATHON.md §13）。
- 不改 EAS / x402 / 加密正文等既有链路。

## 4. 决策（已批准）

- **范围**：attestation-index **和** payment-log 都改成可持久化。
- **后端**：Upstash Redis（经 Vercel Marketplace 集成，注入 REST URL/Token）。
- **架构**：双后端抽象 —— 本地/CI 用文件，线上检测到 Redis env 用 Redis。
- **跳过单独证伪**：Vercel 只读 fs 是文档明确且普遍成立，最干净的实证就是 KV 接好后第一次线上 publish 成功。

## 5. 架构

### 5.1 新增 `lib/store.ts` —— 存储抽象层

统一接口（**全部 async**）：

```ts
export interface CitelyStore {
  getIndex(): Promise<AttestationRecord[]>;
  addIndexRecord(rec: AttestationRecord): Promise<void>; // first-write-wins；slug 已存在则 throw
  getPaymentLog(): Promise<PaymentEntry[]>;
  addPaymentEntry(e: PaymentEntry): Promise<boolean>;      // best-effort，失败返回 false
}
```

后端按环境变量在模块加载时选定一次：

| 接口 | FileStore（默认 · 本地/CI） | RedisStore（线上 · 检测到 Upstash env） |
|---|---|---|
| `getIndex` | 读 `data/attestation-index.json` | `HGETALL citely:index` → 解析每个 value |
| `addIndexRecord` | 现文件逻辑（temp + rename） | `HSETNX citely:index <slug> <json>`；返回 0（已存在）则 throw `slug already published` |
| `getPaymentLog` | 读 `data/payment-log.json` | `LRANGE citely:payments 0 -1` → 解析 |
| `addPaymentEntry` | 现 best-effort 文件逻辑 | `RPUSH citely:payments <json>`；异常 catch → 返回 false |

- 后端选择：存在 `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`（或 Vercel 注入的 `KV_REST_API_URL` + `KV_REST_API_TOKEN`）→ RedisStore；否则 FileStore。
- Redis 客户端用 `@upstash/redis`（HTTP，serverless/edge 原生）。
- key 命名空间：`citely:index`（Hash，field=slug）、`citely:payments`（List）。

### 5.2 改造既有模块

- `lib/attestation-index.ts`：`readIndex` / `appendIndex` / `hasSlug` / `findRecord` 改为 async，委托 store。`validateAttestationInput` 保持同步。first-write-wins 由 store（`addIndexRecord`）保证；`appendIndex` 仍先 `validateAttestationInput` 再 `addIndexRecord`。
- `lib/payment-log.ts`：`readPaymentLog` / `appendPaymentLog` 改为 async，委托 store。

### 5.3 async 传播（主要工作量）

`getIndex` 变 async ⇒ 上游全部加 `async/await`：

- `lib/reports.ts`：`listPublishedReports` / `listReaderCatalog` / `listAgentCatalog` / `listAuthors` / `getPublishedReport`（`getReportMeta` / `getReportBody` 读 fs 内容文件，保持同步）。
- `lib/leaderboard.ts`：`listLeaderboard` / `getWriterStats`。
- 调用方：`app/api/v1/articles/route.ts`、`app/api/v1/articles/[slug]/route.ts`、`app/api/v1/authors/route.ts`、首页 `app/page.tsx` 及 `/reports` 服务端组件、`app/api/internal/attestations/route.ts`、`app/api/internal/companions/route.ts`（若涉及）、相关组件数据获取。
- 所有受影响测试加 `await`。

> 这是机械但面广的改动，是本次主要风险点。实现计划须逐文件列出受影响调用点并编译验证。

## 6. 种子与"保持 DAO 删除"

- **从提交进 git 的 `data/attestation-index.json` 移除 DAO 篇**，只留 2 篇 seed（姚前案 / 违法用工）。DAO 的 `content/reports/onchain-partnership-rwa.{mdx,enc}` **保留**（import 时算 contentHash 需要）。
- **新增 `scripts/seed-kv.ts`（`pnpm seed-kv`）**：读取committed seed records，把 2 篇 seed 写进线上 Redis（**不含 DAO**），并把现有 payment-log 初始化为空。一次性对 prod env 跑。
- **`scripts/reset-demo.ts` 改造**：通过同一个 store 清理后端里的 DAO 篇 + 清空 payment-log，使其对 FileStore 和 RedisStore 都生效。演示前一键回到干净态。

## 7. 环境变量

- `.env.local.example` 增加 `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`（注明：留空 → 本地用文件后端）。
- Vercel：经 Marketplace 集成 Upstash Redis，自动注入凭证。

## 8. 测试策略（TDD）

- **`lib/store.test.ts`（新增）**：
  - FileStore：用真实临时文件，测 index 读写往返、first-write-wins 抛错、payment-log 追加。
  - RedisStore：用 `@upstash/redis` 的内存假实现（mock）测 `HSETNX` first-write-wins 语义、`HGETALL`/`LRANGE` 往返、`addPaymentEntry` 失败返回 false。
- **既有测试**：`reports.test.ts` / `leaderboard.test.ts` / `attestation-index.test.ts` / `payment-log.test.ts` 等改为 `await`，行为断言不变（FileStore 路径）。
- 每个新行为先写失败测试再实现。
- 完成判据：`pnpm test` 全绿 + `pnpm build` 通过 + 线上接 Redis 后一次真实 publish 成功（DAO 篇出现在 `/api/v1/articles`）。

## 9. 风险与回滚

- **async 传播漏改**：靠 `pnpm build`（类型检查）兜底 —— 漏 await 的同步消费会编译报错。
- **Redis 不可用**：RedisStore 读失败应抛错（让请求 500，不静默回退到文件，避免线上读到陈旧文件态）；写（payment）失败保持 best-effort。
- **回滚**：env 移除 Redis 凭证即退回 FileStore；代码层抽象保留，不影响本地。

## 10. 交付物清单

- `lib/store.ts`（+ `lib/store.test.ts`）
- `lib/attestation-index.ts` / `lib/payment-log.ts` 改 async
- `lib/reports.ts` / `lib/leaderboard.ts` + 所有调用方改 async
- `scripts/seed-kv.ts` + `package.json` 加 `seed-kv`
- `scripts/reset-demo.ts` 改造
- `data/attestation-index.json` 移除 DAO 篇
- `.env.local.example` 增 Redis 凭证位
- 依赖：`@upstash/redis`
