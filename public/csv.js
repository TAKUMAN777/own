// 管理会社の資料（CSV／Excel から書き出した CSV）を読む
// - 部屋一覧（レントロール）：部屋番号・間取り・賃料・共益費・状態
// - 収支（送金明細・入出金の一覧）：年月・項目・金額・区分（収入／支出）
// 入居者の氏名・電話などの列は読み込まない（取り込まなかった列として画面に出す）

// 文字コード：UTF-8 で読めなければ Shift_JIS（Excel の CSV に多い）
export function decode(buf) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, ''); } catch { /* 次へ */ }
  return new TextDecoder('shift_jis').decode(buf);
}

export function parseCSV(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  const s = text.includes('\t') && !text.includes(',') ? text.replace(/\t/g, ',') : text;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((x) => x.trim())).filter((r) => r.some((x) => x !== ''));
}

const PRIVATE = /氏名|名前|入居者|契約者|借主|賃借人|電話|TEL|携帯|メール|mail|生年|勤務先|保証人/i;
const num = (v) => { const n = Number(String(v ?? '').replace(/[,円¥\s]/g, '').replace(/^△|^▲/, '-').replace(/^\((.*)\)$/, '-$1')); return Number.isFinite(n) ? n : NaN; };

export function normMonth(v) {
  const m = String(v ?? '').trim().replace(/[年./／]/g, '-').replace(/月.*$/, '').match(/^(\d{4})-(\d{1,2})/);
  if (!m) return '';
  const mm = Number(m[2]);
  return mm >= 1 && mm <= 12 ? `${m[1]}-${String(mm).padStart(2, '0')}` : '';
}

const INCOME = /賃料|家賃|共益費|管理費収入|駐車場|礼金|更新料|敷金|入金|収入|返金/;

// 見出しの行を探して、どちらの資料かを決める
export function detect(rows) {
  for (let h = 0; h < Math.min(rows.length, 10); h++) {
    const head = rows[h];
    const find = (re, not) => head.findIndex((x) => re.test(x) && !(not && not.test(x)) && !PRIVATE.test(x));
    const ignored = head.filter((x) => PRIVATE.test(x));
    const body = rows.slice(h + 1);

    const room = find(/部屋|号室|室番|^room/i);
    const rent = find(/賃料|家賃/, /共益|管理費|合計/);
    if (room >= 0 && rent >= 0) {
      const fee = find(/共益費|管理費/);
      const status = find(/状況|状態|空室|入居/, /日|者/);
      const layout = find(/間取/);
      const errors = [];
      const items = body.map((r, i) => {
        const no = r[room] || '';
        const rv = num(r[rent]);
        if (!no) return null;
        if (Number.isNaN(rv)) { errors.push(`${h + i + 2}行目：賃料が数字ではありません`); return null; }
        const st = status >= 0 ? r[status] : '';
        return {
          no, layout: layout >= 0 ? r[layout] : '', rent: Math.max(0, rv), fee: fee >= 0 ? Math.max(0, num(r[fee]) || 0) : 0,
          status: /空|募集|退去済/.test(st) || (!st && rv === 0) ? '空室' : '入居中',
        };
      }).filter(Boolean);
      return { kind: 'rooms', items, ignored, errors };
    }

    const month = find(/年月|対象月|^月$|日付|計上/);
    const cat = find(/項目|科目|内容|摘要|費目/);
    const amount = find(/^金額|金額$|^額$/);
    const inCol = find(/^入金|収入/, /区分/);
    const outCol = find(/^出金|支出/, /区分/);
    const type = find(/区分|収支/);
    if (month >= 0 && cat >= 0 && (amount >= 0 || (inCol >= 0 && outCol >= 0))) {
      const roomCol = find(/部屋|号室/);
      const errors = [];
      const items = [];
      body.forEach((r, i) => {
        const line = h + i + 2;
        const m = normMonth(r[month]);
        const category = r[cat] || '';
        if (!m && !category) return;
        if (!m) { errors.push(`${line}行目：年月が読めません（${r[month] || '空欄'}）`); return; }
        let t, a;
        if (amount >= 0) {
          a = num(r[amount]);
          if (Number.isNaN(a)) { errors.push(`${line}行目：金額が数字ではありません`); return; }
          const tv = type >= 0 ? r[type] : '';
          t = /支出|出金|費用|経費/.test(tv) ? 'expense' : /収入|入金/.test(tv) ? 'income' : a < 0 ? 'expense' : INCOME.test(category) ? 'income' : 'expense';
          a = Math.abs(a);
        } else {
          const iv = num(r[inCol]), ov = num(r[outCol]);
          if (iv > 0) { t = 'income'; a = iv; } else if (ov > 0) { t = 'expense'; a = ov; } else return;
        }
        if (!a) return;
        items.push({ month: m, type: t, category: category.slice(0, 30), amount: Math.round(a), room: roomCol >= 0 ? r[roomCol] : '' });
      });
      return { kind: 'ledger', items, ignored, errors };
    }
  }
  return { kind: null, items: [], ignored: [], errors: ['部屋一覧（部屋番号・賃料の列）か、収支（年月・項目・金額の列）の見出しが見つかりません'] };
}

export const SAMPLES = {
  rooms: '部屋番号,間取り,賃料,共益費,入居状況,入居者名\n101,1K,58000,3000,入居中,（読み込みません）\n102,1K,58000,3000,空室,\n201,1LDK,72000,4000,入居中,（読み込みません）\n202,1LDK,72000,4000,入居中,（読み込みません）\n',
  ledger: '年月,項目,区分,金額\n2026/09,賃料,収入,190000\n2026/09,管理料,支出,9500\n2026/09,清掃,支出,6600\n2026/10,賃料,収入,190000\n2026/10,管理料,支出,9500\n2026/10,排水管清掃,支出,22000\n',
};
