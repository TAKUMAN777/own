// データの置き場所（デモ：メモリ上）。本番ではここを REVO管理 API の呼び出しに置き換える。
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
    tenant: clone(seed.tenant),
    invites: clone(seed.invites),
    owners: clone(seed.owners),
    buildings: clone(seed.buildings),
    mgmt: clone(seed.mgmt),
    quotes: clone(seed.quotes),
    proposals: clone(seed.proposals),
    orders: clone(seed.orders),
    remittances: seed.buildRemittances(),
    notifications: [],
    outbox: [], // オーナー向けアプリ → REVO管理 に届ける回答（本番は REVO管理 API へ POST）
  };
  let seq = 1;

  const owner = (id) => {
    const o = db.owners.find((x) => x.id === id);
    if (!o) throw new HttpError(404, 'not_found', 'オーナーが見つかりません');
    return o;
  };

  const withQuotes = (p) => {
    const b = db.buildings.find((x) => x.id === p.buildingId);
    return {
      ...p,
      buildingName: b ? b.name : '',
      quotes: p.quoteIds.map((qid) => db.quotes.find((q) => q.id === qid)).filter(Boolean),
    };
  };

  function notify(ownerId, type, title, link) {
    db.notifications.unshift({ id: `NT-${seq++}`, ownerId, type, title, link: link || null, at: new Date().toISOString(), read: false });
  }

  return {
    db,
    tenant: () => db.tenant,

    redeemInvite(code) {
      const inv = db.invites[String(code || '').trim().toUpperCase()];
      if (!inv) throw new HttpError(401, 'invalid_code', '招待コードが正しくありません');
      return inv;
    },

    ownerProfile(ownerId) {
      const o = owner(ownerId);
      return {
        id: o.id, name: o.name, kana: o.kana, type: o.type,
        buildings: db.buildings.filter((b) => b.ownerId === ownerId).map((b) => ({
          ...b, units: seed.units.filter((u) => u.buildingId === b.id).length,
        })),
        mgmt: db.mgmt.filter((m) => m.ownerId === ownerId),
      };
    },

    months() {
      return { months: seed.MONTHS, closed: seed.closed };
    },

    pl(ownerId, month) {
      owner(ownerId);
      if (!seed.MONTHS.includes(month)) throw new HttpError(404, 'not_found', 'この月のデータはありません');
      // 月締め前の数字はオーナーに出さない
      if (!seed.closed.includes(month)) throw new HttpError(409, 'not_closed', 'この月はまだ締めていません');
      return seed.buildPL(ownerId, month);
    },

    proposals(ownerId, status) {
      owner(ownerId);
      return db.proposals
        .filter((p) => p.ownerId === ownerId && p.status !== 'draft' && p.status !== 'superseded')
        .filter((p) => !status || p.status === status)
        .sort((a, b) => (b.sentAt || '').localeCompare(a.sentAt || ''))
        .map(withQuotes);
    },

    proposal(id) {
      const p = db.proposals.find((x) => x.id === id);
      if (!p || p.status === 'draft') throw new HttpError(404, 'not_found', 'ご提案が見つかりません');
      return withQuotes(p);
    },

    // RevoWorks.ownerRespond(proposalId, decision, { quoteId, comment, via }) と同じルール
    respond(id, ownerId, body) {
      const p = db.proposals.find((x) => x.id === id);
      if (!p || p.ownerId !== ownerId) throw new HttpError(404, 'not_found', 'ご提案が見つかりません');
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
      db.outbox.push({ type: 'proposal.answered', proposalId: p.id, ownerId, response: p.response });
      return withQuotes(p);
    },

    remittances(ownerId) {
      owner(ownerId);
      return db.remittances.filter((r) => r.ownerId === ownerId).sort((a, b) => b.month.localeCompare(a.month));
    },

    reports(ownerId, month) {
      owner(ownerId);
      if (!month) {
        return seed.closed.slice().reverse().map((m) => ({ month: m, title: `${Number(m.slice(5))}月 月次報告書`, publishedAt: `${m}-25` }));
      }
      const pl = this.pl(ownerId, month);
      const rem = db.remittances.find((r) => r.ownerId === ownerId && r.month === month) || null;
      const works = db.orders.filter((o) => o.ownerId === ownerId).map((o) => ({
        id: o.id, title: o.title, status: o.status,
        doneInMonth: o.history.some((h) => h.at.startsWith(month)),
      })).filter((w) => w.doneInMonth);
      return {
        month, owner: { id: ownerId, name: owner(ownerId).name }, pl, remittance: rem, works,
        notes: (seed.reportNotes[ownerId] && seed.reportNotes[ownerId][month]) || [],
      };
    },

    works(ownerId) {
      owner(ownerId);
      return db.orders.filter((o) => o.ownerId === ownerId).map((o) => {
        const b = db.buildings.find((x) => x.id === o.buildingId);
        return { ...o, buildingName: b ? b.name : '', steps: seed.ORDER_STEPS };
      });
    },

    photoBelongsTo(photoId, ownerId) {
      return db.orders.some((o) => o.ownerId === ownerId && o.photos.some((p) => p.id === photoId));
    },
    photo(photoId) {
      for (const o of db.orders) {
        const p = o.photos.find((x) => x.id === photoId);
        if (p) return { ...p, title: o.title };
      }
      return null;
    },

    notifications(ownerId) {
      return db.notifications.filter((n) => n.ownerId === ownerId).slice(0, 30);
    },

    // REVO管理 → オーナー向けアプリ のイベント
    ingestEvent(ev) {
      if (!ev || typeof ev.type !== 'string') throw new HttpError(400, 'bad_event', 'イベントの形式が正しくありません');
      const d = ev.data || {};
      switch (ev.type) {
        case 'proposal.sent': {
          const p = d.proposal;
          if (!p || !p.id || !p.ownerId || !Array.isArray(p.quoteIds)) throw new HttpError(400, 'bad_event', 'proposal が必要です');
          for (const q of d.quotes || []) {
            const i = db.quotes.findIndex((x) => x.id === q.id);
            if (i >= 0) db.quotes[i] = q; else db.quotes.push(q);
          }
          // 同じ案件の古い提案は superseded（承認待ちは1件まで）
          for (const old of db.proposals) {
            if (old.threadId === p.threadId && old.id !== p.id && old.status === 'sent') old.status = 'superseded';
          }
          const i = db.proposals.findIndex((x) => x.id === p.id);
          const rec = { ...p, status: 'sent', response: null };
          if (i >= 0) db.proposals[i] = rec; else db.proposals.push(rec);
          notify(p.ownerId, ev.type, `新しいご提案：${p.title}`, `#/proposals/${p.id}`);
          break;
        }
        case 'proposal.answered': {
          const p = db.proposals.find((x) => x.id === d.proposalId);
          if (p && d.response) { p.status = { approve: 'approved', conditional: 'conditional', return: 'returned' }[d.response.decision] || p.status; p.response = d.response; }
          break;
        }
        case 'order.placed':
        case 'order.completed':
        case 'order.updated': {
          const o = d.order;
          if (!o || !o.id || !o.ownerId) throw new HttpError(400, 'bad_event', 'order が必要です');
          const i = db.orders.findIndex((x) => x.id === o.id);
          if (i >= 0) db.orders[i] = { ...db.orders[i], ...o }; else db.orders.push({ photos: [], history: [], ...o });
          notify(o.ownerId, ev.type, ev.type === 'order.placed' ? `工事を発注しました：${o.title}` : `工事の状況が更新されました：${o.title}`, '#/works');
          break;
        }
        case 'remittance.paid': {
          const r = d.remittance;
          if (!r || !r.id || !r.ownerId) throw new HttpError(400, 'bad_event', 'remittance が必要です');
          const i = db.remittances.findIndex((x) => x.id === r.id);
          if (i >= 0) db.remittances[i] = r; else db.remittances.push(r);
          notify(r.ownerId, ev.type, `${Number(r.month.slice(5))}月分のご送金が完了しました`, '#/money');
          break;
        }
        case 'report.published':
          if (!d.ownerId || !d.month) throw new HttpError(400, 'bad_event', 'ownerId と month が必要です');
          notify(d.ownerId, ev.type, `${Number(d.month.slice(5))}月の月次報告書を掲載しました`, `#/reports/${d.month}`);
          break;
        case 'contract.renewal_due':
          if (!d.ownerId) throw new HttpError(400, 'bad_event', 'ownerId が必要です');
          notify(d.ownerId, ev.type, `管理委託契約の更新時期が近づいています（${d.end || ''}）`, null);
          break;
        default:
          throw new HttpError(400, 'unknown_event', `未対応のイベントです：${ev.type}`);
      }
      return { ok: true };
    },

    drainOutbox() {
      const items = db.outbox.splice(0);
      return items;
    },
  };
}
