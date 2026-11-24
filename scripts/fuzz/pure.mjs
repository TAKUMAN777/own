// ④ 資料（CSV）の読み込み ⑤ 計算（資産価値・ローン・見通し・修繕・部屋の時期）
import { decode, parseCSV, detect, normMonth } from '../../public/csv.js';
import * as ins from '../../server/insights.mjs';
import { rng, str } from './lib.mjs';

const PRIV_HEAD = ['入居者名', '氏名', '契約者', '電話番号', 'TEL', 'メール', '借主', '保証人', '勤務先', '生年月日'];
const csvCell = (v) => (/[",\n\r]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

export function runPure(t, seed, { csv = 2000, calc = 1000 } = {}) {
  const r = rng(seed);
  // ---------- ④ CSV ----------
  for (let i = 0; i < csv; i++) {
    const kind = r.pick(['rooms', 'ledger', 'ledger2', 'garbage', 'bytes']);
    let text, buf;
    const priv = r.pick(PRIV_HEAD);
    const mark = `PII${i}X`;
    try {
      if (kind === 'bytes') {
        buf = new Uint8Array(r.int(400)).map(() => r.int(256));
        text = decode(buf);
      } else if (kind === 'garbage') {
        text = Array.from({ length: r.int(8) }, () => Array.from({ length: r.int(6) }, () => csvCell(str(r, 15))).join(r.pick([',', '\t']))).join(r.pick(['\n', '\r\n', '\r']));
      } else {
        const head = kind === 'rooms' ? ['部屋番号', '間取り', '賃料', '共益費', '入居状況', priv] : kind === 'ledger' ? ['年月', '項目', '区分', '金額', priv] : ['日付', '摘要', '入金', '出金', '部屋', priv];
        if (r.chance(0.3)) head.sort(() => r() - 0.5);
        const rows = Array.from({ length: r.int(30) }, (_, k) => head.map((h) => {
          if (h === priv) return `${mark}-${str(r, 6)}`;
          if (/部屋|号室/.test(h)) return r.chance(0.9) ? String(100 + k) : str(r, 8);
          if (/間取/.test(h)) return r.pick(['1K', '2LDK', '']);
          if (/賃料|共益|金額|入金|出金/.test(h)) return r.chance(0.8) ? r.pick([String(r.int(300000)), `${r.int(300).toLocaleString('en')},000`, `¥${r.int(9999)}`, '', '-5000', '△3000', '(1200)']) : str(r, 8);
          if (/状況/.test(h)) return r.pick(['入居中', '空室', '募集中', '', '退去済']);
          if (/年月|日付/.test(h)) return r.chance(0.85) ? r.pick(['2026/10', '2026-9', '2026年11月', '2026/10/25', '2026.08']) : str(r, 8);
          if (/項目|摘要/.test(h)) return r.pick(['賃料', '管理料', '清掃', '修繕', '更新料', '"引用,符"', str(r, 40)]);
          if (/区分/.test(h)) return r.pick(['収入', '支出', '', '入金', '出金', str(r, 3)]);
          return str(r, 8);
        }).map(csvCell).join(','));
        text = [head.map(csvCell).join(','), ...rows].join(r.pick(['\n', '\r\n']));
        if (r.chance(0.2)) text = '﻿' + text;
        if (r.chance(0.2)) text = `資料名,テスト\n\n${text}`; // 見出しの上に別の行
      }
      const res = detect(parseCSV(text));
      const errs = [];
      if (!['rooms', 'ledger', null].includes(res.kind)) errs.push(`種類 ${res.kind}`);
      if (!Array.isArray(res.items) || !Array.isArray(res.errors) || !Array.isArray(res.ignored)) errs.push('形');
      const blob = JSON.stringify(res.items);
      if (blob.includes(mark)) errs.push('入居者の列を読み込んだ');
      for (const it of res.items) {
        if (res.kind === 'rooms') {
          const keys = Object.keys(it).sort().join(',');
          if (keys !== 'fee,layout,no,rent,status') errs.push(`部屋の項目 ${keys}`);
          if (!(Number.isFinite(it.rent) && it.rent >= 0 && Number.isFinite(it.fee) && it.fee >= 0)) errs.push(`賃料 ${it.rent}/${it.fee}`);
          if (!['入居中', '空室'].includes(it.status)) errs.push(`状態 ${it.status}`);
          if (!it.no) errs.push('部屋番号が空');
        } else {
          if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(it.month)) errs.push(`年月 ${it.month}`);
          if (!['income', 'expense'].includes(it.type)) errs.push(`区分 ${it.type}`);
          if (!(Number.isInteger(it.amount) && it.amount > 0)) errs.push(`金額 ${it.amount}`);
          if (it.category.length > 30) errs.push('項目が長すぎる');
        }
      }
      if (kind === 'rooms' && res.kind === 'rooms' && !res.ignored.length) errs.push('入居者の列を「読み込まなかった列」に出していない');
      t.check('④資料の読み込み', !errs.length, `${kind}: ${errs[0]}`, { sample: text.slice(0, 160) });
    } catch (e) {
      t.bad('④資料の読み込み', `${kind}: 例外 ${e.message}`, { sample: (text || '').slice(0, 160) });
    }
  }
  // normMonth：ありえない月を通さない
  for (const v of ['2026-13', '2026-0', '2026/00', '1/2026', 'abcd-12', '2026年12月末']) {
    const m = normMonth(v);
    t.check('④資料の読み込み', m === '' || /^\d{4}-(0[1-9]|1[0-2])$/.test(m), `normMonth(${v})=${m}`);
  }

  // ---------- ⑤ 計算 ----------
  const STRUCT = ['RC', 'SRC', 'S', '木造', '軽量鉄骨', '', 'その他'];
  for (let i = 0; i < calc; i++) {
    const rooms = Array.from({ length: r.int(30) }, (_, k) => ({ no: String(k), rent: r.int(200000), fee: r.int(10000), status: r.chance(0.85) ? '入居中' : '空室' }));
    const finance = {
      price: r.chance(0.8) ? r.int(500000000) : 0, loanBalance: r.chance(0.7) ? r.int(400000000) : 0, loanRate: r.chance(0.8) ? Math.round(r() * 500) / 100 : 0,
      loanMonthly: r.chance(0.8) ? r.int(3000000) : 0, propertyTax: r.int(2000000), insurance: r.int(300000), appraisal: r.chance(0.2) ? r.int(600000000) : 0, capRate: r.chance(0.3) ? Math.round(r() * 1000) / 100 : 0,
    };
    const curYear = rooms.filter((x) => x.status !== '空室').reduce((s, x) => s + (x.rent + x.fee) * 12, 0);
    const annualCost = r.int(5000000) + finance.propertyTax + finance.insurance;
    const built = r.chance(0.9) ? `${r.range(1960, 2026)}-${String(r.range(1, 12)).padStart(2, '0')}` : '';
    const x = { structure: r.pick(STRUCT), built, rooms, finance, kpi: { curYear, annualCost } };
    const errs = [];
    try {
      const v = ins.valuation(x);
      if (!(Number.isFinite(v.value) && v.value >= 0)) errs.push(`価値 ${v.value}`);
      if (v.equity !== v.value - finance.loanBalance) errs.push('純資産の式');
      if (finance.appraisal && v.value !== finance.appraisal) errs.push('査定額を使っていない');
      if (!finance.appraisal && v.noi > 0 && Math.abs(v.value - v.noi / (v.capRate / 100)) > 5000) errs.push('推定の式');
      if (!(v.capRate > 0)) errs.push(`想定の利回り ${v.capRate}`);
      const L = ins.loanPlan(finance);
      if (L.payoff) {
        const bals = L.schedule.map((s) => s.balance);
        if (bals[bals.length - 1] !== 0) errs.push('完済の月に残高が0でない');
        if (!bals.every((b, k) => k === 0 || b <= bals[k - 1])) errs.push('残高が増えている');
        if (!(L.months > 0 && L.months <= 600)) errs.push(`返済月数 ${L.months}`);
        if (L.payoff <= ins.NOW) errs.push('完済がいま以前');
      } else if (finance.loanBalance && finance.loanMonthly > finance.loanBalance * (finance.loanRate / 1200) && L.months !== null && L.months !== 0 && !L.warning) {
        errs.push('完済見込みが出ない');
      }
      if (L.months === 600 && !L.warning) errs.push('50年で返し終わらないのに注意が出ない');
      const P = ins.projection(x);
      if (P.years.length !== 10) errs.push('見通しが10年でない');
      for (const y of P.years) {
        if (y.cash !== y.rent - y.cost - y.repair - y.loan) errs.push('手取りの式');
        if (y.loanBalance < 0 || !Number.isFinite(y.loanBalance)) errs.push(`借入残高 ${y.loanBalance}`);
        if (y.loanBalance > (finance.loanBalance || 0)) errs.push('借入残高が増えた');
      }
      const R = ins.repairPlan(x);
      const end = ins.addMonths(ins.NOW, 120);
      if (!R.every((q, k) => q.month >= ins.NOW && q.month <= end && (k === 0 || R[k - 1].month <= q.month) && q.cost > 0)) errs.push('修繕の時期・順番・費用');
      if (!built && R.length) errs.push('築年月なしで修繕が出る');
      const vf = r.chance(0.3) ? r.pick(['2026-09', '2026-11', '2027-02']) : null;
      const life = ins.roomLife(`BL-${r.int(50)}`, String(r.int(600)), built || '2010-01', vf);
      if (vf && life.moveOut !== vf) errs.push('退去の月');
      if (!vf && !(life.leaseEnd > ins.NOW)) errs.push('次の更新がいま以前');
      if (!(life.since < ins.addMonths(ins.NOW, 1))) errs.push(`入居がいまより先 ${life.since}`);
      for (const [a, n] of [['2026-11', 1], ['2026-12', 1], ['2026-01', -1], ['2020-06', 25]]) {
        const m = ins.addMonths(a, n);
        if (ins.monthsBetween(a, m) !== n) errs.push(`月の足し算 ${a}+${n}=${m}`);
      }
    } catch (e) { errs.push(`例外 ${e.message}`); }
    t.check('⑤計算', !errs.length, errs[0], { x: JSON.stringify(finance) });
  }
}
