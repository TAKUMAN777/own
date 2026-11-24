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

test('管理システムの名前は画面のコードに書かず、データから出す', () => {
  for (const f of ['public/index.html', 'public/app.js', 'public/styles.css']) {
    const src = fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
      .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    assert.ok(!/\bREVO\b|レボ/.test(src), `${f} に管理システムの名前が直接書かれています`);
  }
});

test('静的配信：パスの外は読めない', async () => {
  const r = await fetch(`${base}/..%2fpackage.json`);
  assert.notEqual(r.status, 200);
});

// ---------- 資産 ----------
test('資産：連携・自主管理の建物が並び、合計と利回りが合う', async () => {
  const t = await login('HKT-0001');
  const { summary, list } = (await call('/assets', { token: t })).body;
  assert.ok(list.some((x) => x.source === 'link' && x.system === 'REVO管理'));
  assert.ok(list.some((x) => x.source === 'self'));
  assert.equal(summary.count, list.length);
  assert.equal(summary.price, list.reduce((s, x) => s + x.finance.price, 0));
  assert.equal(summary.units, list.reduce((s, x) => s + x.kpi.units, 0));
  for (const x of list) {
    assert.equal(x.kpi.fullYear, x.rooms.reduce((s, r) => s + (r.rent + r.fee) * 12, 0));
    if (x.finance.price) assert.equal(x.kpi.grossYield, x.kpi.fullYear / x.finance.price);
  }
  // 連携の建物の月ごとの収支は、管理会社の計算（pl）と一致
  const link = list.find((x) => x.source === 'link');
  const d = (await call(`/assets/${link.id}`, { token: t })).body;
  const pl = (await call('/pl?month=2026-10', { token: t })).body;
  const b = pl.companies.find((c) => c.tenantId === link.tenantId).pl.buildings.find((v) => v.buildingId === link.buildingId);
  const m = d.monthly.find((v) => v.month === '2026-10');
  assert.equal(m.income, b.received);
  assert.equal(m.net, b.remit);
});

test('資産：REVO MANAGER の会社ともつながる', async () => {
  const t = await login('HKT-0001');
  const me = await call('/links', { token: t, method: 'POST', body: { code: 'MGR-0021' } });
  assert.equal(me.status, 200);
  const { list } = (await call('/assets', { token: t })).body;
  assert.ok(list.some((x) => x.system === 'REVO MANAGER' && x.name === 'メゾン六本松'));
});

test('資産：資料から作る・自主管理で入力・収支の記録・削除', async () => {
  const t = await login('HKT-0002');
  assert.equal((await call('/assets', { token: t, method: 'POST', body: { source: 'self', name: '' } })).status, 400);
  const created = await call('/assets', {
    token: t, method: 'POST', body: {
      source: 'import', company: '別の管理会社', name: 'テスト荘', finance: { price: '20,000,000' },
      rooms: [{ no: '101', rent: 50000, fee: 2000, status: '入居中', tenantName: '入居者 太郎', tel: '090' }, { no: '102', rent: 50000, status: '空室' }],
      ledger: [{ month: '2026-10', type: 'income', category: '賃料', amount: 52000 }, { month: '2026-10', type: 'expense', category: '管理料', amount: 2600 }],
    },
  });
  assert.equal(created.status, 200);
  const a = created.body;
  assert.equal(a.finance.price, 20000000);
  // 入居者の情報は保存しない
  assert.deepEqual(Object.keys(a.rooms[0]).sort(), ['fee', 'layout', 'no', 'rent', 'status']);
  assert.equal(a.kpi.grossYield, (52000 + 50000) * 12 / 20000000);
  assert.deepEqual(a.monthly, [{ month: '2026-10', income: 52000, expense: 2600, net: 49400 }]);
  // 収支の取込：1行でも不正なら全部取り込まない
  assert.equal((await call(`/assets/${a.id}/ledger`, { token: t, method: 'POST', body: { entries: [{ month: '2026-11', type: 'income', category: '賃料', amount: 1 }, { month: '2026-13', type: 'income', category: 'x', amount: 1 }] } })).status, 400);
  const added = await call(`/assets/${a.id}/ledger`, { token: t, method: 'POST', body: { source: 'import', entries: [{ month: '2026-11', type: 'income', category: '賃料', amount: 52000 }] } });
  assert.equal(added.body.ledger.length, 3);
  // 収支・送金の画面にも出る
  const pl = (await call('/pl?month=2026-10', { token: t })).body;
  assert.equal(pl.own.find((o) => o.assetId === a.id).net, 49400);
  // 他の人の資産は見られない
  const t1 = await login('HKT-0001');
  assert.equal((await call(`/assets/${a.id}`, { token: t1 })).status, 404);
  // 連携の建物は取得価格だけ変えられ、削除はできない
  const link = (await call('/assets', { token: t })).body.list.find((x) => x.source === 'link');
  const upd = await call(`/assets/${link.id}`, { token: t, method: 'PATCH', body: { name: '名前変更', finance: { price: 50000000 } } });
  assert.equal(upd.body.name, link.name);
  assert.equal(upd.body.finance.price, 50000000);
  assert.equal((await call(`/assets/${link.id}`, { token: t, method: 'DELETE' })).status, 404);
  assert.equal((await call(`/assets/${a.id}`, { token: t, method: 'DELETE' })).status, 200);
  assert.equal((await call(`/assets/${a.id}`, { token: t })).status, 404);
});

