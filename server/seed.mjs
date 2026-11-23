// 架空のデモデータ（REVO管理 側のデータの「写し」に相当）。
// 本番では REVO管理 の API から取得するため、このファイルは使わない。
// 金額は REVO管理 側で計算済みの値として扱い、オーナー向けアプリ側では再計算しない。

// アプリの名前。オーナー自身が使うアプリ（REVO の4つ目の製品）
export const app = { name: 'REVO ASSET' };

// つながる管理会社（各社が REVO管理 を使っている想定）
export const tenants = [
  { id: 'T-01', company: '〇〇不動産管理株式会社', tel: '092-000-0000', system: 'REVO管理' },
  { id: 'T-02', company: '△△ハウジング株式会社', tel: '092-111-1111', system: 'REVO管理' },
  { id: 'T-03', company: '□□管理サービス株式会社', tel: '092-222-2222', system: 'REVO MANAGER' },
];

// 招待コード（各管理会社が発行）→ その会社でのオーナー
export const invites = {
  'HKT-0001': { tenantId: 'T-01', ownerId: 'OW-01' },
  'HKT-0002': { tenantId: 'T-01', ownerId: 'OW-02' },
  'TNJ-0011': { tenantId: 'T-02', ownerId: 'OW-11' },
  'MGR-0021': { tenantId: 'T-03', ownerId: 'OW-21' },
};

export const MONTHS = ['2026-09', '2026-10', '2026-11'];
export const closed = ['2026-09', '2026-10'];

export const owners = [
  { id: 'OW-01', tenantId: 'T-01', name: '田中 靖夫', kana: 'タナカ ヤスオ', type: '個人' },
  { id: 'OW-02', tenantId: 'T-01', name: '山本 恵子', kana: 'ヤマモト ケイコ', type: '個人' },
  { id: 'OW-11', tenantId: 'T-02', name: '田中 靖夫', kana: 'タナカ ヤスオ', type: '個人' },
  { id: 'OW-21', tenantId: 'T-03', name: '田中 靖夫', kana: 'タナカ ヤスオ', type: '個人' },
];

export const buildings = [
  { id: 'BL-01', name: 'グランメゾン博多', ownerId: 'OW-01', address: '福岡市博多区博多駅南1-0-0', structure: 'RC', floors: 5, built: '2008-03' },
  { id: 'BL-02', name: 'ベルシティ大濠', ownerId: 'OW-01', address: '福岡市中央区荒戸2-0-0', structure: 'S', floors: 3, built: '2015-09' },
  { id: 'BL-11', name: 'リバーサイド天神', ownerId: 'OW-11', address: '福岡市中央区天神4-0-0', structure: 'RC', floors: 4, built: '2012-02' },
  { id: 'BL-21', name: 'メゾン六本松', ownerId: 'OW-21', address: '福岡市中央区六本松1-0-0', structure: '木造', floors: 2, built: '2004-06' },
  { id: 'BL-03', name: 'コーポ香椎', ownerId: 'OW-02', address: '福岡市東区香椎駅前3-0-0', structure: '木造', floors: 2, built: '1999-04' },
];

export const mgmt = [
  { id: 'MG-01', ownerId: 'OW-01', rate: 0.05, remitDay: 25, start: '2024-04-01', end: '2027-03-31' },
  { id: 'MG-11', ownerId: 'OW-11', rate: 0.04, remitDay: 27, start: '2023-10-01', end: '2027-09-30' },
  { id: 'MG-21', ownerId: 'OW-21', rate: 0.05, remitDay: 20, start: '2025-04-01', end: '2028-03-31' },
  { id: 'MG-02', ownerId: 'OW-02', rate: 0.05, remitDay: 25, start: '2025-01-01', end: '2026-12-31' },
];

