// API とルールの自動確認：node --test scripts/
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createServer } from '../server/server.mjs';

const SECRET = 'test-secret';
let base, server;

test.before(async () => {
  server = createServer({ webhookSecret: SECRET });
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
test.after(() => server.close());

const call = async (path, { token, method = 'GET', body, headers = {} } = {}) => {
  const raw = body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body));
  const res = await fetch(base + path, { method, body: raw, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers } });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const login = async (code) => (await call('/api/v1/auth/invite', { method: 'POST', body: { code } })).body.token;
const signed = (obj) => {
  const raw = JSON.stringify(obj);
  return { body: raw, headers: { 'x-signature': 'sha256=' + crypto.createHmac('sha256', SECRET).update(raw).digest('hex') } };
};

test('招待コードでログインでき、間違ったコードは拒否', async () => {
  assert.equal((await call('/api/v1/auth/invite', { method: 'POST', body: { code: 'NOPE' } })).status, 401);
  const r = await call('/api/v1/auth/invite', { method: 'POST', body: { code: 'hkt-0001' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.ownerId, 'OW-01');
  assert.equal((await call('/api/v1/me')).status, 401);
});

test('他のオーナーのデータは見られない', async () => {
  const t = await login('HKT-0001');
  assert.equal((await call('/api/v1/owners/OW-02/pl?month=2026-10', { token: t })).status, 403);
  assert.equal((await call('/api/v1/proposals/PR-311', { token: t })).status, 404);
  assert.equal((await call('/api/v1/proposals/PR-311/respond', { token: t, method: 'POST', body: { decision: 'approve', quoteId: 'Q-311' } })).status, 404);
});

test('月締め前の月は出さない', async () => {
  const t = await login('HKT-0001');
  assert.equal((await call('/api/v1/owners/OW-01/pl?month=2026-11', { token: t })).status, 409);
  assert.equal((await call('/api/v1/owners/OW-01/pl?month=2026-10', { token: t })).status, 200);
});

test('金額が一致する：送金額 = 入金 − 管理料 − 費用 − 工事代金、物件の合計 = 全体', async () => {
  for (const [code, id] of [['HKT-0001', 'OW-01'], ['HKT-0002', 'OW-02']]) {
    const t = await login(code);
    const rems = (await call(`/api/v1/owners/${id}/remittances`, { token: t })).body;
    assert.ok(rems.length > 0);
    for (const r of rems) {
      const pl = (await call(`/api/v1/owners/${id}/pl?month=${r.month}`, { token: t })).body;
      assert.equal(pl.remit, pl.received - pl.fee - pl.expense);
      assert.equal(pl.billed, pl.received + pl.unpaid);
      for (const k of ['billed', 'received', 'unpaid', 'fee', 'expense', 'remit', 'occupied', 'units']) {
        assert.equal(pl[k], pl.buildings.reduce((s, b) => s + b[k], 0), `${k} の合計`);
      }
      assert.equal(r.detail.received, pl.received);
      assert.equal(r.detail.works, r.detail.worksOrders.reduce((s, w) => s + w.amount, 0));
      assert.equal(r.amount, r.detail.received - r.detail.fee - r.detail.expense - r.detail.works);
    }
  }
});

test('工事代金は1回だけ差し引く', async () => {
  const t = await login('HKT-0001');
  const rems = (await call('/api/v1/owners/OW-01/remittances', { token: t })).body;
  const ids = rems.flatMap((r) => r.detail.worksOrders.map((w) => w.orderId));
  assert.equal(ids.length, new Set(ids).size);
});

test('提案への回答：ルールどおりに記録される', async () => {
  const t = await login('HKT-0001');
  const pending = (await call('/api/v1/owners/OW-01/proposals?status=sent', { token: t })).body;
  assert.equal(pending.length, 1);
  const p = pending[0];
  const post = (body) => call(`/api/v1/proposals/${p.id}/respond`, { token: t, method: 'POST', body });
  assert.equal((await post({ decision: 'return', comment: 'no' })).status, 400); // 理由3文字未満
  assert.equal((await post({ decision: 'conditional', quoteId: p.quoteIds[0], comment: '' })).status, 400);
  assert.equal((await post({ decision: 'approve', quoteId: 'Q-XXX' })).status, 400);
  assert.equal((await post({ decision: 'maybe' })).status, 400);
  const ok = await post({ decision: 'approve', quoteId: p.quoteIds[1], comment: 'お願いします' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.status, 'approved');
  assert.equal(ok.body.response.via, 'owner-app');
  assert.equal(ok.body.response.quoteId, p.quoteIds[1]);
  assert.equal((await post({ decision: 'approve', quoteId: p.quoteIds[0] })).status, 409); // 二重回答は不可

  // 回答は REVO管理 向けの送信待ちに入る（署名が必要）
  assert.equal((await call('/api/v1/outbox/drain', { method: 'POST', body: '{}' })).status, 401);
  const out = await call('/api/v1/outbox/drain', { method: 'POST', ...signed({}) });
  assert.equal(out.body.items.length, 1);
  assert.equal(out.body.items[0].type, 'proposal.answered');
});

test('イベント：署名がないと拒否、proposal.sent で古い版は superseded（承認待ちは1件まで）', async () => {
  const ev = (v) => ({ type: 'proposal.sent', data: { proposal: { id: `PR-311-v${v}`, threadId: 'TH-31', ownerId: 'OW-02', buildingId: 'BL-03', version: v, title: `塗装 v${v}`, quoteIds: ['Q-311'], recommendedId: 'Q-311', reason: '再見積', notes: '', sentAt: new Date().toISOString() } } });
  assert.equal((await call('/api/v1/events', { method: 'POST', body: ev(2), headers: { 'x-signature': 'sha256=bad' } })).status, 401);
  assert.equal((await call('/api/v1/events', { method: 'POST', ...signed(ev(2)) })).status, 200);
  assert.equal((await call('/api/v1/events', { method: 'POST', ...signed(ev(3)) })).status, 200);
  const t = await login('HKT-0002');
  const pending = (await call('/api/v1/owners/OW-02/proposals?status=sent', { token: t })).body;
  assert.deepEqual(pending.map((p) => p.id), ['PR-311-v3']);
  const notes = (await call('/api/v1/owners/OW-02/notifications', { token: t })).body;
  assert.ok(notes.some((n) => n.type === 'proposal.sent'));
});

test('報告書は部屋番号まで（入居者の情報を含まない）', async () => {
  const t = await login('HKT-0001');
  const r = await call('/api/v1/owners/OW-01/reports?month=2026-10', { token: t });
  assert.equal(r.status, 200);
  for (const b of r.body.pl.buildings) for (const room of b.rooms) assert.deepEqual(Object.keys(room).sort(), ['no', 'status']);
});

test('写真はログイン中の本人のものだけ', async () => {
  const t1 = await login('HKT-0001');
  const t2 = await login('HKT-0002');
  assert.equal((await fetch(`${base}/photos/ph-290-1.svg?t=${t1}`)).status, 200);
  assert.equal((await fetch(`${base}/photos/ph-290-1.svg?t=${t2}`)).status, 404);
  assert.equal((await fetch(`${base}/photos/ph-290-1.svg`)).status, 404);
});

test('オーナーに見える画面に REVO の名前を出さない', () => {
  for (const f of ['public/index.html', 'public/app.js', 'public/styles.css']) {
    const src = fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
      .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n'); // コメント行は除く
    assert.ok(!/revo|レボ/i.test(src), `${f} に REVO の名前があります`);
  }
});

test('静的配信：パスの外は読めない', async () => {
  const r = await fetch(`${base}/..%2fpackage.json`);
  assert.notEqual(r.status, 200);
});