test('資料の読み込み：部屋一覧・収支・Shift_JIS、入居者名の列は読まない', async () => {
  const { decode, parseCSV, detect, SAMPLES, normMonth } = await import('../public/csv.js');
  const rooms = detect(parseCSV(SAMPLES.rooms));
  assert.equal(rooms.kind, 'rooms');
  assert.equal(rooms.items.length, 4);
  assert.deepEqual(rooms.ignored, ['入居者名']);
  assert.ok(rooms.items.every((r) => !Object.values(r).includes('（読み込みません）')));
  assert.equal(rooms.items[1].status, '空室');
  const led = detect(parseCSV(SAMPLES.ledger));
  assert.equal(led.kind, 'ledger');
  assert.deepEqual(led.items[0], { month: '2026-09', type: 'income', category: '賃料', amount: 190000, room: '' });
  assert.equal(led.items[1].type, 'expense');
  // 入金・出金の2列、カンマ付き金額、引用符
  const two = detect(parseCSV('日付,摘要,入金,出金\n2026/10/25,"家賃 10月分","152,000",\n2026年10月,修繕,,"33,000"\n'));
  assert.deepEqual(two.items.map((i) => [i.month, i.type, i.amount]), [['2026-10', 'income', 152000], ['2026-10', 'expense', 33000]]);
  assert.equal(normMonth('2026年1月'), '2026-01');
  assert.equal(normMonth('foo'), '');
  // Shift_JIS（Excel の CSV）
  const sjis = Buffer.from([0x95, 0x94, 0x89, 0xae, 0x2c, 0x92, 0xc0, 0x97, 0xbf, 0x0a, 0x31, 0x30, 0x31, 0x2c, 0x35, 0x30, 0x30, 0x30, 0x30, 0x0a]); // 部屋,賃料 / 101,50000
  const r2 = detect(parseCSV(decode(sjis)));
  assert.equal(r2.kind, 'rooms');
  assert.equal(r2.items[0].rent, 50000);
  assert.equal(detect(parseCSV('a,b\n1,2')).kind, null);
});

// ---------- 資産価値・タイムライン ----------
test('資産価値：推定＝年間の手取り÷想定の利回り、査定額があればそれを使う、合計が合う', async () => {
  const t = await login('HKT-0001');
  const { summary, list } = (await call('/assets', { token: t })).body;
  assert.equal(summary.value, list.reduce((s, x) => s + x.value.value, 0));
  assert.equal(summary.equity, list.reduce((s, x) => s + x.value.equity, 0));
  for (const x of list) {
    assert.equal(x.value.noi, x.kpi.curYear - x.kpi.annualCost);
    assert.equal(x.value.equity, x.value.value - (x.finance.loanBalance || 0));
    if (x.value.method === 'income' && x.value.noi > 0) assert.ok(Math.abs(x.value.value - x.value.noi / (x.value.capRate / 100)) <= 5000);
  }
  const x = list.find((v) => v.source === 'link');
  const upd = (await call(`/assets/${x.id}`, { token: t, method: 'PATCH', body: { finance: { ...x.finance, appraisal: 150000000 } } })).body;
  assert.equal(upd.value.method, 'appraisal');
  assert.equal(upd.value.value, 150000000);
  const cap = (await call(`/assets/${x.id}`, { token: t, method: 'PATCH', body: { finance: { ...x.finance, appraisal: 0, capRate: 4 } } })).body;
  assert.equal(cap.value.capRate, 4);
});