// 部屋（オーナーには部屋番号と状態だけを見せる。入居者の情報は持たない）
function rooms(buildingId, list) {
  return list.map(([no, rent, fee, vacantFrom]) => ({ buildingId, no, rent, fee, vacantFrom: vacantFrom || null }));
}
export const units = [
  ...rooms('BL-01', [
    ['101', 68000, 5000], ['102', 68000, 5000], ['201', 70000, 5000], ['202', 70000, 5000, '2026-11'],
    ['203', 70000, 5000], ['301', 72000, 5000], ['302', 72000, 5000], ['303', 72000, 5000],
    ['401', 74000, 5000], ['402', 74000, 5000], ['501', 82000, 5000], ['502', 82000, 5000, '2026-10'],
  ]),
  ...rooms('BL-02', [
    ['101', 58000, 3000], ['102', 58000, 3000], ['201', 60000, 3000], ['202', 60000, 3000],
    ['203', 60000, 3000, '2026-11'], ['301', 62000, 3000], ['302', 62000, 3000], ['303', 62000, 3000],
  ]),
  ...rooms('BL-11', [
    ['101', 88000, 6000], ['102', 88000, 6000], ['201', 90000, 6000], ['202', 90000, 6000, '2026-11'],
    ['301', 92000, 6000], ['401', 120000, 8000],
  ]),
  ...rooms('BL-21', [
    ['101', 52000, 3000], ['102', 52000, 3000], ['201', 54000, 3000], ['202', 54000, 3000, '2026-10'],
  ]),
  ...rooms('BL-03', [
    ['101', 42000, 2000], ['102', 42000, 2000, '2026-08'], ['103', 42000, 2000],
    ['201', 44000, 2000], ['202', 44000, 2000], ['203', 44000, 2000],
  ]),
];

// 月ごとの費用（清掃・点検・光熱など）
export const expenses = [
  { buildingId: 'BL-01', month: '2026-09', kind: '清掃', amount: 22000 },
  { buildingId: 'BL-01', month: '2026-09', kind: '共用電気', amount: 8400 },
  { buildingId: 'BL-01', month: '2026-10', kind: '清掃', amount: 22000 },
  { buildingId: 'BL-01', month: '2026-10', kind: '共用電気', amount: 8100 },
  { buildingId: 'BL-01', month: '2026-10', kind: '消防設備点検', amount: 33000 },
  { buildingId: 'BL-01', month: '2026-11', kind: '清掃', amount: 22000 },
  { buildingId: 'BL-02', month: '2026-09', kind: '清掃', amount: 15000 },
  { buildingId: 'BL-02', month: '2026-10', kind: '清掃', amount: 15000 },
  { buildingId: 'BL-02', month: '2026-11', kind: '清掃', amount: 15000 },
  { buildingId: 'BL-11', month: '2026-09', kind: '清掃', amount: 18000 },
  { buildingId: 'BL-11', month: '2026-10', kind: '清掃', amount: 18000 },
  { buildingId: 'BL-11', month: '2026-10', kind: 'エレベーター点検', amount: 27500 },
  { buildingId: 'BL-11', month: '2026-11', kind: '清掃', amount: 18000 },
  { buildingId: 'BL-21', month: '2026-09', kind: '清掃', amount: 8800 },
  { buildingId: 'BL-21', month: '2026-10', kind: '清掃', amount: 8800 },
  { buildingId: 'BL-21', month: '2026-11', kind: '清掃', amount: 8800 },
  { buildingId: 'BL-03', month: '2026-09', kind: '清掃', amount: 11000 },
  { buildingId: 'BL-03', month: '2026-10', kind: '清掃', amount: 11000 },
  { buildingId: 'BL-03', month: '2026-10', kind: '共用灯 交換', amount: 6600 },
  { buildingId: 'BL-03', month: '2026-11', kind: '清掃', amount: 11000 },
];

// 未入金（部屋番号のみ）。11月は入金データ取込前のため多い。
const unpaidRooms = {
  '2026-09': { 'BL-01': [], 'BL-02': [], 'BL-03': ['203'], 'BL-11': [], 'BL-21': [] },
  '2026-10': { 'BL-01': ['301'], 'BL-02': [], 'BL-03': [], 'BL-11': [], 'BL-21': [] },
  '2026-11': { 'BL-01': ['101', '102', '201', '203', '301'], 'BL-02': ['101', '201', '202'], 'BL-03': ['101', '201'], 'BL-11': ['101', '301'], 'BL-21': ['101'] },
};

