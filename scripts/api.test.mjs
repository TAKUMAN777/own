// API とルールの自動確認：npm test
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
  const res = await fetch(base + '/api/v1' + path, { method, body: raw, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers } });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const login = async (code) => (await call('/auth/invite', { method: 'POST', body: { code } })).body.token;
const signed = (obj) => {
  const raw = JSON.stringify(obj);
  return { body: raw, headers: { 'x-signature': 'sha256=' + crypto.createHmac('sha256', SECRET).update(raw).digest('hex') } };
};

test('アプリ名はアプリの設定値', async () => {
  const r = await call('/app');
  assert.equal(r.status, 200);
  assert.ok(r.body.name);
});

test('招待コードでログインでき、間違ったコードは拒否', async () => {
  assert.equal((await call('/auth/invite', { method: 'POST', body: { code: 'NOPE' } })).status, 401);
  const r = await call('/auth/invite', { method: 'POST', body: { code: 'hkt-0001' } });
  assert.equal(r.status, 200);
  assert.equal((await call('/me')).status, 401);
  const me = (await call('/me', { token: r.body.token })).body;
  assert.equal(me.name, '田中 靖夫');
  assert.deepEqual(me.links.map((l) => l.tenantId), ['T-01']);
  // 同じコードでもう一度ログインすると、同じアカウントに入る
  const again = await call('/auth/invite', { method: 'POST', body: { code: 'HKT-0001' } });
  assert.equal(again.body.accountId, r.body.accountId);
});

test('管理会社を追加すると、2社分がまとめて見られる', async () => {
  const t = await login('HKT-0001');
  assert.equal((await call('/links', { token: t, method: 'POST', body: { code: 'HKT-0001' } })).status, 409); // 同じ会社
  assert.equal((await call('/links', { token: t, method: 'POST', body: { code: 'BAD' } })).status, 400);
  const me = await call('/links', { token: t, method: 'POST', body: { code: 'TNJ-0011' } });
  assert.equal(me.status, 200);
  assert.deepEqual(me.body.links.map((l) => l.tenantId), ['T-01', 'T-02']);
  // 別のアカウントでは同じコードを使えない
  const t2 = await login('HKT-0002');
  assert.equal((await call('/links', { token: t2, method: 'POST', body: { code: 'TNJ-0011' } })).status, 409);
  // 2社目のコードでログインしても、同じアカウント
  const t3 = await call('/auth/invite', { method: 'POST', body: { code: 'TNJ-0011' } });
  assert.equal((await call('/me', { token: t3.body.token })).body.links.length, 2);

  const pl = (await call('/pl?month=2026-10', { token: t })).body;
  assert.deepEqual(pl.companies.map((c) => c.tenantId), ['T-01', 'T-02']);
  const rems = (await call('/remittances', { token: t })).body;
  assert.deepEqual([...new Set(rems.map((r) => r.tenantId))].sort(), ['T-01', 'T-02']);
  const works = (await call('/works', { token: t })).body;
  assert.ok(works.some((w) => w.tenantId === 'T-02'));
});

test('つながっていない会社・他のオーナーのデータは見られない', async () => {
  const t = await login('HKT-0002'); // 山本様（T-01 のみ）
  assert.equal((await call('/companies/T-01/proposals/PR-301', { token: t })).status, 404); // 田中様の提案
  assert.equal((await call('/companies/T-02/reports/2026-10', { token: t })).status, 404);
  assert.equal((await call('/companies/T-01/proposals/PR-301/respond', { token: t, method: 'POST', body: { decision: 'approve', quoteId: 'Q-301' } })).status, 404);
  const ps = (await call('/proposals', { token: t })).body;
  assert.ok(ps.every((p) => p.ownerId === 'OW-02'));
});

test('月締め前の月は出さない', async () => {
  const t = await login('HKT-0001');
  const nov = (await call('/pl?month=2026-11', { token: t })).body;
  assert.equal(nov.total, null);
  assert.ok(nov.companies.every((c) => c.pl === null));
  assert.equal((await call('/companies/T-01/reports/2026-11', { token: t })).status, 409);
});

test('金額が一致する：送金額 = 入金 − 管理料 − 費用 − 工事代金、合計 = 各社・各物件の和', async () => {
  for (const code of ['HKT-0001', 'HKT-0002']) {
    const t = await login(code);
    const rems = (await call('/remittances', { token: t })).body;
    assert.ok(rems.length > 0);
    for (const month of [...new Set(rems.map((r) => r.month))]) {
      const all = (await call(`/pl?month=${month}`, { token: t })).body;
      for (const k of ['billed', 'received', 'unpaid', 'fee', 'expense', 'remit', 'occupied', 'units']) {
        assert.equal(all.total[k], all.companies.reduce((s, c) => s + c.pl[k], 0), `全社の ${k}`);
      }
      for (const { tenantId, pl } of all.companies) {
        assert.equal(pl.remit, pl.received - pl.fee - pl.expense);
        assert.equal(pl.billed, pl.received + pl.unpaid);
        for (const k of ['billed', 'received', 'unpaid', 'fee', 'expense', 'remit', 'occupied', 'units']) {
          assert.equal(pl[k], pl.buildings.reduce((s, b) => s + b[k], 0), `${k} の合計`);
        }
        const r = rems.find((x) => x.month === month && x.tenantId === tenantId);
        assert.equal(r.detail.received, pl.received);
        assert.equal(r.detail.works, r.detail.worksOrders.reduce((s, w) => s + w.amount, 0));
        assert.equal(r.amount, r.detail.received - r.detail.fee - r.detail.expense - r.detail.works);
      }
    }
  }
});

