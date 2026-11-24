// 資産価値・これからの見通し・タイムライン（過去・現在・未来）
// すべて「目安」。前提はこのファイルの数字で、画面にも前提を出す。
export const NOW = '2026-11'; // デモの「いま」

// 想定の利回り（還元利回り）：構造で決める。オーナーが資産ごとに上書きできる
export const CAP_RATE = { RC: 5.0, SRC: 5.0, S: 5.5, 軽量鉄骨: 6.0, 木造: 6.5 };
const CAP_DEFAULT = 6.0;
// 法定耐用年数（住宅用）
export const LIFE = { RC: 47, SRC: 47, S: 34, 軽量鉄骨: 27, 木造: 22 };

const addMonths = (ym, n) => {
  const [y, m] = ym.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};
const monthsBetween = (a, b) => { const [ay, am] = a.split('-').map(Number); const [by, bm] = b.split('-').map(Number); return (by - ay) * 12 + (bm - am); };
export { addMonths, monthsBetween };

// 資産価値（簡易の収益還元）：査定額が入っていればそれを使う
export function valuation(x) {
  const f = x.finance || {};
  const capRate = f.capRate || CAP_RATE[x.structure] || CAP_DEFAULT;
  const noi = x.kpi.curYear - x.kpi.annualCost; // いまの入居での年間賃料 − 年間運営費の見込み
  const estimated = noi > 0 ? Math.round(noi / (capRate / 100) / 10000) * 10000 : 0;
  const value = f.appraisal || estimated;
  return {
    value, method: f.appraisal ? 'appraisal' : 'income', capRate, noi, estimated,
    equity: value - (f.loanBalance || 0), // 純資産（価値 − 借入残高）
    gain: f.price ? value - f.price : null, // 取得価格との差
  };
}

// ローンの完済見込み（元利均等で、いまの残高・金利・毎月の返済額から）
export function loanPlan(f) {
  const B = f.loanBalance || 0, P = f.loanMonthly || 0, r = (f.loanRate || 0) / 100 / 12;
  if (!B) return { payoff: null, months: 0, schedule: [] };
  if (!P || (r && P <= B * r)) return { payoff: null, months: null, schedule: [], warning: '毎月の返済額では完済しない計算です' };
  const schedule = [];
  let bal = B, n = 0;
  while (bal > 0 && n < 600) {
    const interest = bal * r;
    bal = Math.max(0, bal + interest - P);
    n++;
    if (n % 12 === 0 || bal === 0) schedule.push({ month: addMonths(NOW, n), balance: Math.round(bal) });
  }
  if (bal > 0) return { payoff: null, months: null, schedule, warning: '50年で返し終わらない計算です' };
  return { payoff: addMonths(NOW, n), months: n, schedule };
}

// これからの修繕の目安（周期と、部屋数・階数からのおおよその費用）
const REPAIRS = [
  { name: '鉄部塗装', cycle: 6, cost: (x) => 150000 * Math.max(1, x.floors || 1) },
  { name: '外壁・屋上防水', cycle: 12, cost: (x) => 350000 * Math.max(1, x.rooms.length) },
  { name: '給湯器の交換（全室）', cycle: 15, cost: (x) => 200000 * Math.max(1, x.rooms.length) },
  { name: '給排水管の更新', cycle: 30, cost: (x) => 500000 * Math.max(1, x.rooms.length) },
];
export function repairPlan(x, years = 10) {
  if (!x.built) return [];
  const end = addMonths(NOW, years * 12);
  const out = [];
  for (const r of REPAIRS) {
    let k = 1, due = addMonths(x.built, r.cycle * 12);
    while (due < NOW) { k++; due = addMonths(x.built, r.cycle * 12 * k); }
    while (due <= end) {
      out.push({ month: due, name: r.name, cost: r.cost(x) });
      k++; due = addMonths(x.built, r.cycle * 12 * k);
    }
  }
  return out.sort((a, b) => a.month.localeCompare(b.month));
}

// 10年の見通し（年ごと）：家賃は毎年0.5%下がる前提、運営費は一定、修繕は上の目安
export function projection(x, years = 10) {
  const loan = loanPlan(x.finance || {});
  const repairs = repairPlan(x, years);
  const y0 = Number(NOW.slice(0, 4));
  const out = [];
  for (let i = 1; i <= years; i++) {
    const year = y0 + i;
    const rent = Math.round(x.kpi.curYear * 0.995 ** i);
    const cost = x.kpi.annualCost;
    const repair = repairs.filter((r) => Number(r.month.slice(0, 4)) === year).reduce((s, r) => s + r.cost, 0);
    const paid = loan.payoff && loan.payoff < `${year}-01` ? 0 : (x.finance?.loanMonthly || 0) * 12;
    // その年の末の借入残高（年ごとの記録のうち、その年末までの最後のもの）
    const upto = loan.schedule.filter((s) => s.month <= `${year}-12`);
    const bal = !x.finance?.loanBalance ? 0 : upto.length ? upto[upto.length - 1].balance : x.finance.loanBalance;
    out.push({ year, rent, cost, repair, loan: paid, cash: rent - cost - repair - paid, loanBalance: bal });
  }
  return { years: out, assumptions: '家賃は毎年0.5%ずつ下がる、運営費は今と同じ、修繕は周期からの目安、借入はいまの返済額のまま' };
}

// 部屋の入居の経過（デモ用に部屋番号から決まった値を作る。本番は管理会社の契約データ）
export function roomLife(buildingId, no, built, vacantFrom) {
  let h = 0;
  for (const c of buildingId + no) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const start = addMonths(built > '2016-01' ? built : '2016-01', 6 + (h % 60));
  const since = start < NOW ? start : addMonths(NOW, -6);
  if (vacantFrom) return { since, moveOut: vacantFrom, leaseEnd: null };
  let leaseEnd = addMonths(since, 24);
  while (leaseEnd <= NOW) leaseEnd = addMonths(leaseEnd, 24);
  return { since, moveOut: null, leaseEnd };
}

// タイムラインの1件：{ at: 'YYYY-MM', when: past|now|future, kind, icon, title, detail, amount, room }
export function ev(at, kind, icon, title, extra = {}) {
  const when = at < NOW ? 'past' : at === NOW ? 'now' : 'future';
  return { at, when, kind, icon, title, ...extra };
}