// 月の経過メモ（報告書用。入居者名は書かない）
export const reportNotes = {
  'OW-01': {
    '2026-09': ['グランメゾン博多 502号室 退去（9月末）。原状回復工事を手配しました。', '定期清掃（月2回）を実施しました。'],
    '2026-10': ['グランメゾン博多 202号室 退去（10月末）。募集を開始しました。', '消防設備点検を実施しました（指摘なし）。', '301号室の10月分賃料が未入金です。督促中です。'],
  },
  'OW-11': {
    '2026-09': ['リバーサイド天神 全室入居中です。'],
    '2026-10': ['エレベーターの定期点検を実施しました（指摘なし）。', '202号室から11月末の解約予告を受けました。'],
  },
  'OW-02': {
    '2026-09': ['コーポ香椎 203号室の9月分賃料が未入金でしたが、10月5日に入金を確認しました。'],
    '2026-10': ['コーポ香椎 共用灯（階段）を交換しました。', '102号室は引き続き募集中です。家賃の見直しをご提案予定です。'],
  },
};

function isOccupied(u, month) {
  return !u.vacantFrom || month < u.vacantFrom;
}

// ownerPL 相当（REVO管理 側の計算結果として扱う）
export function buildPL(ownerId, month) {
  const rate = mgmt.find((m) => m.ownerId === ownerId).rate;
  const bl = buildings.filter((b) => b.ownerId === ownerId).map((b) => {
    const us = units.filter((u) => u.buildingId === b.id);
    const occ = us.filter((u) => isOccupied(u, month));
    const billed = occ.reduce((s, u) => s + u.rent + u.fee, 0);
    const unpaidNos = (unpaidRooms[month] && unpaidRooms[month][b.id]) || [];
    const unpaid = occ.filter((u) => unpaidNos.includes(u.no)).reduce((s, u) => s + u.rent + u.fee, 0);
    const received = billed - unpaid;
    const fee = Math.round(received * rate);
    const expense = expenses.filter((e) => e.buildingId === b.id && e.month === month).reduce((s, e) => s + e.amount, 0);
    return {
      buildingId: b.id, name: b.name, units: us.length, occupied: occ.length,
      billed, received, unpaid, fee, expense, remit: received - fee - expense,
      rooms: us.map((u) => ({ no: u.no, status: isOccupied(u, month) ? (unpaidNos.includes(u.no) ? '未入金' : '入居中') : '空室' })),
      expenses: expenses.filter((e) => e.buildingId === b.id && e.month === month).map(({ kind, amount }) => ({ kind, amount })),
    };
  });
  const sum = (k) => bl.reduce((s, b) => s + b[k], 0);
  return {
    ownerId, month, closed: closed.includes(month),
    billed: sum('billed'), received: sum('received'), unpaid: sum('unpaid'),
    fee: sum('fee'), expense: sum('expense'), remit: sum('remit'),
    occupied: sum('occupied'), units: sum('units'), buildings: bl,
  };
}

// 見積
export const quotes = [
  { id: 'Q-301', contractor: '博多設備工業', items: [{ name: '給湯器 本体（エコジョーズ 24号）', amount: 168000 }, { name: '交換工事・撤去処分', amount: 52000 }], total: 220000, warranty: '本体10年', days: 1, note: '在庫あり。最短で来週施工可能。', status: 'submitted' },
  { id: 'Q-302', contractor: '福岡ライフサービス', items: [{ name: '給湯器 本体（従来型 24号）', amount: 128000 }, { name: '交換工事・撤去処分', amount: 48000 }], total: 176000, warranty: '本体5年', days: 3, note: '取り寄せ品のため3日程度。', status: 'submitted' },
  { id: 'Q-311', contractor: '九州塗装', items: [{ name: '鉄部塗装（外階段・手すり）', amount: 380000 }, { name: '足場・養生', amount: 90000 }], total: 470000, warranty: '3年', days: 7, note: '', status: 'submitted' },
  { id: 'Q-312', contractor: '香椎リフォーム', items: [{ name: '鉄部塗装（外階段・手すり）', amount: 340000 }, { name: '足場・養生', amount: 85000 }], total: 425000, warranty: '2年', days: 8, note: '', status: 'submitted' },
  { id: 'Q-290', contractor: '博多電設', items: [{ name: '共用廊下照明 LED化（14台）', amount: 196000 }, { name: '工事費', amount: 64000 }], total: 260000, warranty: '5年', days: 2, note: '', status: 'accepted' },
  { id: 'Q-280', contractor: '福岡ライフサービス', items: [{ name: '502号室 原状回復（クロス・床）', amount: 148000 }], total: 148000, warranty: '1年', days: 4, note: '', status: 'accepted' },
];

