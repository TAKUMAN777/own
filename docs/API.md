# 連動API（オーナー向けサービス ⇄ REVO管理）

引き継ぎメモ「6. 連動のAPI案」を、このリポジトリで実際に動く形にしたものです。
今は `server/` のモック（架空データ）が応えます。本番では REVO管理 側が同じ形の API を実装し、
`server/store.mjs` の中身を REVO管理 API の呼び出しに置き換えます。

- 先頭：`/api/v1`
- 認証：`POST /auth/invite` で受け取ったトークンを `Authorization: Bearer <token>` で送る（12時間有効）
- パスの `ownerId` がログイン中のオーナーと違うときは `403`
- エラー：`{ "error": "<code>", "message": "<日本語の説明>" }`

## オーナー向けアプリ → このサーバー

| メソッド・パス | 中身 | REVO管理 側の元データ |
|---|---|---|
| `GET /tenant` | `{ company, ownerService, tel, demo }`（ログイン前に使う。表示は「サービス名｜会社名」） | `RevoCompany.get()` |
| `POST /auth/invite` | `{ code }` → `{ token, ownerId }`。5回間違えると1分待ち | 招待コード（管理会社が発行） |
| `POST /auth/logout` | トークンを無効にする | |
| `GET /me`・`GET /owners/{ownerId}` | 名前・物件一覧・管理委託契約（口座番号は返さない） | owners, buildings, mgmt |
| `GET /months` | `{ months, closed }` | `MONTHS`, `closed` |
| `GET /owners/{ownerId}/pl?month=YYYY-MM` | 月の収支（`ownerPL` の形＋物件ごとの `rooms`・`expenses`）。**締め前の月は `409 not_closed`** | `ownerPL` |
| `GET /owners/{ownerId}/proposals?status=sent` | 提案（`quotes` を埋め込み）。`draft`・`superseded` は返さない | proposals, quotes |
| `GET /proposals/{id}` | 提案1件 | |
| `POST /proposals/{id}/respond` | `{ decision: approve｜conditional｜return, quoteId, comment }` | `ownerRespond(..., { via: 'owner-app' })` |
| `GET /owners/{ownerId}/remittances` | 送金の履歴と明細 `{ amount, detail: { received, fee, expense, works, worksOrders } }` | payouts の owner 行 |
| `GET /owners/{ownerId}/reports` | 月次報告書の一覧（締め済みの月） | |
| `GET /owners/{ownerId}/reports?month=` | 月次報告書のデータ（収支・送金・経過メモ・工事・部屋の状況）。画面から印刷／PDF保存 | 月次報告 |
| `GET /owners/{ownerId}/works` | 工事（発注〜支払済の段階・経過・完了報告の写真） | orders |
| `GET /owners/{ownerId}/notifications` | イベントから作ったお知らせ | |
| `GET /photos/{photoId}.svg?t=<token>` | 工事写真（本人の工事のものだけ） | 完了報告の写真 |

### 回答のルール（`ownerRespond` と同じ）
- 回答できるのは `status: sent` の提案だけ。二重回答は `409 already_answered`
- `approve`・`conditional` は提案の `quoteIds` にある `quoteId` が必須
- `return`（差戻し）と `conditional`（条件付き）はコメント3文字以上が必須（条件付きは、このサービスで追加したルール）
- 記録される `response`：`{ decision, quoteId, comment, via: 'owner-app', at }`
- 回答は「記録」。発注などの確定は管理会社の担当者が行う

## REVO管理 → このサーバー（Webhook）

`POST /events`。本文の HMAC-SHA256 を `X-Signature: sha256=<hex>` に付ける（共有の秘密は環境変数 `WEBHOOK_SECRET`）。

```json
{ "type": "proposal.sent", "data": { "proposal": { ... }, "quotes": [ ... ] } }
```

| type | data | このサーバーでの動き |
|---|---|---|
| `proposal.sent` | `proposal`（`ownerId` 必須）, `quotes` | 追加・更新。同じ `threadId` の古い `sent` は `superseded`。お知らせを作る |
| `proposal.answered` | `proposalId`, `response` | 電話・LINEなど別経路の回答を反映 |
| `order.placed` / `order.completed` / `order.updated` | `order`（`ownerId` 必須） | 工事を追加・更新。お知らせ |
| `remittance.paid` | `remittance`（`ownerId` 必須） | 送金を追加・更新。お知らせ |
| `report.published` | `ownerId`, `month` | お知らせ |
| `contract.renewal_due` | `ownerId`, `end` | お知らせ |

## このサーバー → REVO管理（オーナーの回答）

モックでは `POST /outbox/drain`（署名付き）で、たまった `proposal.answered` を取り出せます。
本番では回答のたびに REVO管理 側の API（例：`POST /proposals/{id}/respond`）へ直接送ります。

## REVO管理 側でそろえてほしいこと
- 連絡スレッド・提案の `owner` を **オーナー名ではなく `ownerId`** にする（このAPIは `ownerId` 前提）
- 提案に `buildingId` を持たせる
- 月締め済みの月（`closed`）を API で返す
- 招待コードの発行と、オーナーID・テナントとのひも付け
