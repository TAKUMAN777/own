// データの置き場所（デモ：メモリ上）。
// このアプリはオーナー自身のもの。オーナーのアカウントに、複数の管理会社（各社の REVO管理）がつながる。
// 本番では、管理会社ごとのデータ取得を各社の REVO管理 API の呼び出しに置き換える（docs/API.md）。
import * as seed from './seed.mjs';

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

    // 招待コードでログイン（初回はアカウントを作る）。すでにつながっている会社のコードなら、そのアカウントに入る
    login(code) {
      const inv = db.invites[String(code || '').trim().toUpperCase()];
      if (!inv) throw new HttpError(401, 'invalid_code', '招待コードが正しくありません');
      let a = db.accounts.find((x) => x.links.some((l) => l.tenantId === inv.tenantId && l.ownerId === inv.ownerId));
      if (!a) {
        a = { id: `ACC-${seq++}`, name: ownerRec(inv.ownerId).name, links: [{ ...inv }] };
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
            tenantId: l.tenantId, ownerId: l.ownerId, company: t.company, tel: t.tel,
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

    drainOutbox() {
      return db.outbox.splice(0);
    },
  };
}