// 提案（status: draft → sent → approved / conditional / returned、古い版は superseded）
export const proposals = [
  {
    id: 'PR-301', threadId: 'TH-30', ownerId: 'OW-01', buildingId: 'BL-01', version: 1,
    title: 'グランメゾン博多 203号室 給湯器の交換',
    quoteIds: ['Q-301', 'Q-302'], recommendedId: 'Q-301',
    reason: '使用から15年が経ち、点火不良が出ています。修理部品の供給が終わっているため交換をおすすめします。A案は省エネ型で、ガス代の削減と10年保証があります。',
    notes: '冬に入る前の施工をおすすめします。', status: 'sent', channel: 'portal', sentAt: '2026-11-20T10:00:00+09:00', response: null,
  },
  {
    id: 'PR-311', threadId: 'TH-31', ownerId: 'OW-02', buildingId: 'BL-03', version: 1,
    title: 'コーポ香椎 外階段・手すりの塗装',
    quoteIds: ['Q-311', 'Q-312'], recommendedId: 'Q-312',
    reason: '外階段と手すりに錆が広がっています。放置すると腐食が進むため、塗装をおすすめします。両案とも同じ塗料で、B案のほうが費用を抑えられます。',
    notes: '', status: 'sent', channel: 'portal', sentAt: '2026-11-18T15:00:00+09:00', response: null,
  },
  {
    id: 'PR-290', threadId: 'TH-29', ownerId: 'OW-01', buildingId: 'BL-01', version: 1,
    title: 'グランメゾン博多 共用廊下照明のLED化',
    quoteIds: ['Q-290'], recommendedId: 'Q-290',
    reason: '電気代と球切れ対応の手間を減らせます。', notes: '', status: 'approved', channel: 'portal',
    sentAt: '2026-10-02T09:00:00+09:00',
    response: { decision: 'approve', quoteId: 'Q-290', comment: 'お願いします。', via: 'line', at: '2026-10-03T08:12:00+09:00' },
  },
  {
    id: 'PR-280', threadId: 'TH-28', ownerId: 'OW-01', buildingId: 'BL-01', version: 1,
    title: 'グランメゾン博多 502号室 原状回復',
    quoteIds: ['Q-280'], recommendedId: 'Q-280',
    reason: '退去後の原状回復です（貸主負担分）。', notes: '', status: 'approved', channel: 'portal',
    sentAt: '2026-09-28T09:00:00+09:00',
    response: { decision: 'approve', quoteId: 'Q-280', comment: '', via: 'phone', at: '2026-09-28T14:00:00+09:00' },
  },
];

export const ORDER_STEPS = ['発注済', '請書受領', '完了報告', '検収済', '請求書受領', '支払済'];

