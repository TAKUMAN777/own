# API

このアプリは **オーナー自身のもの** です。オーナーのアカウントに、複数の管理会社（各社の REVO管理）がつながります。

```
オーナーのアプリ ──（このサーバー /api/v1）── 管理会社A の REVO管理
                                           └─ 管理会社B の REVO管理
```

今は `server/` のモック（架空データ）が応えます。本番では、管理会社ごとのデータ取得を、
各社の REVO管理 が実装する「連動API」（下の後半）の呼び出しに置き換えます。

## 1. アプリ用 API（このサーバー）

- 先頭：`/api/v1`
- 認証：`POST /auth/invite` で受け取ったトークンを `Authorization: Bearer <token>` で送る（12時間有効）
- 会社ごとのデータには `tenantId` と `company`（会社名）が付く
- エラー：`{ "error": "<code>", "message": "<日本語の説明>" }`

| メソッド・パス | 中身 |
|---|---|
| `GET /app` | `{ name, demo }` アプリ名（設定値） |
| `POST /auth/invite` | `{ code }` → `{ token, accountId }`。初回はアカウントを作る。つながっている会社のコードなら同じアカウントに入る。5回間違えると1分待ち |
| `POST /auth/logout` | トークンを無効にする |
| `GET /me` | `{ name, links: [{ tenantId, company, tel, ownerId, buildings, mgmt }] }` |
| `POST /links` | `{ code }` 管理会社を追加。同じ会社は `409 already_linked`、別アカウントで使用済みは `409 in_use` |
| `GET /months` | `{ months, closed }` |
| `GET /pl?month=YYYY-MM` | `{ total, companies: [{ tenantId, company, pl }] }`。締め前の会社は `pl: null`、`total` は締め済みの会社の和 |
| `GET /proposals?status=sent` | つながっている全社の提案（`quotes` 埋め込み） |
| `GET /companies/{tenantId}/proposals/{id}` | 提案1件 |
| `POST /companies/{tenantId}/proposals/{id}/respond` | `{ decision: approve｜conditional｜return, quoteId, comment }` |
| `GET /remittances` | 全社の送金と明細 |
| `GET /reports` | 月次報告書の一覧（締め済みの月 × 会社） |
| `GET /companies/{tenantId}/reports/{month}` | 月次報告書（締め前は `409 not_closed`） |
| `GET /works` | 全社の工事（段階・経過・写真） |
| `GET /notifications` | お知らせ |
| `GET /photos/{photoId}.svg?t=<token>` | 工事写真（つながっている会社の、本人の工事のみ） |

### 回答のルール（REVO管理 の `ownerRespond` と同じ）
- 回答できるのは `status: sent` の提案だけ。二重回答は `409 already_answered`
- `approve`・`conditional` は提案の `quoteIds` にある `quoteId` が必須
- `return`（差戻し）と `conditional`（条件付き）はコメント3文字以上が必須（条件付きはこのアプリで追加したルール）
- 記録される `response`：`{ decision, quoteId, comment, via: 'owner-app', at }`
- 回答は「記録」。発注などの確定は管理会社の担当者が行う

## 2. 管理会社（REVO管理）との連動

### 2-1. 各社の REVO管理 に用意してほしい API（このサーバーが呼ぶ）
会社ごとに、つながったオーナー（`ownerId`）の分だけを返す。

| メソッド・パス | 中身 | REVO管理 側の元データ |
|---|---|---|
| `GET /owners/{ownerId}` | 名前・物件一覧・管理契約 | owners, buildings, mgmt |
| `GET /owners/{ownerId}/pl?month=` | 月の収支（締め済みの月のみ） | `ownerPL` |
| `GET /owners/{ownerId}/proposals` | 提案と見積 | proposals, quotes |
| `POST /proposals/{id}/respond` | オーナーの回答（`via: 'owner-app'`） | `ownerRespond` |
| `GET /owners/{ownerId}/remittances` | 送金と明細 | payouts の owner 行 |
| `GET /owners/{ownerId}/reports?month=` | 月次報告書 | 月次報告 |
| `GET /owners/{ownerId}/works` | 工事・写真 | orders |
| 招待コードの発行・確認 | コード → `ownerId` | （新規） |

### 2-2. REVO管理 → このサーバー（Webhook）
`POST /api/v1/events`。本文の HMAC-SHA256 を `X-Signature: sha256=<hex>` に付ける（`WEBHOOK_SECRET`。本番は会社ごとの秘密にする）。
本文に **どの会社からか** を `tenantId` で入れる。その会社のオーナー以外を指すイベントは `400`。

```json
{ "type": "proposal.sent", "tenantId": "T-01", "data": { "proposal": { ... }, "quotes": [ ... ] } }
```

| type | data | このサーバーでの動き |
|---|---|---|
| `proposal.sent` | `proposal`, `quotes` | 追加・更新。同じ `threadId` の古い `sent` は `superseded`。お知らせ |
| `proposal.answered` | `proposalId`, `response` | 電話・LINEなど別経路の回答を反映 |
| `order.placed` / `order.completed` / `order.updated` | `order` | 工事を追加・更新。お知らせ |
| `remittance.paid` | `remittance` | 送金を追加・更新。お知らせ |
| `report.published` | `ownerId`, `month` | お知らせ |
| `contract.renewal_due` | `ownerId`, `end` | お知らせ |

### 2-3. このサーバー → REVO管理（オーナーの回答）
モックでは `POST /api/v1/outbox/drain`（署名付き）で、たまった回答（`tenantId` 付き）を取り出せます。
本番では回答のたびに、その会社の REVO管理 の `POST /proposals/{id}/respond` へ送ります。

### 2-4. REVO管理 側でそろえてほしいこと
- 提案・連絡スレッドのオーナーを **名前ではなく `ownerId`** で持つ
- 提案に `buildingId` を持たせる
- 月締め済みの月（`closed`）を返す
- オーナー向けの招待コードの発行
