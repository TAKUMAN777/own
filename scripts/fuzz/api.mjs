// ① ランダムな操作（状態を持った連続操作）② 不正な入力 ③ 管理会社からのイベント
import crypto from 'node:crypto';
import { createServer } from '../../server/server.mjs';
import { rng, str, num, anyValue } from './lib.mjs';

const SECRET = 'fuzz-secret';
const MONEY_KEYS = new Set(['billed', 'received', 'unpaid', 'fee', 'expense', 'remit', 'amount', 'price', 'loanBalance', 'loanMonthly', 'propertyTax', 'insurance', 'appraisal', 'rent', 'income', 'net', 'value', 'equity', 'noi', 'fullYear', 'curYear', 'annualCost', 'cash', 'cost', 'repair', 'loan', 'total', 'works']);
const ROOM_KEYS = new Set(['no', 'layout', 'rent', 'fee', 'status', 'since', 'moveOut', 'leaseEnd']);
const PII = 'PIIMARK';

export async function runApi(t, seed, { ops = 4000, fuzz = 2000, events = 500 } = {}) {
  const server = createServer({ webhookSecret: SECRET });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const r = rng(seed);

  const call = async (path, { token, method = 'GET', body, raw, headers = {} } = {}) => {
    const payload = raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body);
    const res = await fetch(base + path, { method, body: payload, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers } });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* 画面のファイルなど */ }
    return { status: res.status, body: json, text };
  };
  const api = (p, o) => call('/api/v1' + p, o);

  // ---------- 不変条件 ----------
  const problems = [];
  const fail = (m) => { problems.push(m); };
  function scanMoney(o, where) {
    if (Array.isArray(o)) return o.forEach((v, i) => scanMoney(v, `${where}[${i}]`));
    if (o && typeof o === 'object') {
      for (const [k, v] of Object.entries(o)) {
        if (MONEY_KEYS.has(k) && typeof v === 'number' && (!Number.isFinite(v) || !Number.isSafeInteger(Math.round(v)))) fail(`金額が範囲外 ${where}.${k}=${v}`);
        scanMoney(v, `${where}.${k}`);
      }
    }
  }
  async function invariants(acc) {
    problems.length = 0;
    const me = await api('/me', { token: acc.token });
    if (me.status !== 200) { fail(`/me ${me.status}`); return [...problems]; }
    const as = await api('/assets', { token: acc.token });
    if (as.status !== 200) fail(`/assets ${as.status}`);
    else {
      const { summary: s, list } = as.body;
      const sum = (f) => list.reduce((a, x) => a + f(x), 0);
      if (s.count !== list.length) fail('資産の件数が合わない');
      if (s.price !== sum((x) => x.finance.price || 0)) fail('取得額の合計が合わない');
      if (s.units !== sum((x) => x.kpi.units)) fail('部屋数の合計が合わない');
      if (s.value !== sum((x) => x.value.value)) fail('資産価値の合計が合わない');
      if (s.equity !== sum((x) => x.value.equity)) fail('純資産の合計が合わない');
      for (const x of list) {
        if (x.kpi.occupied > x.kpi.units) fail(`入居が部屋数を超える ${x.id}`);
        if (x.value.equity !== x.value.value - (x.finance.loanBalance || 0)) fail(`純資産の式 ${x.id}`);
        if (x.value.value < 0) fail(`資産価値がマイナス ${x.id}`);
        if (x.kpi.fullYear !== x.rooms.reduce((a, rm) => a + (rm.rent + rm.fee) * 12, 0)) fail(`満室想定の式 ${x.id}`);
        if (x.finance.price && Math.abs(x.kpi.grossYield - x.kpi.fullYear / x.finance.price) > 1e-12) fail(`表面利回りの式 ${x.id}`);
        for (const rm of x.rooms) for (const k of Object.keys(rm)) if (!ROOM_KEYS.has(k)) fail(`部屋に余計な項目 ${k}`);
        if (x.source !== 'link' && !acc.own.has(x.id)) fail(`知らない資産が見える ${x.id} name=${x.name} src=${x.source} acc=${acc.accountId} own=${[...acc.own].join("/")}`);
      }
      for (const id of acc.own) if (!list.some((x) => x.id === id)) fail(`作った資産が消えた ${id}`);
      scanMoney(as.body, 'assets');
      if (list.length) {
        const x = r.pick(list);
        const d = await api(`/assets/${encodeURIComponent(x.id)}`, { token: acc.token });
        if (d.status !== 200) fail(`資産の詳細 ${d.status}`);
        else {
          const tl = d.body.timeline;
          if (!tl.every((e, i) => i === 0 || tl[i - 1].at <= e.at)) fail('タイムラインの順番');
          if (tl.filter((e) => e.kind === 'now').length !== 1) fail('「いま」が1つでない');
          for (const y of d.body.projection.years) if (y.cash !== y.rent - y.cost - y.repair - y.loan) fail('見通しの手取りの式');
          for (const m of d.body.monthly) if (m.net !== m.income - m.expense) fail('月の収支の式');
          if (x.source !== 'link' && acc.ledger[x.id] !== undefined && d.body.ledger.length !== acc.ledger[x.id]) fail(`記録の件数 ${d.body.ledger.length}≠${acc.ledger[x.id]}`);
          scanMoney(d.body, 'asset');
          if (x.rooms.length) {
            const rm = await api(`/assets/${encodeURIComponent(x.id)}/rooms/${encodeURIComponent(r.pick(x.rooms).no)}`, { token: acc.token });
            if (rm.status !== 200) fail(`部屋 ${rm.status}`);
            else if (!rm.body.timeline.every((e) => e.room === rm.body.room.no)) fail('部屋のタイムラインに他の部屋');
          }
        }
      }
    }
    const pl = await api('/pl?month=2026-10', { token: acc.token });
    if (pl.status !== 200) fail(`/pl ${pl.status}`);
    else {
      const ok = pl.body.companies.filter((c) => c.pl);
      for (const k of ['billed', 'received', 'unpaid', 'fee', 'expense', 'remit']) {
        if (ok.length && pl.body.total[k] !== ok.reduce((a, c) => a + c.pl[k], 0)) fail(`全社の ${k}`);
      }
      for (const c of ok) {
        if (c.pl.remit !== c.pl.received - c.pl.fee - c.pl.expense) fail('送金の式（収支）');
        if (c.pl.billed !== c.pl.received + c.pl.unpaid) fail('請求＝入金＋未入金');
      }
      for (const o of pl.body.own) if (o.net !== o.income - o.expense) fail('自主管理の差引');
      if (pl.body.companies.length !== me.body.links.length) fail('つながりの数と収支の会社数');
      scanMoney(pl.body, 'pl');
    }
    const nov = await api('/pl?month=2026-11', { token: acc.token });
    if (nov.status === 200 && nov.body.companies.some((c) => c.pl)) fail('締め前の月の数字が出ている');
    const rems = await api('/remittances', { token: acc.token });
    for (const x of rems.body || []) {
      if (x.amount !== x.detail.received - x.detail.fee - x.detail.expense - x.detail.works) fail('送金額の式');
      if (!me.body.links.some((l) => l.ownerId === x.ownerId)) fail('他人の送金が見える');
    }
    const ps = await api('/proposals', { token: acc.token });
    const threads = {};
    for (const p of ps.body || []) {
      if (!['sent', 'approved', 'conditional', 'returned'].includes(p.status)) fail(`提案の状態 ${p.status}`);
      if (!me.body.links.some((l) => l.ownerId === p.ownerId)) fail('他人の提案が見える');
      if (p.status === 'sent') { const k = `${p.tenantId}/${p.threadId}`; threads[k] = (threads[k] || 0) + 1; if (threads[k] > 1) fail('承認待ちが同じ案件で2件以上'); }
      if (p.response && p.response.via === 'owner-app' && p.response.decision === 'return' && String(p.response.comment).trim().length < 3) fail('理由なしの差戻し');
    }
    const tl = await api('/timeline', { token: acc.token });
    if (tl.status !== 200) fail(`/timeline ${tl.status}`);
    else if (!tl.body.events.every((e, i, a) => i === 0 || a[i - 1].at <= e.at)) fail('全体タイムラインの順番');
    const blob = JSON.stringify([me.body, as.body, pl.body]);
    if (blob.includes(PII)) fail('入居者の情報（PIIMARK）が残っている');
    return [...problems];
  }

  // ---------- ① ランダムな操作 ----------
  const accounts = [];
  const newAcc = (token, accountId) => {
    let a = accounts.find((x) => x.accountId === accountId);
    if (a) { a.token = token; return a; }
    a = { token, accountId, own: new Set(), ledger: {}, fresh: true };
    accounts.push(a); return a;
  };
  // アカウントに最初からある自分の資産（デモの貸家など）を覚えておく
  const learn = async (a) => { const l = (await api('/assets', { token: a.token })).body?.list || []; for (const x of l) if (x.source !== 'link') { a.own.add(x.id); a.ledger[x.id] = undefined; } };
  const d = await api('/auth/demo', { method: 'POST' }); await learn(newAcc(d.body.token, d.body.accountId));
  const codes = ['HKT-0001', 'HKT-0002', 'TNJ-0011', 'MGR-0021', 'hkt-0001', ' HKT-0002 ', 'XXX', '', 'HKT-000１'];
  const room = () => ({ no: r.chance(0.9) ? String(r.range(100, 509)) : str(r, 30), layout: r.chance(0.5) ? r.pick(['1K', '1LDK', '2DK']) : str(r, 30), rent: r.chance(0.8) ? r.range(0, 300000) : num(r), fee: r.chance(0.8) ? r.range(0, 10000) : num(r), status: r.pick(['入居中', '空室', str(r, 5)]), tenantName: `${PII}-氏名`, tel: `${PII}-090`, email: `${PII}@x` });
  const entry = () => ({ month: r.chance(0.85) ? `2026-${String(r.range(1, 12)).padStart(2, '0')}` : str(r, 10), type: r.chance(0.9) ? r.pick(['income', 'expense']) : str(r, 8), category: r.chance(0.85) ? r.pick(['賃料', '管理料', '修繕', '清掃']) : str(r, 60), amount: r.chance(0.85) ? r.range(1, 500000) : num(r), room: r.chance(0.5) ? String(r.range(100, 303)) : '' });
  const finance = () => Object.fromEntries(['price', 'loanBalance', 'loanRate', 'loanMonthly', 'propertyTax', 'insurance', 'appraisal', 'capRate', 'acquired'].filter(() => r.chance(0.7)).map((k) => [k, k === 'acquired' ? r.pick(['2019-04', '2030-13', str(r, 8)]) : r.chance(0.7) ? r.range(0, k.includes('Rate') ? 12 : 300000000) : num(r)]));

  const OPS = [
    [6, 'start', async () => { const x = await api('/auth/start', { method: 'POST', body: { name: str(r, 50) } }); if (x.status === 200) newAcc(x.body.token, x.body.accountId); return x; }],
    [2, 'demo', async () => { const x = await api('/auth/demo', { method: 'POST' }); if (x.status === 200) newAcc(x.body.token, x.body.accountId); return x; }],
    [3, 'invite', async () => { const x = await api('/auth/invite', { method: 'POST', body: { code: r.pick(codes) } }); if (x.status === 200) newAcc(x.body.token, x.body.accountId); return x; }],
    [3, 'link', async (a) => api('/links', { token: a.token, method: 'POST', body: { code: r.pick(codes) } })],
    [12, 'create', async (a) => {
      const body = { source: r.pick(['self', 'import', 'link', str(r, 5)]), company: str(r, 80), name: r.chance(0.9) ? `物件${r.int(999)}` : str(r, 80), address: str(r, 200), structure: r.pick(['RC', 'S', '木造', 'SRC', '軽量鉄骨', '', str(r, 10)]), floors: num(r), built: r.pick(['1998-04', '2015-11', '2026-11', '2040-01', str(r, 10)]), rooms: Array.from({ length: r.int(8) }, room), finance: finance(), ledger: r.chance(0.4) ? Array.from({ length: r.int(6) }, entry) : undefined };
      const x = await api('/assets', { token: a.token, method: 'POST', body });
      if (x.status === 200) { a.own.add(x.body.id); a.ledger[x.body.id] = x.body.ledger.length; }
      return x;
    }],
    [3, 'create-garbage', async (a) => api('/assets', { token: a.token, method: 'POST', body: anyValue(r) })],
    [10, 'patch', async (a) => {
      const list = (await api('/assets', { token: a.token })).body?.list || [];
      if (!list.length) return { status: 200 };
      const x = r.pick(list);
      const body = r.chance(0.5) ? { finance: finance() } : { name: r.chance(0.8) ? `改名${r.int(99)}` : str(r, 80), rooms: r.chance(0.5) ? Array.from({ length: r.int(6) }, room) : undefined, structure: r.pick(['RC', '木造', str(r, 5)]), built: r.pick(['2001-01', str(r, 7)]) };
      return api(`/assets/${encodeURIComponent(x.id)}`, { token: a.token, method: 'PATCH', body });
    }],
    [3, 'delete', async (a) => {
      const ids = [...a.own];
      if (!ids.length || r.chance(0.2)) return api(`/assets/${encodeURIComponent(r.pick(['L.T-01.BL-01', 'AS-999999', str(r, 10)]))}`, { token: a.token, method: 'DELETE' });
      const id = r.pick(ids);
      const x = await api(`/assets/${encodeURIComponent(id)}`, { token: a.token, method: 'DELETE' });
      if (x.status === 200) { a.own.delete(id); delete a.ledger[id]; }
      return x;
    }],
    [12, 'ledger', async (a) => {
      const ids = [...a.own];
      if (!ids.length) return { status: 200 };
      const id = r.pick(ids);
      const entries = Array.from({ length: r.range(1, 5) }, entry);
      const body = r.chance(0.5) ? { source: 'import', entries } : entries[0];
      const x = await api(`/assets/${encodeURIComponent(id)}/ledger`, { token: a.token, method: 'POST', body });
      if (x.status === 200) a.ledger[id] = x.body.ledger.length;
      return x;
    }],
    [4, 'ledger-del', async (a) => {
      const ids = [...a.own];
      if (!ids.length) return { status: 200 };
      const id = r.pick(ids);
      const det = await api(`/assets/${encodeURIComponent(id)}`, { token: a.token });
      const eid = det.body?.ledger?.length && r.chance(0.8) ? r.pick(det.body.ledger).id : str(r, 8);
      const x = await api(`/assets/${encodeURIComponent(id)}/ledger/${encodeURIComponent(eid)}`, { token: a.token, method: 'DELETE' });
      if (x.status === 200) a.ledger[id] = x.body.ledger.length;
      return x;
    }],
    [6, 'respond', async (a) => {
      const ps = (await api('/proposals', { token: a.token })).body || [];
      const p = ps.length && r.chance(0.85) ? r.pick(ps) : { tenantId: r.pick(['T-01', 'T-02', 'T-03', str(r, 5)]), id: r.pick(['PR-301', 'PR-311', str(r, 6)]), quoteIds: ['Q-301'] };
      const body = { decision: r.pick(['approve', 'conditional', 'return', str(r, 6)]), quoteId: r.chance(0.8) ? r.pick(p.quoteIds || ['Q-1']) : str(r, 6), comment: r.chance(0.6) ? r.pick(['お願いします', '平日に施工', 'no', '', '　　　']) : str(r, 600) };
      return api(`/companies/${encodeURIComponent(p.tenantId)}/proposals/${encodeURIComponent(p.id)}/respond`, { token: a.token, method: 'POST', body });
    }],
    [14, 'read', async (a) => api(r.pick(['/me', '/months', '/assets', '/timeline', '/proposals?status=sent', '/proposals', '/remittances', '/reports', '/works', '/notifications', '/pl?month=2026-09', '/pl?month=2026-11', `/pl?month=${str(r, 8)}`, '/companies/T-01/reports/2026-10', '/companies/T-02/reports/2026-09', `/companies/T-01/reports/${str(r, 8)}`]), { token: a.token })],
    [8, 'cross', async (a) => {
      // 他のアカウントの資産・部屋・記録に触れない
      const others = accounts.filter((b) => b !== a && b.own.size);
      if (!others.length) return { status: 200, cross: true };
      const b = r.pick(others); const id = r.pick([...b.own]);
      const m = r.pick(['GET', 'PATCH', 'DELETE', 'LEDGER', 'ROOM']);
      const x = m === 'LEDGER' ? await api(`/assets/${encodeURIComponent(id)}/ledger`, { token: a.token, method: 'POST', body: entry() })
        : m === 'ROOM' ? await api(`/assets/${encodeURIComponent(id)}/rooms/101`, { token: a.token })
          : await api(`/assets/${encodeURIComponent(id)}`, { token: a.token, method: m, body: m === 'PATCH' ? { name: '乗っ取り' } : undefined });
      return { ...x, cross: true, expect404: true };
    }],
    [2, 'logout', async (a) => {
      const x = await api('/auth/logout', { token: a.token, method: 'POST' });
      const after = await api('/me', { token: a.token });
      const re = await api('/auth/start', { method: 'POST', body: { name: 'あとで' } });
      // ログアウトしたアカウントは、資産の確認ができないので外す
      accounts.splice(accounts.indexOf(a), 1);
      if (re.status === 200) newAcc(re.body.token, re.body.accountId);
      return { ...x, after: after.status };
    }],
  ];
  const totalW = OPS.reduce((s, o) => s + o[0], 0);
  const pickOp = () => { let k = r() * totalW; for (const o of OPS) { k -= o[0]; if (k < 0) return o; } return OPS[0]; };

  for (let i = 0; i < ops; i++) {
    const [, name, fn] = pickOp();
    const a = r.pick(accounts);
    for (const b of accounts) if (b.fresh) { b.fresh = false; await learn(b); }
    let res;
    try { res = await fn(a); } catch (e) { t.bad('①ランダムな操作', `${name}: 例外 ${e.message}`, { i }); continue; }
    const errs = [];
    if (res.status >= 500) errs.push(`${name}: ${res.status} ${res.text?.slice(0, 120)}`);
    if (res.expect404 && res.status !== 404) errs.push(`${name}: 他人の資産に ${res.status}`);
    if (res.after !== undefined && res.after !== 401) errs.push('ログアウト後も使える');
    if (res.status === 200 || i % 5 === 0) {
      const acc = accounts.includes(a) ? a : r.pick(accounts);
      errs.push(...(await invariants(acc)).map((m) => `${name}→${m}`));
    }
    if (errs.length) t.bad('①ランダムな操作', errs[0], { i, op: name, more: errs.length - 1 }); else t.ok('①ランダムな操作');
  }

  // ---------- ② 不正な入力 ----------
  const tok = accounts[0].token;
  const paths = ['/api/v1/assets', '/api/v1/assets/AS-1', '/api/v1/assets/L.T-01.BL-01', '/api/v1/assets/x/ledger', '/api/v1/assets/x/ledger/y', '/api/v1/assets/x/rooms/101', '/api/v1/links', '/api/v1/auth/invite', '/api/v1/auth/start', '/api/v1/auth/demo', '/api/v1/companies/T-01/proposals/PR-301/respond', '/api/v1/companies/T-01/reports/2026-10', '/api/v1/pl', '/api/v1/me', '/api/v1/events', '/api/v1/outbox/drain', '/api/v1/', '/api/v1/../../package.json'];
  const traversal = ['/..%2fpackage.json', '/%2e%2e/server/seed.mjs', '/..%2f..%2fetc%2fpasswd', '/%2e%2e%2fscripts%2ffuzz%2flib.mjs', '/public/../server/store.mjs', '/.%2e/README.md', '/%00', '/index.html%00.js'];
  for (let i = 0; i < fuzz; i++) {
    let res, p;
    try {
      if (i % 10 === 0) {
        p = r.pick(traversal);
        res = await call(p);
        const leaked = res.status === 200 && /export (const|function)|createStore|# REVO|root:x:/.test(res.text);
        t.check('②不正な入力', !leaked && res.status < 500, `外のファイルが読める ${p} ${res.status}`, { p });
        continue;
      }
      p = r.pick(paths);
      if (r.chance(0.3)) p = p.replace(/[A-Z]{2}-\d+|x|y|101/g, () => encodeURIComponent(str(r, 20)));
      if (r.chance(0.2)) p += `?month=${encodeURIComponent(str(r, 12))}&status=${encodeURIComponent(str(r, 8))}`;
      const method = r.pick(['GET', 'POST', 'PATCH', 'DELETE', 'PUT', 'OPTIONS']);
      const auth = r.pick([tok, tok, '', 'garbage', `${tok}x`, 'Bearer', ' '.repeat(3)]);
      const raw = method === 'GET' ? undefined : r.pick([JSON.stringify(anyValue(r)), '{', '[1,2', 'null', '"str"', '{"__proto__":{"admin":true}}', '{"constructor":{"prototype":{"x":1}}}', 'x'.repeat(r.int(3) ? 100 : 3 * 1024 * 1024), '']);
      res = await call(p, { method, raw, token: auth });
      const isApi = new URL(base + p).pathname.startsWith('/api/v1/');
      const okJSON = !isApi || res.body !== null || res.status === 405 || method === 'OPTIONS';
      t.check('②不正な入力', res.status < 500 && okJSON, `${method} ${p.slice(0, 60)} → ${res.status}`, { text: res.text.slice(0, 120) });
    } catch (e) { t.bad('②不正な入力', `例外 ${e.message}`, { p }); }
  }
  // 不正な入力のあとも、プロトタイプが汚れていない・データが正しい
  t.check('②不正な入力', ({}).admin === undefined && ({}).x === undefined, 'プロトタイプが書き換えられた');
  const after = await invariants(accounts[0]);
  t.check('②不正な入力', after.length === 0, `不正な入力のあとに崩れた：${after[0]}`);

  // ---------- ③ イベント ----------
  const sign = (raw) => 'sha256=' + crypto.createHmac('sha256', SECRET).update(raw).digest('hex');
  const owners = { 'T-01': ['OW-01', 'OW-02'], 'T-02': ['OW-11'], 'T-03': ['OW-21'] };
  for (let i = 0; i < events; i++) {
    const tenantId = r.chance(0.9) ? r.pick(Object.keys(owners)) : str(r, 5);
    const ownerId = r.chance(0.8) ? r.pick(owners[tenantId] || ['OW-01']) : r.pick(['OW-01', 'OW-21', str(r, 5)]);
    const type = r.pick(['proposal.sent', 'proposal.answered', 'order.placed', 'order.completed', 'order.updated', 'remittance.paid', 'report.published', 'contract.renewal_due', str(r, 10)]);
    const data = {
      'proposal.sent': { proposal: { id: `PR-F${r.int(30)}`, threadId: `TH-F${r.int(5)}`, ownerId, buildingId: 'BL-01', title: str(r, 30) || '提案', quoteIds: ['Q-301', 'Q-302'], recommendedId: 'Q-301', reason: str(r, 30), sentAt: '2026-11-20T00:00:00Z' }, quotes: [] },
      'proposal.answered': { proposalId: r.pick(['PR-301', 'PR-F1']), response: { decision: r.pick(['approve', 'return', 'x']), quoteId: 'Q-301', comment: 'ok', via: 'phone', at: '2026-11-21T00:00:00Z' } },
      'order.placed': { order: { id: `OD-F${r.int(20)}`, ownerId, buildingId: 'BL-01', title: str(r, 20) || '工事', contractor: 'x', amount: r.range(1, 900000), status: '発注済', history: [{ status: '発注済', at: '2026-11-22' }] } },
      'remittance.paid': { remittance: { id: `RM-F${r.int(9)}`, ownerId, month: '2026-10', date: '2026-10-25', status: '送金済', amount: 1000, detail: { received: 1100, fee: 100, expense: 0, works: 0, worksOrders: [] }, bank: 'x' } },
      'report.published': { ownerId, month: '2026-10' },
      'contract.renewal_due': { ownerId, end: '2027-03-31' },
    }[type] || anyValue(r);
    if ((type === 'order.completed' || type === 'order.updated') && data && typeof data === 'object') Object.assign(data, { order: { id: `OD-F${r.int(20)}`, ownerId, title: '工事', status: '完了報告', history: [{ status: '完了報告', at: '2026-11-23' }], photos: [] } });
    const raw = JSON.stringify(r.chance(0.95) ? { type, tenantId, data } : anyValue(r));
    const badSig = r.chance(0.1);
    const res = await call('/api/v1/events', { method: 'POST', raw, headers: { 'x-signature': badSig ? 'sha256=00' : sign(raw) } });
    const okStatus = badSig ? res.status === 401 : [200, 400].includes(res.status);
    const ownerOk = owners[tenantId] && owners[tenantId].includes(ownerId);
    const wrongAccepted = res.status === 200 && type !== 'proposal.answered' && !ownerOk && data && (data.ownerId || data.proposal || data.order || data.remittance);
    t.check('③イベント', okStatus && !wrongAccepted, `${type} ${tenantId}/${ownerId} → ${res.status}${wrongAccepted ? '（他社のオーナーを受け付けた）' : ''}`);
  }
  for (const a of accounts.slice(0, 5)) {
    const p = await invariants(a);
    t.check('③イベント', p.length === 0, `イベントのあとに崩れた：${p[0]}`);
  }

  server.close();
}