export const orders = [
  {
    id: 'OD-290', proposalId: 'PR-290', ownerId: 'OW-01', buildingId: 'BL-01', title: '共用廊下照明のLED化', contractor: '博多電設', amount: 260000,
    status: '完了報告', history: [
      { status: '発注済', at: '2026-10-06' }, { status: '請書受領', at: '2026-10-08' }, { status: '完了報告', at: '2026-11-19' },
    ],
    photos: [
      { id: 'ph-290-1', caption: '施工前（2階廊下）', kind: 'before' },
      { id: 'ph-290-2', caption: '施工後（2階廊下）', kind: 'after' },
      { id: 'ph-290-3', caption: '施工後（エントランス）', kind: 'after' },
    ],
    report: '14台すべての交換を終えました。点灯を確認しています。',
  },
  {
    id: 'OD-280', proposalId: 'PR-280', ownerId: 'OW-01', buildingId: 'BL-01', title: '502号室 原状回復', contractor: '福岡ライフサービス', amount: 148000,
    status: '支払済', history: [
      { status: '発注済', at: '2026-09-29' }, { status: '請書受領', at: '2026-09-30' }, { status: '完了報告', at: '2026-10-06' },
      { status: '検収済', at: '2026-10-07' }, { status: '請求書受領', at: '2026-10-10' }, { status: '支払済', at: '2026-10-25' },
    ],
    photos: [
      { id: 'ph-280-1', caption: '施工前（洋室）', kind: 'before' },
      { id: 'ph-280-2', caption: '施工後（洋室）', kind: 'after' },
    ],
    report: 'クロス全面張替え・床の部分補修を行いました。',
  },
  {
    id: 'OD-501', proposalId: null, ownerId: 'OW-11', buildingId: 'BL-11', title: '屋上防水の部分補修', contractor: '天神防水工業', amount: 185000,
    status: '請書受領', history: [{ status: '発注済', at: '2026-11-12' }, { status: '請書受領', at: '2026-11-14' }],
    photos: [], report: '',
  },
];

// 送金（REVO管理 の payouts の owner 行に相当）
// 工事代金（オーナー負担）は請求書受領後の最初のオーナー送金で1回だけ差し引く
export function buildRemittances() {
  const list = [];
  const worksByMonth = { '2026-10': { 'OW-01': [{ orderId: 'OD-280', title: '502号室 原状回復', amount: 148000 }] } };
  for (const month of closed) {
    for (const o of owners) {
      const pl = buildPL(o.id, month);
      const works = (worksByMonth[month] && worksByMonth[month][o.id]) || [];
      const worksTotal = works.reduce((s, w) => s + w.amount, 0);
      list.push({
        id: `RM-${month}-${o.id}`, batchId: `PB-${month}`, month, date: `${month}-${mgmt.find((m) => m.ownerId === o.id).remitDay}`, status: '送金済', ownerId: o.id, tenantId: o.tenantId,
        amount: pl.received - pl.fee - pl.expense - worksTotal,
        detail: { received: pl.received, fee: pl.fee, expense: pl.expense, works: worksTotal, worksOrders: works },
        bank: { 'OW-01': '福岡〇〇銀行 博多支店 普通 ****123', 'OW-11': '福岡〇〇銀行 博多支店 普通 ****123', 'OW-21': '福岡〇〇銀行 博多支店 普通 ****123' }[o.id] || '△△信用金庫 香椎支店 普通 ****456',
      });
    }
  }
  return list;
}

// オーナーが自分で入れる情報（デモ用の初期値）。アカウントを作ったときに入る
// finance：取得価格・借入・固定資産税・保険（年額）。管理会社のシステムにはない、オーナー自身の情報
export const ownerDemo = {
  'OW-01': {
    finance: {
      'BL-01': { price: 145000000, acquired: '2016-04', loanBalance: 82000000, loanRate: 1.2, loanMonthly: 420000, propertyTax: 980000, insurance: 120000 },
      'BL-02': { price: 98000000, acquired: '2019-10', loanBalance: 71000000, loanRate: 0.9, loanMonthly: 310000, propertyTax: 620000, insurance: 80000 },
    },
    assets: [
      {
        source: 'self', company: '', name: '田中邸 貸家', address: '福岡市南区大橋2-0-0', structure: '木造', floors: 2, built: '1995-03',
        rooms: [{ no: '1F', layout: '2DK', rent: 75000, fee: 0, status: '入居中' }, { no: '2F', layout: '2DK', rent: 72000, fee: 0, status: '入居中' }],
        finance: { price: 18000000, acquired: '2010-06', loanBalance: 0, loanRate: 0, loanMonthly: 0, propertyTax: 140000, insurance: 45000 },
        ledger: [
          ['2026-09', 'income', '賃料', 147000], ['2026-09', 'expense', '草刈り', 8000],
          ['2026-10', 'income', '賃料', 147000], ['2026-10', 'expense', '給湯器修理', 22000],
          ['2026-11', 'income', '賃料', 147000],
        ],
      },
    ],
  },
};