test('工事代金は1回だけ差し引く', async () => {
  const t = await login('HKT-0001');
  const rems = (await call('/remittances', { token: t })).body;
  const ids = rems.flatMap((r) => r.detail.worksOrders.map((w) => w.orderId));
  assert.equal(ids.length, new Set(ids).size);
});

test('提案への回答：ルールどおりに記録され、その管理会社に届く', async () => {
  const t = await login('HKT-0001');
  const pending = (await call('/proposals?status=sent', { token: t })).body;
  assert.equal(pending.length, 1);
  const p = pending[0];
  assert.equal(p.company, '〇〇不動産管理株式会社');
  const post = (body) => call(`/companies/${p.tenantId}/proposals/${p.id}/respond`, { token: t, method: 'POST', body });
  assert.equal((await post({ decision: 'return', comment: 'no' })).status, 400);
  assert.equal((await post({ decision: 'conditional', quoteId: p.quoteIds[0], comment: '' })).status, 400);
  assert.equal((await post({ decision: 'approve', quoteId: 'Q-XXX' })).status, 400);
  assert.equal((await post({ decision: 'maybe' })).status, 400);
  // 違う会社のパスでは回答できない
  assert.equal((await call(`/companies/T-02/proposals/${p.id}/respond`, { token: t, method: 'POST', body: { decision: 'approve', quoteId: p.quoteIds[0] } })).status, 404);
  const ok = await post({ decision: 'approve', quoteId: p.quoteIds[1], comment: 'お願いします' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.status, 'approved');
  assert.equal(ok.body.response.via, 'owner-app');
  assert.equal((await post({ decision: 'approve', quoteId: p.quoteIds[0] })).status, 409);

  assert.equal((await call('/outbox/drain', { method: 'POST', body: '{}' })).status, 401);
  const out = await call('/outbox/drain', { method: 'POST', ...signed({}) });
  assert.equal(out.body.items.length, 1);
  assert.equal(out.body.items[0].type, 'proposal.answered');
  assert.equal(out.body.items[0].tenantId, 'T-01');
});

test('イベント：署名・会社の確認、proposal.sent で古い版は superseded（承認待ちは1件まで）', async () => {
  const ev = (v, tenantId = 'T-01') => ({ type: 'proposal.sent', tenantId, data: { proposal: { id: `PR-311-v${v}`, threadId: 'TH-31', ownerId: 'OW-02', buildingId: 'BL-03', version: v, title: `塗装 v${v}`, quoteIds: ['Q-311'], recommendedId: 'Q-311', reason: '再見積', notes: '', sentAt: new Date().toISOString() } } });
  assert.equal((await call('/events', { method: 'POST', body: ev(2), headers: { 'x-signature': 'sha256=bad' } })).status, 401);
  assert.equal((await call('/events', { method: 'POST', ...signed(ev(2, 'T-02')) })).status, 400); // 他社のオーナー
  assert.equal((await call('/events', { method: 'POST', ...signed(ev(2)) })).status, 200);
  assert.equal((await call('/events', { method: 'POST', ...signed(ev(3)) })).status, 200);
  const t = await login('HKT-0002');
  const pending = (await call('/proposals?status=sent', { token: t })).body;
  assert.deepEqual(pending.map((p) => p.id), ['PR-311-v3']);
  const notes = (await call('/notifications', { token: t })).body;
  assert.ok(notes.some((n) => n.type === 'proposal.sent' && n.company === '〇〇不動産管理株式会社'));
});

test('報告書は部屋番号まで（入居者の情報を含まない）', async () => {
  const t = await login('HKT-0001');
  const r = await call('/companies/T-01/reports/2026-10', { token: t });
  assert.equal(r.status, 200);
  for (const b of r.body.pl.buildings) for (const room of b.rooms) assert.deepEqual(Object.keys(room).sort(), ['no', 'status']);
});

test('写真はつながっている会社の、本人の工事のものだけ', async () => {
  const t1 = await login('HKT-0001');
  const t2 = await login('HKT-0002');
  assert.equal((await fetch(`${base}/photos/ph-290-1.svg?t=${t1}`)).status, 200);
  assert.equal((await fetch(`${base}/photos/ph-290-1.svg?t=${t2}`)).status, 404);
  assert.equal((await fetch(`${base}/photos/ph-290-1.svg`)).status, 404);
});

test('画面に管理システム（REVO）の名前を出さない', () => {
  for (const f of ['public/index.html', 'public/app.js', 'public/styles.css']) {
    const src = fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
      .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    assert.ok(!/revo|レボ/i.test(src), `${f} に REVO の名前があります`);
  }
});

test('静的配信：パスの外は読めない', async () => {
  const r = await fetch(`${base}/..%2fpackage.json`);
  assert.notEqual(r.status, 200);
});
