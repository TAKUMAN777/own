// データの置き場所（デモ：メモリ上）。
// このアプリはオーナー自身のもの。オーナーのアカウントに、複数の管理会社（各社の REVO管理）がつながる。
// 本番では、管理会社ごとのデータ取得を各社の REVO管理 API の呼び出しに置き換える（docs/API.md）。
import * as seed from './seed.mjs';
import * as ins from './insights.mjs';

const clone = (v) => JSON.parse(JSON.stringify(v));

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function createStore() {
  const db = {
    app: clone(seed.app),
    tenants: clone(seed.tenants),
    invites: clone(seed.invites),
    owners: clone(seed.owners),
    buildings: clone(seed.buildings),
    mgmt: clone(seed.mgmt),
    quotes: clone(seed.quotes),
    proposals: clone(seed.proposals),
    orders: clone(seed.orders),
    remittances: seed.buildRemittances(),
    accounts: [], // { id, name, links: [{ tenantId, ownerId }] }
    notifications: [], // { id, tenantId, ownerId, ... }
    outbox: [], // オーナーの回答 → 管理会社（REVO管理）へ届ける
  };
  let seq = 1;

  const tenantOf = (id) => db.tenants.find((t) => t.id === id);
  const ownerRec = (id) => db.owners.find((o) => o.id === id);
  const ownerTenant = (ownerId) => (ownerRec(ownerId) || {}).tenantId;
  const company = (tenantId) => ({ tenantId, company: (tenantOf(tenantId) || {}).company || '' });

  // ---------- 資産（建物）----------
  // 3つの作り方：管理システムと連携（link）／管理会社の資料から（import）／自主管理で入力（self）
  const FIN_KEYS = ['price', 'loanBalance', 'loanRate', 'loanMonthly', 'propertyTax', 'insurance', 'capRate', 'appraisal'];
  const STATUSES = ['入居中', '空室'];
  const str = (v, max = 60) => String(v ?? '').trim().slice(0, max);
  const int = (v) => { const n = Math.round(Number(String(v ?? '').replace(/[,円¥\s]/g, ''))); return Number.isFinite(n) && n >= 0 ? n : 0; };
  const ymOk = (m) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m);

  function cleanFinance(f = {}) {
    const out = {};
    for (const k of FIN_KEYS) out[k] = k === 'loanRate' || k === 'capRate' ? Math.max(0, Math.min(30, Number(f[k]) || 0)) : int(f[k]);
    out.acquired = ymOk(f.acquired) ? f.acquired : '';
    return out;
  }
  // 部屋：部屋番号・間取り・賃料・共益費・状態だけを持つ（入居者の情報は受け取らない）
  function cleanRooms(rooms) {
    if (!Array.isArray(rooms)) return [];
    return rooms.slice(0, 500).map((r) => ({
      no: str(r.no, 20), layout: str(r.layout, 20), rent: int(r.rent), fee: int(r.fee),
      status: STATUSES.includes(r.status) ? r.status : '入居中',
    })).filter((r) => r.no);
  }
  function seedOwnerDemo(a, ownerId) {
    const d = seed.ownerDemo[ownerId];
    if (!d) return;
    for (const [bid, f] of Object.entries(d.finance || {})) a.finance[bid] = cleanFinance(f);
    for (const x of d.assets || []) {
      const as = newAsset(x);
      a.assets.push(as);
      for (const [month, type, category, amount] of x.ledger || []) a.ledger.push({ id: `LG-${seq++}`, assetId: as.id, month, type, category, amount, source: x.source });
    }
  }
  function newAsset(b) {
    const source = b.source === 'import' ? 'import' : 'self';
    const name = str(b.name);
    if (!name) throw new HttpError(400, 'name_required', '物件名を入力してください');
    return {
      id: `AS-${seq++}`, source, company: source === 'import' ? str(b.company) : '',
      name, address: str(b.address, 120), structure: str(b.structure, 10), floors: int(b.floors) || null,
      built: ymOk(b.built) ? b.built : '', rooms: cleanRooms(b.rooms), finance: cleanFinance(b.finance),
    };
  }

  const latestClosed = () => seed.closed[seed.closed.length - 1];

  function kpi(rooms, finance, annualCost) {
    const units = rooms.length;
    const occupied = rooms.filter((r) => r.status !== '空室').length;
    const fullYear = rooms.reduce((s, r) => s + (r.rent + r.fee) * 12, 0);
    const curYear = rooms.filter((r) => r.status !== '空室').reduce((s, r) => s + (r.rent + r.fee) * 12, 0);
    const price = finance.price || 0;
    const cost = annualCost + (finance.propertyTax || 0) + (finance.insurance || 0);
    return {
      units, occupied, occRate: units ? occupied / units : 0, fullYear, curYear, annualCost: cost,
      grossYield: price ? fullYear / price : null,
      netYield: price ? (curYear - cost) / price : null,
      loanYear: (finance.loanMonthly || 0) * 12,
    };
  }

  // 管理システムとつながっている建物（基本情報・部屋・収支は管理会社のデータ。取得価格などはオーナーが追加）
  function linkAssets(a) {
    const out = [];
    for (const l of a.links) {
      const t = tenantOf(l.tenantId);
      for (const b of db.buildings.filter((x) => x.ownerId === l.ownerId)) {
        const m = latestClosed();
        const pl = seed.buildPL(l.ownerId, m).buildings.find((x) => x.buildingId === b.id);
        const rooms = seed.units.filter((u) => u.buildingId === b.id).map((u) => {
          const st = pl.rooms.find((r) => r.no === u.no).status;
          return { no: u.no, layout: '', rent: u.rent, fee: u.fee, status: st === '空室' ? '空室' : '入居中', ...ins.roomLife(b.id, u.no, b.built, u.vacantFrom) };
        });
        // 年間の運営費（見込み）：締め済みの月の管理料＋費用の平均 × 12
        const months = seed.closed.map((cm) => seed.buildPL(l.ownerId, cm).buildings.find((x) => x.buildingId === b.id));
        const avg = months.reduce((s, x) => s + x.fee + x.expense, 0) / months.length;
        const finance = a.finance[b.id] || cleanFinance();
        out.push({
          id: `L.${l.tenantId}.${b.id}`, source: 'link', system: t.system, tenantId: l.tenantId, company: t.company, buildingId: b.id,
          name: b.name, address: b.address, structure: b.structure, floors: b.floors, built: b.built,
          rooms, finance, kpi: kpi(rooms, finance, Math.round(avg * 12)),
        });
      }
    }
    return out;
  }
  function ownAssetView(a, as) {
    // 年間の運営費（見込み）：入力された支出の月平均 × 12
    const exp = a.ledger.filter((e) => e.assetId === as.id && e.type === 'expense');
    const months = new Set(a.ledger.filter((e) => e.assetId === as.id).map((e) => e.month));
    const avg = months.size ? exp.reduce((s, e) => s + e.amount, 0) / months.size : 0;
    return { ...as, kpi: kpi(as.rooms, as.finance, Math.round(avg * 12)) };
  }
  function allAssets(accountId) {
    const a = account(accountId);
    return [...linkAssets(a), ...a.assets.map((as) => ownAssetView(a, as))].map((x) => ({ ...x, value: ins.valuation(x) }));
  }

  // ---------- タイムライン（過去・現在・未来）----------
  function monthlyOf(a, x) {
    if (x.source === 'link') {
      const l = a.links.find((v) => v.tenantId === x.tenantId);
      return seed.closed.map((m) => { const b = seed.buildPL(l.ownerId, m).buildings.find((v) => v.buildingId === x.buildingId); return { month: m, income: b.received, expense: b.fee + b.expense, net: b.remit }; });
    }
    const ledger = a.ledger.filter((e) => e.assetId === x.id);
    return [...new Set(ledger.map((e) => e.month))].sort().map((m) => {
      const es = ledger.filter((e) => e.month === m);
      const income = es.filter((e) => e.type === 'income').reduce((t, e) => t + e.amount, 0);
      const expense = es.filter((e) => e.type === 'expense').reduce((t, e) => t + e.amount, 0);
      return { month: m, income, expense, net: income - expense };
    });
  }
  function timelineOf(a, x) {
    const E = [];
    const base = { assetId: x.id, assetName: x.name };
    const push = (at, kind, icon, title, extra = {}) => { if (at && /^\d{4}-\d{2}$/.test(at)) E.push({ ...base, ...ins.ev(at, kind, icon, title, extra) }); };
    const f = x.finance;
    push(x.built, 'build', '🏗️', '竣工');
    if (x.built && ins.LIFE[x.structure]) push(ins.addMonths(x.built, ins.LIFE[x.structure] * 12), 'life', '⏳', `法定耐用年数（${x.structure}造 ${ins.LIFE[x.structure]}年）に到達`);
    push(f.acquired, 'acquire', '🔑', '取得', { amount: f.price || null });
    for (const m of monthlyOf(a, x)) push(m.month, 'money', '💴', '月の収支', { amount: m.net, detail: `収入 ${m.income.toLocaleString()}円／支出 ${m.expense.toLocaleString()}円` });
    for (const r of x.rooms) {
      if (r.since) push(r.since, 'room', '🏠', `${r.no}号室 入居`, { room: r.no });
      if (r.moveOut) push(r.moveOut, 'room', '🚪', `${r.no}号室 退去`, { room: r.no });
      if (r.leaseEnd) push(r.leaseEnd, 'room', '📝', `${r.no}号室 契約の更新`, { room: r.no });
    }
    if (x.source === 'link') {
      const l = a.links.find((v) => v.tenantId === x.tenantId);
      for (const m of db.mgmt.filter((v) => v.ownerId === l.ownerId)) {
        push(m.start.slice(0, 7), 'contract', '🤝', `${x.company}に管理を委託`);
        push(m.end.slice(0, 7), 'contract', '📑', `${x.company}との管理委託契約の満了`);
      }
      for (const o of db.orders.filter((v) => v.buildingId === x.buildingId)) {
        const room = (o.title.match(/(\S+?)号室/) || [])[1] || '';
        for (const h of o.history) push(h.at.slice(0, 7), 'work', '🛠️', `${o.title}：${h.status}`, { amount: h.status === '発注済' ? o.amount : null, room });
      }
      for (const p of db.proposals.filter((v) => v.buildingId === x.buildingId && v.status !== 'draft' && v.status !== 'superseded')) {
        const room = (p.title.match(/(\S+?)号室/) || [])[1] || '';
        push(p.sentAt.slice(0, 7), 'proposal', '📨', `ご提案：${p.title}`, { room });
        if (p.response) push(p.response.at.slice(0, 7), 'proposal', '✅', `ご回答（${{ approve: '承認', conditional: '条件付きで承認', return: '差戻し' }[p.response.decision]}）：${p.title}`, { room });
      }
    } else {
      for (const e of a.ledger.filter((v) => v.assetId === x.id && v.room)) push(e.month, 'money', e.type === 'income' ? '💴' : '🧾', `${e.room} ${e.category}`, { amount: e.type === 'income' ? e.amount : -e.amount, room: e.room });
    }
    const loan = ins.loanPlan(f);
    if (loan.payoff) push(loan.payoff, 'loan', '🎉', 'ローン完済（見込み）');
    for (const r of ins.repairPlan(x)) push(r.month, 'repair', '🔧', `${r.name}（目安）`, { amount: -r.cost });
    push(ins.NOW, 'now', '📍', 'いま', { detail: `入居 ${x.kpi.occupied}/${x.kpi.units}室・資産価値 ${Math.round(x.value.value / 10000).toLocaleString()}万円` });
    const order = ['build', 'acquire', 'contract', 'now', 'money', 'proposal', 'work', 'room', 'repair', 'loan', 'life'];
    return E.sort((p, q) => p.at.localeCompare(q.at) || order.indexOf(p.kind) - order.indexOf(q.kind));
  }
  function findOwn(a, id) {
    const as = a.assets.find((x) => x.id === id);
    if (!as) throw new HttpError(404, 'not_found', '資産が見つかりません');
    return as;
  }
  function cleanEntry(e, source) {
    const month = String(e.month || '');
    if (!ymOk(month)) throw new HttpError(400, 'bad_month', '年月の形式が正しくありません（例：2026-10）');
    if (!['income', 'expense'].includes(e.type)) throw new HttpError(400, 'bad_type', '収入か支出を選んでください');
    const category = str(e.category, 30);
    if (!category) throw new HttpError(400, 'category_required', '項目を入力してください');
    const amount = int(e.amount);
    if (!amount) throw new HttpError(400, 'amount_required', '金額を入力してください');
    return { id: `LG-${seq++}`, month, type: e.type, category, amount, room: str(e.room, 20), source };
  }

  function account(accountId) {
    const a = db.accounts.find((x) => x.id === accountId);
    if (!a) throw new HttpError(401, 'unauthorized', 'ログインしてください');
    return a;
  }
  const links = (accountId) => account(accountId).links;
  const linkOf = (accountId, tenantId) => {
    const l = links(accountId).find((x) => x.tenantId === tenantId);
    if (!l) throw new HttpError(404, 'not_found', 'この管理会社とはつながっていません');
    return l;
  };
  const ownsOwner = (accountId, ownerId) => links(accountId).some((l) => l.ownerId === ownerId);

  const withQuotes = (p) => {
    const b = db.buildings.find((x) => x.id === p.buildingId);
    return {
      ...p, ...company(ownerTenant(p.ownerId)),
      buildingName: b ? b.name : '',
      quotes: p.quoteIds.map((qid) => db.quotes.find((q) => q.id === qid)).filter(Boolean),
    };
  };

  function notify(ownerId, type, title, link) {
    db.notifications.unshift({ id: `NT-${seq++}`, ownerId, tenantId: ownerTenant(ownerId), type, title, link: link || null, at: new Date().toISOString() });
  }

  function plFor(ownerId, month) {
    if (!seed.MONTHS.includes(month)) throw new HttpError(404, 'not_found', 'この月のデータはありません');
    // 月締め前の数字は出さない
    if (!seed.closed.includes(month)) return null;
    return seed.buildPL(ownerId, month);
  }

  return {
    db,
    app: () => db.app,
    systems: () => [...new Set(db.tenants.map((t) => t.system))],

    // 招待コードでログイン（初回はアカウントを作る）。すでにつながっている会社のコードなら、そのアカウントに入る
    login(code) {
      const inv = db.invites[String(code || '').trim().toUpperCase()];
      if (!inv) throw new HttpError(401, 'invalid_code', '招待コードが正しくありません');
      let a = db.accounts.find((x) => x.links.some((l) => l.tenantId === inv.tenantId && l.ownerId === inv.ownerId));
      if (!a) {
        a = { id: `ACC-${seq++}`, name: ownerRec(inv.ownerId).name, links: [{ ...inv }], assets: [], finance: {}, ledger: [] };
        seedOwnerDemo(a, inv.ownerId);
        db.accounts.push(a);
      }
      return a;
    },

    // 管理会社を追加（その会社から届いた招待コード）
    addLink(accountId, code) {
      const a = account(accountId);
      const inv = db.invites[String(code || '').trim().toUpperCase()];
      if (!inv) throw new HttpError(400, 'invalid_code', '招待コードが正しくありません');
      if (a.links.some((l) => l.tenantId === inv.tenantId)) throw new HttpError(409, 'already_linked', 'この管理会社とはすでにつながっています');
      if (db.accounts.some((x) => x.id !== a.id && x.links.some((l) => l.ownerId === inv.ownerId))) throw new HttpError(409, 'in_use', 'この招待コードは別のアカウントで使われています');
      a.links.push({ ...inv });
      return this.me(accountId);
    },

    me(accountId) {
      const a = account(accountId);
      return {
        id: a.id, name: a.name,
        links: a.links.map((l) => {
          const t = tenantOf(l.tenantId);
          return {
            tenantId: l.tenantId, ownerId: l.ownerId, company: t.company, tel: t.tel, system: t.system,
            buildings: db.buildings.filter((b) => b.ownerId === l.ownerId).map((b) => ({ ...b, units: seed.units.filter((u) => u.buildingId === b.id).length })),
            mgmt: db.mgmt.filter((m) => m.ownerId === l.ownerId),
          };
        }),
      };
    },

    months() {
      return { months: seed.MONTHS, closed: seed.closed };
    },

    // 管理会社ごとの収支（各社の計算結果そのまま）と、全社の合計
    pl(accountId, month) {
      const per = links(accountId).map((l) => ({ ...company(l.tenantId), pl: plFor(l.ownerId, month) }));
      const ok = per.filter((x) => x.pl);
      const sum = (k) => ok.reduce((s, x) => s + x.pl[k], 0);
      return {
        month, closed: ok.length === per.length && per.length > 0,
        total: ok.length ? { billed: sum('billed'), received: sum('received'), unpaid: sum('unpaid'), fee: sum('fee'), expense: sum('expense'), remit: sum('remit'), occupied: sum('occupied'), units: sum('units') } : null,
        companies: per,
        own: this.ownMonth(accountId, month), // 自主管理・資料から作った資産（月締めはない）
      };
    },

    proposals(accountId, status) {
      return db.proposals
        .filter((p) => ownsOwner(accountId, p.ownerId) && p.status !== 'draft' && p.status !== 'superseded')
        .filter((p) => !status || p.status === status)
        .sort((a, b) => (b.sentAt || '').localeCompare(a.sentAt || ''))
        .map(withQuotes);
    },

    proposal(accountId, tenantId, id) {
      const l = linkOf(accountId, tenantId);
      const p = db.proposals.find((x) => x.id === id && x.ownerId === l.ownerId);
      if (!p || p.status === 'draft') throw new HttpError(404, 'not_found', 'ご提案が見つかりません');
      return withQuotes(p);
    },

    // RevoWorks.ownerRespond(proposalId, decision, { quoteId, comment, via }) と同じルール
    respond(accountId, tenantId, id, body) {
      const l = linkOf(accountId, tenantId);
      const p = db.proposals.find((x) => x.id === id && x.ownerId === l.ownerId);
      if (!p) throw new HttpError(404, 'not_found', 'ご提案が見つかりません');
      if (p.status !== 'sent') throw new HttpError(409, 'already_answered', 'このご提案にはすでに回答済みです');
      const decision = body && body.decision;
      const comment = String((body && body.comment) || '').trim();
      const quoteId = body && body.quoteId;
      if (!['approve', 'conditional', 'return'].includes(decision)) throw new HttpError(400, 'bad_decision', '回答の種類が正しくありません');
      if (decision !== 'return' && !p.quoteIds.includes(quoteId)) throw new HttpError(400, 'bad_quote', '案を選んでください');
      if (decision === 'return' && comment.length < 3) throw new HttpError(400, 'reason_required', '差戻しの理由を3文字以上で入力してください');
      if (decision === 'conditional' && comment.length < 3) throw new HttpError(400, 'condition_required', '条件を3文字以上で入力してください');
      if (comment.length > 500) throw new HttpError(400, 'too_long', 'コメントは500文字以内で入力してください');

      p.status = { approve: 'approved', conditional: 'conditional', return: 'returned' }[decision];
      p.response = { decision, quoteId: decision === 'return' ? null : quoteId, comment, via: 'owner-app', at: new Date().toISOString() };
      db.outbox.push({ type: 'proposal.answered', tenantId, proposalId: p.id, ownerId: l.ownerId, response: p.response });
      return withQuotes(p);
    },

    remittances(accountId) {
      return db.remittances
        .filter((r) => ownsOwner(accountId, r.ownerId))
        .map((r) => ({ ...r, ...company(r.tenantId) }))
        .sort((a, b) => b.month.localeCompare(a.month) || a.tenantId.localeCompare(b.tenantId));
    },

    reports(accountId) {
      const list = [];
      for (const m of seed.closed.slice().reverse()) {
        for (const l of links(accountId)) list.push({ ...company(l.tenantId), month: m, title: `${Number(m.slice(5))}月 月次報告書`, publishedAt: `${m}-25` });
      }
      return list;
    },

    report(accountId, tenantId, month) {
      const l = linkOf(accountId, tenantId);
      const pl = plFor(l.ownerId, month);
      if (!pl) throw new HttpError(409, 'not_closed', 'この月はまだ締めていません');
      const rem = db.remittances.find((r) => r.ownerId === l.ownerId && r.month === month) || null;
      const works = db.orders.filter((o) => o.ownerId === l.ownerId && o.history.some((h) => h.at.startsWith(month)))
        .map((o) => ({ id: o.id, title: o.title, status: o.status }));
      return {
        ...company(tenantId), month, owner: { name: ownerRec(l.ownerId).name }, pl, remittance: rem, works,
        notes: (seed.reportNotes[l.ownerId] && seed.reportNotes[l.ownerId][month]) || [],
      };
    },

    works(accountId) {
      return db.orders.filter((o) => ownsOwner(accountId, o.ownerId)).map((o) => {
        const b = db.buildings.find((x) => x.id === o.buildingId);
        return { ...o, ...company(ownerTenant(o.ownerId)), buildingName: b ? b.name : '', steps: seed.ORDER_STEPS };
      });
    },

    photoBelongsTo(photoId, accountId) {
      return db.orders.some((o) => ownsOwner(accountId, o.ownerId) && o.photos.some((p) => p.id === photoId));
    },
    photo(photoId) {
      for (const o of db.orders) {
        const p = o.photos.find((x) => x.id === photoId);
        if (p) return { ...p, title: o.title };
      }
      return null;
    },

    notifications(accountId) {
      return db.notifications.filter((n) => ownsOwner(accountId, n.ownerId)).map((n) => ({ ...n, ...company(n.tenantId) })).slice(0, 30);
    },

    // 管理会社（REVO管理）→ このアプリ のイベント。tenantId はどの会社から来たか
    ingestEvent(ev) {
      if (!ev || typeof ev.type !== 'string') throw new HttpError(400, 'bad_event', 'イベントの形式が正しくありません');
      const tenantId = ev.tenantId;
      if (!tenantOf(tenantId)) throw new HttpError(400, 'bad_event', 'tenantId が正しくありません');
      const d = ev.data || {};
      const mustOwner = (ownerId) => {
        const o = ownerRec(ownerId);
        if (!o || o.tenantId !== tenantId) throw new HttpError(400, 'bad_event', 'この管理会社のオーナーではありません');
      };
      switch (ev.type) {
        case 'proposal.sent': {
          const p = d.proposal;
          if (!p || !p.id || !p.ownerId || !Array.isArray(p.quoteIds)) throw new HttpError(400, 'bad_event', 'proposal が必要です');
          mustOwner(p.ownerId);
          for (const q of d.quotes || []) {
            const i = db.quotes.findIndex((x) => x.id === q.id);
            if (i >= 0) db.quotes[i] = q; else db.quotes.push(q);
          }
          // 同じ案件の古い提案は superseded（承認待ちは1件まで）
          for (const old of db.proposals) {
            if (old.threadId === p.threadId && old.ownerId === p.ownerId && old.id !== p.id && old.status === 'sent') old.status = 'superseded';
          }
          const i = db.proposals.findIndex((x) => x.id === p.id);
          const rec = { ...p, status: 'sent', response: null };
          if (i >= 0) db.proposals[i] = rec; else db.proposals.push(rec);
          notify(p.ownerId, ev.type, `新しいご提案：${p.title}`, `#/proposals/${tenantId}/${p.id}`);
          break;
        }
        case 'proposal.answered': {
          const p = db.proposals.find((x) => x.id === d.proposalId && ownerTenant(x.ownerId) === tenantId);
          if (p && d.response) { p.status = { approve: 'approved', conditional: 'conditional', return: 'returned' }[d.response.decision] || p.status; p.response = d.response; }
          break;
        }
        case 'order.placed':
        case 'order.completed':
        case 'order.updated': {
          const o = d.order;
          if (!o || !o.id || !o.ownerId) throw new HttpError(400, 'bad_event', 'order が必要です');
          mustOwner(o.ownerId);
          const i = db.orders.findIndex((x) => x.id === o.id);
          if (i >= 0) db.orders[i] = { ...db.orders[i], ...o }; else db.orders.push({ photos: [], history: [], ...o });
          notify(o.ownerId, ev.type, ev.type === 'order.placed' ? `工事を発注しました：${o.title}` : `工事の状況が更新されました：${o.title}`, '#/works');
          break;
        }
        case 'remittance.paid': {
          const r = d.remittance;
          if (!r || !r.id || !r.ownerId) throw new HttpError(400, 'bad_event', 'remittance が必要です');
          mustOwner(r.ownerId);
          const rec = { ...r, tenantId };
          const i = db.remittances.findIndex((x) => x.id === r.id);
          if (i >= 0) db.remittances[i] = rec; else db.remittances.push(rec);
          notify(r.ownerId, ev.type, `${Number(r.month.slice(5))}月分のご送金が完了しました`, `#/money/${r.month}`);
          break;
        }
        case 'report.published':
          if (!d.ownerId || !d.month) throw new HttpError(400, 'bad_event', 'ownerId と month が必要です');
          mustOwner(d.ownerId);
          notify(d.ownerId, ev.type, `${Number(d.month.slice(5))}月の月次報告書が届きました`, `#/reports/${tenantId}/${d.month}`);
          break;
        case 'contract.renewal_due':
          if (!d.ownerId) throw new HttpError(400, 'bad_event', 'ownerId が必要です');
          mustOwner(d.ownerId);
          notify(d.ownerId, ev.type, `管理委託契約の更新時期が近づいています（${d.end || ''}）`, '#/menu/buildings');
          break;
        default:
          throw new HttpError(400, 'unknown_event', `未対応のイベントです：${ev.type}`);
      }
      return { ok: true };
    },

    assets(accountId) {
      const list = allAssets(accountId);
      const sum = (f) => list.reduce((s, x) => s + f(x), 0);
      const price = sum((x) => x.finance.price || 0);
      const units = sum((x) => x.kpi.units);
      return {
        summary: {
          count: list.length, price, loanBalance: sum((x) => x.finance.loanBalance || 0),
          fullYear: sum((x) => x.kpi.fullYear), curYear: sum((x) => x.kpi.curYear),
          units, occupied: sum((x) => x.kpi.occupied), occRate: units ? sum((x) => x.kpi.occupied) / units : 0,
          // 利回りは取得価格が入っている資産だけで出す
          value: sum((x) => x.value.value), equity: sum((x) => x.value.equity),
          grossYield: (() => { const w = list.filter((x) => x.finance.price); const p = w.reduce((s, x) => s + x.finance.price, 0); return p ? w.reduce((s, x) => s + x.kpi.fullYear, 0) / p : null; })(),
          missingPrice: list.filter((x) => !x.finance.price).length,
        },
        list,
      };
    },

    asset(accountId, id) {
      const a = account(accountId);
      const x = allAssets(accountId).find((v) => v.id === id);
      if (!x) throw new HttpError(404, 'not_found', '資産が見つかりません');
      const ledger = x.source === 'link' ? [] : a.ledger.filter((e) => e.assetId === id).sort((p, q) => q.month.localeCompare(p.month));
      const works = x.source === 'link' ? db.orders.filter((o) => o.buildingId === x.buildingId).map((o) => ({ id: o.id, title: o.title, status: o.status, amount: o.amount })) : [];
      // 月ごとの収支：連携は管理会社の計算結果、それ以外は入力・取込の記録から
      const monthly = x.source === 'link'
        ? seed.closed.map((m) => { const l = a.links.find((v) => v.tenantId === x.tenantId); const b = seed.buildPL(l.ownerId, m).buildings.find((v) => v.buildingId === x.buildingId); return { month: m, income: b.received, expense: b.fee + b.expense, net: b.remit }; })
        : [...new Set(ledger.map((e) => e.month))].sort().map((m) => {
          const es = ledger.filter((e) => e.month === m);
          const income = es.filter((e) => e.type === 'income').reduce((s, e) => s + e.amount, 0);
          const expense = es.filter((e) => e.type === 'expense').reduce((s, e) => s + e.amount, 0);
          return { month: m, income, expense, net: income - expense };
        });
      return { ...x, ledger, works, monthly, loan: ins.loanPlan(x.finance), repairs: ins.repairPlan(x), projection: ins.projection(x), timeline: timelineOf(a, x), now: ins.NOW };
    },

    room(accountId, id, no) {
      const a = account(accountId);
      const x = allAssets(accountId).find((v) => v.id === id);
      if (!x) throw new HttpError(404, 'not_found', '資産が見つかりません');
      const r = x.rooms.find((v) => v.no === no);
      if (!r) throw new HttpError(404, 'not_found', '部屋が見つかりません');
      return { asset: { id: x.id, name: x.name, source: x.source, company: x.company, system: x.system }, room: r, timeline: timelineOf(a, x).filter((e) => e.room === no), now: ins.NOW };
    },

    // すべての資産のタイムライン
    timeline(accountId) {
      const a = account(accountId);
      const list = allAssets(accountId);
      const all = list.flatMap((x) => timelineOf(a, x).filter((e) => e.kind !== 'now'));
      all.push({ ...ins.ev(ins.NOW, 'now', '📍', 'いま'), assetId: null, assetName: '' });
      return { now: ins.NOW, events: all.sort((p, q) => p.at.localeCompare(q.at)) };
    },

    createAsset(accountId, body) {
      const a = account(accountId);
      if (a.assets.length >= 200) throw new HttpError(400, 'too_many', '登録できる数を超えています');
      const as = newAsset(body || {});
      a.assets.push(as);
      if (Array.isArray(body.ledger)) for (const e of body.ledger.slice(0, 2000)) a.ledger.push({ ...cleanEntry(e, as.source), assetId: as.id });
      return this.asset(accountId, as.id);
    },

    // 連携している建物は取得価格などだけ。自分で作った資産は基本情報・部屋も変えられる
    updateAsset(accountId, id, body) {
      const a = account(accountId);
      if (id.startsWith('L.')) {
        const x = linkAssets(a).find((v) => v.id === id);
        if (!x) throw new HttpError(404, 'not_found', '資産が見つかりません');
        if (body.finance) a.finance[x.buildingId] = cleanFinance(body.finance);
        return this.asset(accountId, id);
      }
      const as = findOwn(a, id);
      const merged = newAsset({ ...as, ...body, source: as.source, finance: body.finance || as.finance, rooms: body.rooms || as.rooms });
      Object.assign(as, { ...merged, id: as.id });
      return this.asset(accountId, id);
    },

    deleteAsset(accountId, id) {
      const a = account(accountId);
      findOwn(a, id);
      a.assets = a.assets.filter((x) => x.id !== id);
      a.ledger = a.ledger.filter((e) => e.assetId !== id);
      return { ok: true };
    },

    addLedger(accountId, id, body) {
      const a = account(accountId);
      const as = findOwn(a, id);
      const items = Array.isArray(body.entries) ? body.entries : [body];
      if (!items.length || items.length > 2000) throw new HttpError(400, 'bad_entries', '取り込む行がありません');
      const src = body.source === 'import' ? 'import' : as.source;
      const clean = items.map((e) => cleanEntry(e, src)); // 1行でも不正なら全部取り込まない
      for (const e of clean) a.ledger.push({ ...e, assetId: id });
      return this.asset(accountId, id);
    },

    deleteLedger(accountId, id, entryId) {
      const a = account(accountId);
      findOwn(a, id);
      const n = a.ledger.length;
      a.ledger = a.ledger.filter((e) => !(e.assetId === id && e.id === entryId));
      if (a.ledger.length === n) throw new HttpError(404, 'not_found', '記録が見つかりません');
      return this.asset(accountId, id);
    },

    // 自主管理・資料の資産の、その月の収支（オーナー自身の記録）
    ownMonth(accountId, month) {
      const a = account(accountId);
      return a.assets.map((as) => {
        const es = a.ledger.filter((e) => e.assetId === as.id && e.month === month);
        const income = es.filter((e) => e.type === 'income').reduce((s, e) => s + e.amount, 0);
        const expense = es.filter((e) => e.type === 'expense').reduce((s, e) => s + e.amount, 0);
        return { assetId: as.id, name: as.name, source: as.source, company: as.company, income, expense, net: income - expense, entries: es };
      }).filter((x) => x.entries.length);
    },

    drainOutbox() {
      return db.outbox.splice(0);
    },
  };
}