test('過去・現在・未来：建物・部屋・全体のタイムライン、ローン完済、10年の見通し', async () => {
  const t = await login('HKT-0001');
  const { list } = (await call('/assets', { token: t })).body;
  const x = list.find((v) => v.source === 'link' && v.buildingId === 'BL-01');
  const d = (await call(`/assets/${x.id}`, { token: t })).body;
  const kinds = new Set(d.timeline.map((e) => e.kind));
  for (const k of ['build', 'acquire', 'contract', 'money', 'work', 'proposal', 'room', 'repair', 'loan', 'now']) assert.ok(kinds.has(k), `${k} がない`);
  assert.ok(d.timeline.every((e, i, a) => i === 0 || a[i - 1].at <= e.at), '時間の順');
  assert.ok(d.timeline.some((e) => e.when === 'past') && d.timeline.some((e) => e.when === 'future'));
  assert.equal(d.timeline.filter((e) => e.kind === 'now').length, 1);
  assert.ok(d.loan.payoff > d.now);
  assert.equal(d.projection.years.length, 10);
  for (const y of d.projection.years) assert.equal(y.cash, y.rent - y.cost - y.repair - y.loan);
  assert.ok(d.projection.years[9].loanBalance < d.finance.loanBalance);
  // 部屋：その部屋の出来事だけ（工事・提案の「203号室」も含む）
  const r = (await call(`/assets/${x.id}/rooms/203`, { token: t })).body;
  assert.equal(r.room.no, '203');
  assert.ok(r.timeline.every((e) => e.room === '203'));
  assert.ok(r.timeline.some((e) => e.kind === 'proposal'));
  assert.deepEqual(Object.keys(r.room).filter((k) => /name|tel|tenant/i.test(k)), []);
  assert.equal((await call(`/assets/${x.id}/rooms/999`, { token: t })).status, 404);
  // 全体
  const all = (await call('/timeline', { token: t })).body;
  assert.ok(new Set(all.events.filter((e) => e.assetId).map((e) => e.assetId)).size === list.length);
  assert.equal(all.events.filter((e) => e.kind === 'now').length, 1);
});

test('招待コードなしで始める・デモを見る', async () => {
  assert.equal((await call('/auth/start', { method: 'POST', body: { name: '  ' } })).status, 400);
  const st = await call('/auth/start', { method: 'POST', body: { name: '佐藤 花子' } });
  assert.equal(st.status, 200);
  const t = st.body.token;
  const me = (await call('/me', { token: t })).body;
  assert.equal(me.name, '佐藤 花子');
  assert.deepEqual(me.links, []);
  const as = (await call('/assets', { token: t })).body;
  assert.equal(as.summary.count, 0);
  // 管理会社なしでも各画面のデータは返る
  for (const path of ['/proposals', '/remittances', '/reports', '/works', '/notifications', '/timeline', '/pl?month=2026-10']) {
    assert.equal((await call(path, { token: t })).status, 200, path);
  }
  // 自主管理の資産を作れる
  assert.equal((await call('/assets', { token: t, method: 'POST', body: { source: 'self', name: '佐藤アパート', rooms: [{ no: '1', rent: 50000 }] } })).status, 200);
  // デモ：田中様の例。何度押しても同じアカウント
  const d1 = (await call('/auth/demo', { method: 'POST' })).body;
  const d2 = (await call('/auth/demo', { method: 'POST' })).body;
  assert.equal(d1.accountId, d2.accountId);
  const dm = (await call('/me', { token: d1.token })).body;
  assert.equal(dm.name, '田中 靖夫');
  assert.ok(dm.links.length >= 1);
});

// ---------- 10000回テストで見つかった不具合の再発防止 ----------
test('再発防止：壊れた入力でサーバーが落ちない（null の本文・壊れた %xx）', async () => {
  const t = await login('HKT-0001');
  assert.equal((await call('/auth/start', { method: 'POST', body: 'null' })).status, 400);
  assert.equal((await call('/assets/%E0%A4%A', { token: t })).status, 400);
  const res = await fetch(`${base}/%E0%A4%A`);
  assert.equal(res.status, 400);
});

test('再発防止：大きすぎる数字は受け付けない、資産の登録は全部か無しか', async () => {
  const st = (await call('/auth/start', { method: 'POST', body: { name: '検証' } })).body.token;
  assert.equal((await call('/assets', { token: st, method: 'POST', body: { source: 'self', name: 'A', rooms: [{ no: '1', rent: 9e20 }] } })).status, 400);
  assert.equal((await call('/assets', { token: st, method: 'POST', body: { source: 'self', name: 'A', finance: { price: 1e13 } } })).status, 400);
  assert.equal((await call('/assets', { token: st, method: 'POST', body: { source: 'self', name: 'A', floors: 1e9 } })).status, 400);
  // 記録が1件でも不正なら、資産も作られない
  assert.equal((await call('/assets', { token: st, method: 'POST', body: { source: 'import', name: 'B', ledger: [{ month: '2026-10', type: 'income', category: '賃料', amount: 1 }, { month: 'x', type: 'income', category: 'a', amount: 1 }] } })).status, 400);
  assert.equal((await call('/assets', { token: st })).body.summary.count, 0);
});

test('再発防止：ローンが50年で終わらないときは完済見込みを出さない', async () => {
  const ins = await import('../server/insights.mjs');
  const L = ins.loanPlan({ loanBalance: 333360547, loanRate: 0.44, loanMonthly: 151845 });
  assert.equal(L.payoff, null);
  assert.ok(L.warning);
});

test('再発防止：資料の入金・出金が同じ行にあれば2件、1円未満は読まない', async () => {
  const { parseCSV, detect } = await import('../public/csv.js');
  const r = detect(parseCSV('日付,摘要,入金,出金\n2026/10,精算,"299,000","174,000"\n2026/10,端数,0.4,\n'));
  assert.deepEqual(r.items.map((i) => [i.type, i.amount]), [['income', 299000], ['expense', 174000]]);
});
