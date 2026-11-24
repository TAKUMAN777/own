// オーナー自身が使うアプリ（フロント）
// - オーナーのアカウントに、複数の管理会社がつながる。データの正は各社の管理システム。
// - 金額は各社の計算結果をそのまま表示し、ここでは再計算しない（会社をまたぐ合計はサーバーで出す）。
// - 入居者の個人情報は扱わない（部屋番号まで）。
import { decode, parseCSV, detect, SAMPLES } from './csv.js';

const $app = document.getElementById('app');
const KEY = 'owner-app-session-v2';
let appInfo = null;
let me = null;

const store = {
  get() { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } },
  set(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* 保存できなくても動く */ } },
  clear() { try { localStorage.removeItem(KEY); } catch { /* noop */ } },
};
let session = store.get();

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const yen = (n) => `${Number(n).toLocaleString('ja-JP')}円`;
const ym = (m) => `${m.slice(0, 4)}年${Number(m.slice(5))}月`;
const md = (iso) => { const d = new Date(iso); return `${d.getMonth() + 1}月${d.getDate()}日`; };
const ymd = (s) => { const [y, m, d] = s.slice(0, 10).split('-'); return `${y}年${Number(m)}月${Number(d)}日`; };
const enc = encodeURIComponent;
const co = (x) => `<span class="co">${esc(x.company)}</span>`;

// 確認のダイアログ（画面の中に出す）。OK なら true
function ask(msg, ok = 'はい') {
  return new Promise((resolve) => {
    const d = document.createElement('div');
    d.className = 'ask';
    d.innerHTML = `<div class="ask-box" role="dialog" aria-modal="true"><p>${esc(msg)}</p><div class="ask-btns"><button type="button" class="btn sub" data-a="0">やめる</button><button type="button" class="btn" data-a="1">${esc(ok)}</button></div></div>`;
    const done = (v) => { d.remove(); resolve(v); };
    d.onclick = (e) => { if (e.target === d) done(false); const a = e.target.closest('[data-a]'); if (a) done(a.dataset.a === '1'); };
    document.body.appendChild(d);
    d.querySelector('[data-a="1"]').focus();
  });
}

function toast(msg) {
  if (msg === 'stale') return;
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600);
}

// 画面を移ったあとに、前の画面の読み込みが終わっても描かない（読み込みの番号で見分ける）
let navSeq = 0;

async function api(path, opts = {}) {
  const seq = navSeq;
  const res = await fetch(`/api/v1${path}`, {
    method: opts.method || 'GET',
    headers: { 'content-type': 'application/json', ...(session ? { authorization: `Bearer ${session.token}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && session && path !== '/auth/invite') { logout(true); throw new Error('ログインの有効期限が切れました'); }
  if (!res.ok) { const e = new Error(data.message || 'エラーが発生しました'); e.code = data.error; throw e; }
  if ((opts.method || 'GET') === 'GET' && seq !== navSeq) { const e = new Error('stale'); e.stale = true; throw e; }
  return data;
}

function logout(expired) {
  if (session && !expired) api('/auth/logout', { method: 'POST' }).catch(() => {});
  session = null; me = null; store.clear();
  setHeader();
  location.hash = '#/login';
  if (expired) toast('もう一度ログインしてください');
}

function setHeader() {
  document.getElementById('app-name').textContent = appInfo.name;
  document.getElementById('who').textContent = me ? `${me.name} 様` : 'オーナー様のためのアプリ';
}

const STATUS = {
  sent: ['ご回答待ち', 'warn'], approved: ['承認済み', 'ok'], conditional: ['条件付きで承認', 'ok'], returned: ['差戻し', 'ng'],
};
const DECISION = { approve: '承認', conditional: '条件付きで承認', return: '差戻し' };

// ---------- 画面 ----------

function codeForm(id, label) {
  return `<form id="${id}" class="card">
      <label for="${id}-code">招待コード</label>
      <input id="${id}-code" type="text" autocomplete="one-time-code" autocapitalize="characters" placeholder="例：HKT-0001" required>
      <div class="err" id="${id}-err"></div>
      <button class="btn">${label}</button>
    </form>`;
}

function viewLogin() {
  $app.innerHTML = `
    <div class="hello">ようこそ</div>
    <p>建物ごと・管理会社ごと・自主管理の資産を、過去・いま・未来でまとめて見られるアプリです。</p>
    <button type="button" class="btn hero" id="demo">▶ デモを見る（田中様の例）</button>
    <form id="st" class="card">
      <h3>自分の物件で始める</h3>
      <p class="small muted">招待コードはいりません。自主管理の物件や、管理会社の資料（CSV）から資産を作れます。管理会社とはあとからつなげられます。</p>
      <label for="st-name">お名前</label>
      <input id="st-name" type="text" autocomplete="name" placeholder="例：田中 靖夫" required>
      <div class="err" id="st-err"></div>
      <button class="btn">はじめる</button>
    </form>
    <details class="card">
      <summary><b>招待コードをお持ちの方</b></summary>
      <p class="small muted">管理会社から届いたコードで、その会社のご提案・送金・報告書・工事の様子が届きます。</p>
      ${codeForm('f', 'コードで始める').replace('class="card"', '')}
      <p class="small muted">デモ用：HKT-0001（田中様）／HKT-0002（山本様）</p>
    </details>`;
  const enter = async (path, body, errId, btn) => {
    if (btn) btn.disabled = true;
    try {
      const r = await api(path, { method: 'POST', body });
      session = r; store.set(r);
      location.hash = '#/home';
    } catch (err) {
      if (errId) document.getElementById(errId).textContent = err.message; else toast(err.message);
    } finally { if (btn) btn.disabled = false; }
  };
  document.getElementById('demo').onclick = (e) => enter('/auth/demo', {}, null, e.currentTarget);
  document.getElementById('st').onsubmit = (e) => { e.preventDefault(); enter('/auth/start', { name: document.getElementById('st-name').value }, 'st-err', e.target.querySelector('button')); };
  document.getElementById('f').onsubmit = (e) => { e.preventDefault(); enter('/auth/invite', { code: document.getElementById('f-code').value }, 'f-err', e.target.querySelector('button')); };
}

async function viewHome() {
  const [pending, months, rems, works, assets] = await Promise.all([
    api('/proposals?status=sent'), api('/months'), api('/remittances'), api('/works'), api('/assets'),
  ]);
  const as = assets.summary;
  const last = months.closed[months.closed.length - 1];
  const pl = await api(`/pl?month=${last}`);
  const monthRems = rems.filter((r) => r.month === last);
  const active = works.filter((w) => w.status !== '支払済');
  const chip = (href, ic, label, n, unit = '') => `<a class="chip" href="${href}"><span class="ic">${ic}</span>${label}<b>${n}</b>${unit ? `<small>${unit}</small>` : ''}</a>`;
  if (!as.count && !me.links.length) {
    const opt = (href, ic, t, sub) => `<a class="menu-item" href="${href}"><span class="ic">${ic}</span><span><b>${t}</b><small>${sub}</small></span><span class="go">›</span></a>`;
    $app.innerHTML = `
      <div class="hello">${esc(me.name)} 様、はじめましょう</div>
      <p class="small">まず、資産（建物）をひとつ登録します。管理のしかたに合わせて選んでください。</p>
      <div class="menu">
        ${opt('#/assets/new/self', '✍️', '自主管理で入力する', '物件・部屋・毎月の収入と支出を自分で入力')}
        ${opt('#/assets/new/import', '📄', '管理会社の資料から作る', '送金明細・部屋一覧のCSVを読み込む（見本でも試せます）')}
        ${opt('#/menu/companies', '🔗', '管理会社とつなぐ', `招待コードで、${esc(appInfo.systems.join('・'))}から自動で届く`)}
      </div>`;
    return;
  }
  $app.innerHTML = `
    <div class="chips">
      ${chip('#/assets', '🏢', '資産', as.count, '件')}
      ${chip('#/assets', '🏠', '入居', `${as.occupied}/${as.units}`)}
      ${chip('#/proposals', '🤝', '回答待ち', pending.length)}
      ${chip('#/works', '🏗️', '工事中', active.length)}
      ${chip('#/menu/companies', '🔗', '管理会社', me.links.length, '社')}
    </div>
    ${pending.length
      ? `<a class="btn hero" href="#/proposals/${enc(pending[0].tenantId)}/${enc(pending[0].id)}">▶ ご提案に回答する（${pending.length}件）</a>`
      : me.links.length ? `<a class="btn hero" href="#/reports">📄 ${Number(last.slice(5))}月の月次報告書を見る</a>` : '<a class="btn hero" href="#/assets">🏢 資産を見る</a>'}
    ${pending.map((p) => `<a class="card attn" href="#/proposals/${enc(p.tenantId)}/${enc(p.id)}">
        <div class="row"><strong>${esc(p.title)}</strong><span class="pill warn">ご回答待ち</span></div>
        <div class="small muted">${co(p)} ${esc(md(p.sentAt))}・${p.quotes.length}案からお選びください</div></a>`).join('')}
    ${me.links.length ? `    <a class="card" href="#/money/${esc(last)}">
      <div class="row"><span>💴 ${esc(ym(last))}分 ご送金の合計</span>${monthRems.length ? `<span class="pill ok">${monthRems.length}社 送金済</span>` : ''}</div>
      <div class="big num">${monthRems.length ? yen(monthRems.reduce((s, r) => s + r.amount, 0)) : '—'}</div>
      ${monthRems.map((r) => `<div class="row small"><span>${co(r)}</span><span class="num">${yen(r.amount)}（${esc(md(r.date))}）</span></div>`).join('')}
    </a>` : ''}
    <a class="card" href="#/assets">
      <div class="row"><strong>🏢 資産</strong><span class="small muted">${as.count}件</span></div>
      <div class="kpis">
        <div class="kpi"><div class="kk">取得額の合計</div><div class="kv2">${man(as.price)}</div></div>
        <div class="kpi"><div class="kk">借入残高</div><div class="kv2">${man(as.loanBalance)}</div></div>
        <div class="kpi"><div class="kk">表面利回り</div><div class="kv2">${pct(as.grossYield)}</div></div>
      </div>
    </a>
    <a class="card" href="#/works">
      <div class="row"><strong>🏗️ 進行中の工事</strong><span class="pill info">${active.length}件</span></div>
      ${active.map((w) => `<div class="small">${esc(w.title)}：${esc(w.status)}　${co(w)}</div>`).join('') || '<div class="small muted">ありません</div>'}
    </a>`;
}

async function viewProposals() {
  const list = await api('/proposals');
  const pending = list.filter((p) => p.status === 'sent');
  const done = list.filter((p) => p.status !== 'sent');
  const item = (p) => {
    const [label, cls] = STATUS[p.status] || [p.status, ''];
    return `<a class="card" href="#/proposals/${enc(p.tenantId)}/${enc(p.id)}">
      <div class="row"><strong>${esc(p.title)}</strong><span class="pill ${cls}">${esc(label)}</span></div>
      <div class="small muted">${co(p)} ${esc(md(p.sentAt))}・${p.quotes.length}案</div></a>`;
  };
  $app.innerHTML = `
    <h1>🤝 ご提案</h1>
    <h2>ご回答待ち</h2>${pending.map(item).join('') || '<p class="muted">ありません</p>'}
    <h2>これまでのご回答</h2>${done.map(item).join('') || '<p class="muted">ありません</p>'}`;
}

async function viewProposal(tenantId, id) {
  const base = `/companies/${enc(tenantId)}/proposals/${enc(id)}`;
  const p = await api(base);
  const letters = 'ABCDEFG';
  const open = p.status === 'sent';
  const quoteCard = (q, i) => `
    <div class="card">
      <div class="row"><strong>${letters[i]}案　${esc(q.contractor)}</strong>${q.id === p.recommendedId ? '<span class="pill">おすすめ</span>' : ''}</div>
      <div class="big num">${yen(q.total)}<span class="small muted">（税込）</span></div>
      <div class="small">保証 ${esc(q.warranty)}／工期 ${q.days}日</div>
      <table class="small">${q.items.map((it) => `<tr><td>${esc(it.name)}</td><td class="r num">${yen(it.amount)}</td></tr>`).join('')}</table>
      ${q.note ? `<div class="small muted">${esc(q.note)}</div>` : ''}
    </div>`;
  const answered = p.response ? `
    <div class="card">
      <div class="row"><strong>ご回答</strong><span class="pill ${(STATUS[p.status] || [])[1] || ''}">${esc(DECISION[p.response.decision])}</span></div>
      ${p.response.quoteId ? `<div>選ばれた案：${letters[p.quoteIds.indexOf(p.response.quoteId)]}案（${esc(p.quotes.find((q) => q.id === p.response.quoteId)?.contractor)}）</div>` : ''}
      ${p.response.comment ? `<div>コメント：${esc(p.response.comment)}</div>` : ''}
      <div class="small muted">${esc(md(p.response.at))}にご回答</div>
    </div>` : '';
  $app.innerHTML = `
    <p class="no-print"><a href="#/proposals">← ご提案一覧</a></p>
    <h1>${esc(p.title)}</h1>
    <div class="small muted">${co(p)} ${esc(p.buildingName)}／${esc(md(p.sentAt))}に届きました</div>
    <h2>ご提案の理由</h2>
    <div class="card">${esc(p.reason)}${p.notes ? `<div class="small muted" style="margin-top:6px">${esc(p.notes)}</div>` : ''}</div>
    ${answered}
    ${open ? `
      <form id="f">
        <h2>案をお選びください</h2>
        ${p.quotes.map((q, i) => `<label class="opt"><input type="radio" name="q" value="${esc(q.id)}" ${q.id === p.recommendedId ? 'checked' : ''}>${quoteCard(q, i)}</label>`).join('')}
        <h2>ご回答</h2>
        <div class="seg" role="radiogroup" id="dec">
          <button type="button" data-d="approve" class="on" aria-pressed="true">承認</button>
          <button type="button" data-d="conditional" aria-pressed="false">条件付きで承認</button>
          <button type="button" data-d="return" aria-pressed="false">差戻し</button>
        </div>
        <label for="c" id="clabel">コメント（任意）</label>
        <textarea id="c" maxlength="500" placeholder=""></textarea>
        <div class="err" id="err"></div>
        <button class="btn" id="go">この案で承認する</button>
        <p class="small muted">ご回答は記録として${esc(p.company)}に届きます。発注などの手続きは、管理会社の担当者が確認のうえ行います。</p>
      </form>` : `<h2>見積の内容</h2>${p.quotes.map(quoteCard).join('')}`}`;
  if (!open) return;

  let decision = 'approve';
  const c = document.getElementById('c');
  const setDecision = (d) => {
    decision = d;
    document.querySelectorAll('#dec button').forEach((b) => { b.classList.toggle('on', b.dataset.d === d); b.setAttribute('aria-pressed', String(b.dataset.d === d)); });
    document.querySelectorAll('input[name=q]').forEach((r) => { r.disabled = d === 'return'; });
    document.getElementById('clabel').textContent = { approve: 'コメント（任意）', conditional: '条件（必須・3文字以上）', return: '差戻しの理由（必須・3文字以上）' }[d];
    c.placeholder = { approve: '', conditional: '例：入居者さまへの事前のご案内をお願いします', return: '例：もう1社見積を取ってください' }[d];
    document.getElementById('go').textContent = { approve: 'この案で承認する', conditional: '条件付きで承認する', return: '差戻す' }[d];
    document.getElementById('go').className = d === 'return' ? 'btn danger' : 'btn';
  };
  document.querySelectorAll('#dec button').forEach((b) => { b.onclick = () => setDecision(b.dataset.d); });
  document.getElementById('f').onsubmit = async (e) => {
    e.preventDefault();
    const err = document.getElementById('err');
    const quoteId = document.querySelector('input[name=q]:checked')?.value;
    const comment = c.value.trim();
    if (decision !== 'return' && !quoteId) { err.textContent = '案を選んでください'; return; }
    if (decision !== 'approve' && comment.length < 3) { err.textContent = decision === 'return' ? '差戻しの理由を3文字以上で入力してください' : '条件を3文字以上で入力してください'; return; }
    const q = p.quotes.find((x) => x.id === quoteId);
    const msg = decision === 'return' ? `${p.company}へ、このご提案を差戻します。よろしいですか？`
      : `${letters[p.quoteIds.indexOf(quoteId)]}案（${q.contractor}・${yen(q.total)}）を${DECISION[decision]}します。よろしいですか？`;
    if (!(await ask(msg))) return;
    const btn = document.getElementById('go');
    btn.disabled = true; err.textContent = '';
    try {
      await api(`${base}/respond`, { method: 'POST', body: { decision, quoteId: decision === 'return' ? undefined : quoteId, comment } });
      toast('ご回答を受け付けました');
      refreshBadge();
      await viewProposal(tenantId, id);
    } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
  };
}

function plRows(x) {
  return `
    <tr><td>請求額</td><td class="r num">${yen(x.billed)}</td></tr>
    <tr><td>入金額</td><td class="r num">${yen(x.received)}</td></tr>
    ${x.unpaid ? `<tr><td>未入金</td><td class="r num neg">${yen(x.unpaid)}</td></tr>` : ''}
    <tr><td>管理料</td><td class="r num">−${yen(x.fee)}</td></tr>
    <tr><td>費用${x.expenses && x.expenses.length ? `<div class="muted">${x.expenses.map((e) => `${esc(e.kind)} ${yen(e.amount)}`).join('／')}</div>` : ''}</td><td class="r num">−${yen(x.expense)}</td></tr>
    <tr class="total"><td>差引</td><td class="r num">${yen(x.remit)}</td></tr>`;
}

async function viewMoney(month) {
  const [months, rems] = await Promise.all([api('/months'), api('/remittances')]);
  const m = months.closed.includes(month) ? month : months.closed[months.closed.length - 1];
  const pl = await api(`/pl?month=${m}`);
  const monthRems = rems.filter((r) => r.month === m);
  $app.innerHTML = `
    <h1>💴 収支・送金</h1>
    <div class="seg">${months.months.map((x) => months.closed.includes(x)
      ? `<a href="#/money/${x}" class="${x === m ? 'on' : ''}">${Number(x.slice(5))}月</a>`
      : `<button disabled title="月締め前">${Number(x.slice(5))}月（締め前）</button>`).join('')}</div>
    <div class="card">
      <div class="row"><span>${esc(ym(m))}分 ご送金の合計</span><span class="small muted">${monthRems.length}社</span></div>
      <div class="big num">${yen(monthRems.reduce((s, r) => s + r.amount, 0))}</div>
      ${pl.total ? `<div class="small muted">入居 ${pl.total.occupied}／${pl.total.units}室　入金 ${yen(pl.total.received)}</div>` : ''}
    </div>
    ${pl.companies.map(({ tenantId, company, pl: cpl }) => {
      const r = monthRems.find((x) => x.tenantId === tenantId);
      return `<h2>🔗 ${esc(company)}</h2>
      ${r ? `<div class="card">
        <div class="row"><span>ご送金額</span><span class="pill ok">${esc(r.status)}</span></div>
        <div class="big num">${yen(r.amount)}</div>
        <table class="small">
          <tr><td>入金額（賃料・共益費）</td><td class="r num">${yen(r.detail.received)}</td></tr>
          <tr><td>管理料</td><td class="r num">−${yen(r.detail.fee)}</td></tr>
          <tr><td>費用（清掃・点検など）</td><td class="r num">−${yen(r.detail.expense)}</td></tr>
          ${r.detail.works ? `<tr><td>工事代金<div class="muted">${r.detail.worksOrders.map((w) => `${esc(w.title)} ${yen(w.amount)}`).join('<br>')}</div></td><td class="r num">−${yen(r.detail.works)}</td></tr>` : ''}
          <tr class="total"><td>ご送金額</td><td class="r num">${yen(r.amount)}</td></tr>
        </table>
        <div class="small muted">送金日 ${esc(ymd(r.date))}／${esc(r.bank)}</div>
      </div>` : '<div class="card muted">この月の送金はまだありません</div>'}
      ${cpl ? cpl.buildings.map((b) => `<div class="card">
        <div class="row"><strong>${esc(b.name)}</strong><span class="small">入居 ${b.occupied}／${b.units}室</span></div>
        <table class="small">${plRows(b)}</table></div>`).join('') : '<div class="card muted">この月はまだ締めていません</div>'}
      <a class="btn sub" href="#/reports/${enc(tenantId)}/${esc(m)}">📄 ${Number(m.slice(5))}月の月次報告書</a>`;
    }).join('')}
    ${pl.own.length ? `<h2>✍️ 自主管理・資料から作った資産</h2>${pl.own.map((o) => `<a class="card" href="#/assets/${enc(o.assetId)}">
      <div class="row"><strong>${esc(o.name)}</strong>${o.source === 'import' ? `<span class="small muted">📄 ${esc(o.company || '資料')}</span>` : '<span class="small muted">✍️ 自主管理</span>'}</div>
      <table class="small">
        ${o.entries.map((e) => `<tr><td>${esc(e.category)}</td><td class="r num ${e.type === 'expense' ? 'neg' : ''}">${e.type === 'expense' ? '−' : ''}${yen(e.amount)}</td></tr>`).join('')}
        <tr class="total"><td>差引</td><td class="r num">${yen(o.net)}</td></tr>
      </table></a>`).join('')}` : ''}
    <p class="small muted">管理会社の分は、月締めが終わった月の数字を各社の計算どおりに表示しています。自主管理・資料の分は、ご自身の記録です。</p>`;
}

async function viewReports() {
  const list = await api('/reports');
  const byMonth = {};
  for (const r of list) (byMonth[r.month] ||= []).push(r);
  $app.innerHTML = `<h1>📄 月次報告書</h1>${Object.entries(byMonth).map(([m, rs]) => `<h2>${esc(ym(m))}</h2>${rs.map((r) => `
    <a class="card" href="#/reports/${enc(r.tenantId)}/${esc(r.month)}">
      <div class="row"><strong>${esc(r.company)}</strong><span class="small muted">${esc(ymd(r.publishedAt))}</span></div></a>`).join('')}`).join('') || '<p class="muted">まだありません</p>'}`;
}

async function viewReport(tenantId, month) {
  const r = await api(`/companies/${enc(tenantId)}/reports/${enc(month)}`);
  const pl = r.pl;
  $app.innerHTML = `
    <p class="no-print"><a href="#/reports">← 報告書一覧</a></p>
    <div class="doc-head">${esc(r.company)} からのご報告</div>
    <h1>${esc(ym(month))} 月次報告書</h1>
    <p>${esc(r.owner.name)} 様</p>
    <div class="card">
      <table>
        <tr><td>入居</td><td class="r num">${pl.occupied}／${pl.units}室</td></tr>
        <tr><td>請求額</td><td class="r num">${yen(pl.billed)}</td></tr>
        <tr><td>入金額</td><td class="r num">${yen(pl.received)}</td></tr>
        <tr><td>未入金</td><td class="r num">${yen(pl.unpaid)}</td></tr>
        <tr><td>管理料</td><td class="r num">−${yen(pl.fee)}</td></tr>
        <tr><td>費用</td><td class="r num">−${yen(pl.expense)}</td></tr>
        <tr class="total"><td>差引（工事代金の差引前）</td><td class="r num">${yen(pl.remit)}</td></tr>
        ${r.remittance ? `<tr><td>ご送金額（${esc(ymd(r.remittance.date))}）</td><td class="r num">${yen(r.remittance.amount)}</td></tr>` : ''}
      </table>
    </div>
    <h2>今月のご報告</h2>
    <div class="card">${r.notes.length ? `<ul class="plain">${r.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : '<span class="muted">特記事項はありません</span>'}</div>
    ${r.works.length ? `<h2>工事</h2><div class="card">${r.works.map((w) => `<div class="row"><span>${esc(w.title)}</span><span class="pill info">${esc(w.status)}</span></div>`).join('')}</div>` : ''}
    <h2>お部屋の状況</h2>
    ${pl.buildings.map((b) => `<div class="card"><strong>${esc(b.name)}</strong>
      <div class="rooms" style="margin-top:6px">${b.rooms.map((x) => `<span class="${esc(x.status)}">${esc(x.no)} ${esc(x.status)}</span>`).join('')}</div></div>`).join('')}
    <button class="btn sub no-print" onclick="window.print()">印刷・PDFで保存</button>`;
}

async function viewWorks() {
  const list = await api('/works');
  const t = enc(session.token);
  $app.innerHTML = `<h1>🏗️ 工事</h1>${list.map((w) => {
    const idx = w.steps.indexOf(w.status);
    return `<div class="card">
      <div class="row"><strong>${esc(w.title)}</strong><span class="pill ${w.status === '支払済' ? 'ok' : 'info'}">${esc(w.status)}</span></div>
      <div class="small muted">${co(w)} ${esc(w.buildingName)}／${esc(w.contractor)}／${yen(w.amount)}</div>
      <ol class="steps">${w.steps.map((s, i) => `<li class="${i <= idx ? 'done' : ''} ${i === idx ? 'cur' : ''}">${esc(s)}</li>`).join('')}</ol>
      ${w.report ? `<p class="small">${esc(w.report)}</p>` : ''}
      ${w.photos.length ? `<div class="photos">${w.photos.map((ph) => `<figure><a href="/photos/${esc(ph.id)}.svg?t=${t}" target="_blank" rel="noopener"><img src="/photos/${esc(ph.id)}.svg?t=${t}" alt="${esc(ph.caption)}" loading="lazy"></a><figcaption>${esc(ph.caption)}</figcaption></figure>`).join('')}</div>` : ''}
      <details class="small"><summary>経過</summary>${w.history.map((h) => `<div>${esc(ymd(h.at))}　${esc(h.status)}</div>`).join('')}</details>
    </div>`;
  }).join('') || '<p class="muted">工事はありません</p>'}`;
}

async function viewNotices() {
  const notes = await api('/notifications');
  try { localStorage.setItem(KEY + ':seen', new Date().toISOString()); } catch { /* noop */ }
  document.getElementById('bellDot').hidden = true;
  $app.innerHTML = `<h1>🔔 お知らせ</h1>${notes.map((n) => `<${n.link ? `a href="${esc(n.link)}"` : 'div'} class="card small"><div class="muted">${esc(md(n.at))}　${co(n)}</div>${esc(n.title)}</${n.link ? 'a' : 'div'}>`).join('') || '<div class="card muted">新しいお知らせはありません</div>'}`;
}

function viewMenu(arg) {
  const back = '<p><a href="#/menu">← メニュー</a></p>';
  if (arg === 'buildings') {
    $app.innerHTML = `${back}<h1>📑 管理委託契約</h1>
      ${me.links.map((l) => `<h2>🔗 ${esc(l.company)}</h2>
        ${l.buildings.map((b) => `<div class="card"><strong>${esc(b.name)}</strong><div class="small muted">${esc(b.address)}<br>${esc(b.structure)}造 ${b.floors}階建／${b.units}室／${esc(b.built.slice(0, 4))}年${Number(b.built.slice(5))}月築</div></div>`).join('')}
        ${l.mgmt.map((m) => `<div class="card small">管理委託契約：管理料 入金額の${(m.rate * 100).toFixed(1)}%／毎月${m.remitDay}日送金<br>契約期間 ${esc(ymd(m.start))}〜${esc(ymd(m.end))}</div>`).join('')}`).join('')}`;
    return;
  }
  if (arg === 'companies') {
    $app.innerHTML = `${back}<h1>🔗 管理会社</h1>
      <p class="small muted">物件の管理を任せている会社です。各社からのご提案・送金・報告書がこのアプリに届きます。</p>
      <div class="menu">${me.links.map((l) => `<a class="menu-item" href="tel:${esc(l.tel)}"><span class="ic">🏢</span><span><b>${esc(l.company)}</b><small>🔗 ${esc(l.system)}と連携／物件 ${l.buildings.length}棟／📞 ${esc(l.tel)}</small></span><span class="go">›</span></a>`).join('')}</div>
      <h2>＋ 管理会社を追加</h2>
      <p class="small">追加したい管理会社から届いた招待コードを入力してください。</p>
      ${codeForm('lk', 'つなげる')}`;
    document.getElementById('lk').onsubmit = async (e) => {
      e.preventDefault();
      try {
        me = await api('/links', { method: 'POST', body: { code: document.getElementById('lk-code').value } });
        toast('管理会社とつながりました');
        viewMenu('companies');
      } catch (err) { document.getElementById('lk-err').textContent = err.message; }
    };
    return;
  }
  const item = (href, ic, t, sub) => `<a class="menu-item" href="${href}"><span class="ic">${ic}</span><span><b>${t}</b><small>${sub}</small></span><span class="go">›</span></a>`;
  $app.innerHTML = `
    <h1>☰ メニュー</h1>
    <div class="menu">
      ${item('#/assets', '🏢', '資産', '建物・部屋・利回り・借入。資料や自主管理からも作れます')}
      ${item('#/works', '🏗️', '工事', '工事の進み具合と完了の写真')}
      ${item('#/reports', '📄', '月次報告書', '各管理会社からの毎月のご報告・PDFで保存')}
      ${item('#/notices', '🔔', 'お知らせ', 'ご提案・送金・報告書のお知らせ')}
      ${item('#/menu/buildings', '📑', '管理委託契約', '管理会社ごとの物件と契約')}
      ${item('#/menu/companies', '🔗', '管理会社', `つながっている会社 ${me.links.length}社・追加・お問い合わせ`)}
    </div>
    <button class="btn sub" id="out">ログアウト</button>
    <p class="small muted">${esc(me.name)} 様でログイン中</p>`;
  document.getElementById('out').onclick = () => logout(false);
}

// ---------- 資産（建物） ----------

const pct = (x) => (x == null ? '—' : `${(x * 100).toFixed(2)}%`);
const man = (n) => (n ? `${(n / 10000).toLocaleString('ja-JP', { maximumFractionDigits: 0 })}万円` : '—');
const srcBadge = (x) => (x.source === 'link' ? `<span class="src link">🔗 ${esc(x.system)}と連携</span>`
  : x.source === 'import' ? `<span class="src import">📄 ${esc(x.company || '管理会社')}の資料から</span>`
    : '<span class="src self">✍️ 自主管理</span>');

// タイムライン（過去・現在・未来）の表示
function tlHTML(events, { showAsset = false, roomLinks = true } = {}) {
  if (!events.length) return '<div class="card muted">ありません</div>';
  const byYear = {};
  for (const e of events) (byYear[e.at.slice(0, 4)] ||= []).push(e);
  return Object.entries(byYear).map(([y, es]) => `
    <div class="tl-year">${y}年</div>
    <ol class="tl">${es.map((e) => `<li class="tl-${e.when}${e.kind === 'now' ? ' tl-nowmark' : ''}">
      <span class="tl-dot">${e.icon}</span>
      <div class="tl-body">
        <div class="row"><span><span class="tl-m">${Number(e.at.slice(5))}月</span> <b>${esc(e.title)}</b></span>${e.amount != null ? `<span class="num ${e.amount < 0 ? 'neg' : ''}">${e.amount < 0 ? '−' : ''}${yen(Math.abs(e.amount))}</span>` : ''}</div>
        ${e.detail ? `<div class="small muted">${esc(e.detail)}</div>` : ''}
        ${showAsset && e.assetId ? `<a class="small" href="#/assets/${enc(e.assetId)}">${esc(e.assetName)}</a>` : ''}
        ${!showAsset && roomLinks && e.room ? `<a class="small" href="#/assets/${enc(e.assetId)}/rooms/${enc(e.room)}">${esc(e.room)}号室 ›</a>` : ''}
      </div></li>`).join('')}</ol>`).join('');
}

const TL_FILTERS = [
  ['all', 'すべて', null], ['money', '💴 お金', ['money', 'acquire', 'loan']], ['work', '🔧 工事・修繕', ['work', 'repair', 'proposal']],
  ['room', '🏠 部屋', ['room']], ['building', '🏢 建物・契約', ['build', 'life', 'contract', 'acquire', 'loan']],
];
const ASSET_VIEWS = [['', '建物ごと'], ['by-company', '管理会社ごと'], ['by-type', '管理方法'], ['timeline', 'タイムライン']];
const assetCard = (x) => `<a class="card" href="#/assets/${enc(x.id)}">
  <div class="row"><strong>${esc(x.name)}</strong><span class="small num">${x.kpi.occupied}/${x.kpi.units}室</span></div>
  <div>${srcBadge(x)}</div>
  <div class="small muted">${esc(x.address)}</div>
  <div class="row small"><span>資産価値 <b>${man(x.value.value)}</b>${x.value.method === 'appraisal' ? '（査定）' : ''}</span><span>表面 ${pct(x.kpi.grossYield)}</span></div>
</a>`;
const companyOf = (x) => (x.source === 'link' ? x.company : x.source === 'import' ? (x.company || '管理会社（資料）') : '自主管理');

async function viewAssets(view = '') {
  const { summary: s, list } = await api('/assets');
  const seg = `<div class="seg seg4">${ASSET_VIEWS.map(([k, t]) => `<a href="#/assets${k ? `/${k}` : ''}" class="${k === view ? 'on' : ''}">${t}</a>`).join('')}</div>`;
  const group = (keyOf, labelOf) => {
    const g = new Map();
    for (const x of list) { const k = keyOf(x); if (!g.has(k)) g.set(k, []); g.get(k).push(x); }
    return [...g.entries()].map(([k, xs]) => {
      const sum = (f) => xs.reduce((t, x) => t + f(x), 0);
      return `<h2>${labelOf(k, xs)}</h2>
        <div class="card sub-total"><div class="kpis">
          <div class="kpi"><div class="kk">建物</div><div class="kv2">${xs.length}<small>件</small></div></div>
          <div class="kpi"><div class="kk">資産価値</div><div class="kv2">${man(sum((x) => x.value.value))}</div></div>
          <div class="kpi"><div class="kk">入居</div><div class="kv2">${sum((x) => x.kpi.occupied)}/${sum((x) => x.kpi.units)}</div></div>
          <div class="kpi"><div class="kk">いまの年間賃料</div><div class="kv2">${man(sum((x) => x.kpi.curYear))}</div></div>
        </div></div>
        ${xs.map(assetCard).join('')}`;
    }).join('');
  };
  let body;
  let afterRender = () => {};
  if (view === 'timeline') {
    const t = await api('/timeline');
    const past = t.events.filter((e) => e.when === 'past' && e.at >= `${Number(t.now.slice(0, 4)) - 1}-01`);
    const future = t.events.filter((e) => e.when !== 'past');
    body = `
      <p class="small muted">すべての建物の出来事を、時間の順に並べています。過去は去年から、未来は10年先まで。</p>
      <div class="chipf" id="tlf">${TL_FILTERS.map(([k, t], i) => `<button type="button" data-k="${k}" class="${i ? '' : 'on'}">${t}</button>`).join('')}</div>
      <div id="tlbody"></div>`;
    afterRender = () => {
      const draw = (k) => {
        const kinds = TL_FILTERS.find((f) => f[0] === k)[2];
        const pick = (es) => es.filter((e) => e.kind === 'now' || !kinds || kinds.includes(e.kind));
        document.getElementById('tlbody').innerHTML = `<h2>⏪ 過去</h2>${tlHTML(pick(past), { showAsset: true })}${tlHTML(pick(future), { showAsset: true })}`;
      };
      document.querySelectorAll('#tlf button').forEach((b) => {
        b.onclick = () => { document.querySelectorAll('#tlf button').forEach((c) => c.classList.toggle('on', c === b)); draw(b.dataset.k); };
      });
      draw('all');
    };
  } else if (view === 'by-company') {
    body = group(companyOf, (k, xs) => `${xs[0].source === 'self' ? '✍️' : xs[0].source === 'import' ? '📄' : '🔗'} ${esc(k)}${xs[0].source === 'link' ? ` <span class="muted small">${esc(xs[0].system)}</span>` : ''}`);
  } else if (view === 'by-type') {
    body = group((x) => (x.source === 'self' ? 'self' : 'company'), (k) => (k === 'self' ? '✍️ 自主管理' : '🏢 管理会社に委託'));
  } else {
    body = list.map(assetCard).join('');
  }
  $app.innerHTML = `
    <h1>🏢 資産</h1>
    <div class="card">
      <div class="kpis">
        <div class="kpi hl"><div class="kk">資産価値（推定）</div><div class="kv2">${man(s.value)}</div></div>
        <div class="kpi hl"><div class="kk">純資産（価値−借入）</div><div class="kv2">${man(s.equity)}</div></div>
        <div class="kpi"><div class="kk">借入残高</div><div class="kv2">${man(s.loanBalance)}</div></div>
        <div class="kpi"><div class="kk">取得額の合計</div><div class="kv2">${man(s.price)}</div></div>
        <div class="kpi"><div class="kk">入居</div><div class="kv2">${s.occupied}/${s.units}<small> ${Math.round(s.occRate * 100)}%</small></div></div>
        <div class="kpi"><div class="kk">表面利回り</div><div class="kv2">${pct(s.grossYield)}</div></div>
      </div>
      <div class="small muted">資産価値は、査定額が入っていればその額、なければ「いまの年間の手取り（賃料−運営費）÷ 想定の利回り」の目安です。</div>
    </div>
    ${seg}
    ${view === 'timeline' ? '' : '<a class="btn hero" href="#/assets/new">＋ 資産を追加する</a>'}
    ${body}`;
  afterRender();
}

function viewAssetNew() {
  const opt = (href, ic, t, sub) => `<a class="menu-item" href="${href}"><span class="ic">${ic}</span><span><b>${t}</b><small>${sub}</small></span><span class="go">›</span></a>`;
  $app.innerHTML = `
    <p><a href="#/assets">← 資産</a></p>
    <h1>＋ 資産を追加</h1>
    <p class="small">物件の管理のしかたに合わせて選んでください。</p>
    <div class="menu">
      ${opt('#/menu/companies', '🔗', '管理システムと連携する', `管理会社が${esc(appInfo.systems.join('・'))}を使っている場合。招待コードを入れると、物件・部屋・収支が自動で届きます`)}
      ${opt('#/assets/new/import', '📄', '管理会社の資料から作る', '送金明細・部屋一覧（レントロール）のCSVを読み込みます')}
      ${opt('#/assets/new/self', '✍️', '自主管理で入力する', '物件・部屋・毎月の収入と支出を自分で入力します')}
    </div>`;
}

function roomsEditor(rooms) {
  const row = (r = {}) => `<tr>
    <td><input type="text" name="no" value="${esc(r.no || '')}" placeholder="101"></td>
    <td><input type="text" name="layout" value="${esc(r.layout || '')}" placeholder="1K"></td>
    <td><input type="text" name="rent" inputmode="numeric" value="${r.rent ?? ''}" placeholder="58000"></td>
    <td><input type="text" name="fee" inputmode="numeric" value="${r.fee ?? ''}" placeholder="3000"></td>
    <td><select name="status" aria-label="状態"><option value="入居中" ${r.status !== '空室' ? 'selected' : ''}>入居</option><option value="空室" ${r.status === '空室' ? 'selected' : ''}>空室</option></select></td>
    <td><button type="button" class="x" aria-label="この部屋を削除">×</button></td></tr>`;
  return {
    html: `<div class="tablewrap"><table class="grid rooms-ed"><thead><tr><th>部屋</th><th>間取り</th><th>賃料</th><th>共益費</th><th>状態</th><th></th></tr></thead>
      <tbody>${(rooms.length ? rooms : [{}]).map(row).join('')}</tbody></table></div>
      <button type="button" class="btn sub small" id="addRoom">＋ 部屋を追加</button>`,
    bind() {
      const tb = document.querySelector('.rooms-ed tbody');
      document.getElementById('addRoom').onclick = () => tb.insertAdjacentHTML('beforeend', row());
      tb.onclick = (e) => { if (e.target.classList.contains('x')) e.target.closest('tr').remove(); };
    },
    read() {
      return [...document.querySelectorAll('.rooms-ed tbody tr')].map((tr) => {
        const v = (n) => tr.querySelector(`[name=${n}]`).value.trim();
        return { no: v('no'), layout: v('layout'), rent: v('rent'), fee: v('fee'), status: v('status') };
      }).filter((r) => r.no);
    },
  };
}

function basicFields(x = {}) {
  return `
    <label>物件名（必須）<input type="text" id="a-name" value="${esc(x.name || '')}" placeholder="例：メゾン大橋"></label>
    <label>所在地<input type="text" id="a-address" value="${esc(x.address || '')}"></label>
    <div class="row3">
      <label>構造<select id="a-structure">${['', 'RC', 'SRC', 'S', '木造', '軽量鉄骨'].map((v) => `<option ${x.structure === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label>階数<input type="text" id="a-floors" inputmode="numeric" value="${x.floors || ''}"></label>
      <label>築年月<input type="month" id="a-built" value="${esc(x.built || '')}"></label>
    </div>`;
}
const readBasic = () => ({
  name: document.getElementById('a-name').value, address: document.getElementById('a-address').value,
  structure: document.getElementById('a-structure').value, floors: document.getElementById('a-floors').value, built: document.getElementById('a-built').value,
});

function financeFields(f = {}) {
  const inp = (k, label, ph, unit = '円') => `<label>${label}<span class="unit"><input type="text" inputmode="decimal" id="f-${k}" value="${f[k] || ''}" placeholder="未入力"><i>${unit}</i></span></label>`;
  return `<div class="row2">
    ${inp('price', '取得価格', '98000000')}
    <label>取得年月<input type="month" id="f-acquired" value="${esc(f.acquired || '')}"></label>
    ${inp('loanBalance', '借入残高', '71000000')}
    ${inp('loanRate', '金利', '0.9', '%')}
    ${inp('loanMonthly', '毎月の返済額', '310000')}
    ${inp('propertyTax', '固定資産税（年）', '620000')}
    ${inp('insurance', '保険料（年）', '80000')}
    ${inp('appraisal', '査定額（あれば）', '')}
    ${inp('capRate', '想定の利回り（価値の計算用）', '', '%')}
  </div>`;
}
const readFinance = () => Object.fromEntries(['price', 'acquired', 'loanBalance', 'loanRate', 'loanMonthly', 'propertyTax', 'insurance', 'appraisal', 'capRate'].map((k) => [k, document.getElementById(`f-${k}`).value]));

async function viewAssetForm(mode, id) {
  // mode: 'self' | 'import'（新規）／ 'edit'（自分で作った資産の編集）
  const x = mode === 'edit' ? await api(`/assets/${enc(id)}`) : { source: mode, rooms: [], finance: {} };
  const isImport = x.source === 'import';
  const re = roomsEditor(x.rooms);
  let ledger = [];
  $app.innerHTML = `
    <p><a href="${mode === 'edit' ? `#/assets/${enc(id)}` : '#/assets/new'}">← 戻る</a></p>
    <h1>${mode === 'edit' ? '基本情報・部屋を編集' : isImport ? '📄 管理会社の資料から作る' : '✍️ 自主管理で入力する'}</h1>
    ${isImport && mode !== 'edit' ? `
      <div class="card">
        <h3>資料を読み込む（CSV）</h3>
        <p class="small muted">Excelの場合は「CSV」で保存してから選んでください。入居者の氏名・電話などの列は読み込みません。</p>
        <label>部屋一覧（レントロール）<input type="file" id="csv-rooms" accept=".csv,.txt,text/csv"></label>
        <label>収支（送金明細・入出金の一覧）<input type="file" id="csv-ledger" accept=".csv,.txt,text/csv"></label>
        <div class="small">資料がなければ見本で試せます：<button type="button" class="btn sub small" data-sample="rooms">部屋一覧の見本</button> <button type="button" class="btn sub small" data-sample="ledger">収支の見本</button></div>
        <div id="csv-result"></div>
      </div>` : ''}
    <form id="af">
      <div class="card">
        ${isImport ? `<label>管理会社の名前<input type="text" id="a-company" value="${esc(x.company || '')}" placeholder="例：〇〇不動産"></label>` : ''}
        ${basicFields(x)}
      </div>
      <h2>部屋</h2>
      <div class="card">${re.html}</div>
      ${mode !== 'edit' ? `<h2>取得・借入・税（わかる範囲で）</h2><div class="card">${financeFields(x.finance)}</div>` : ''}
      <div class="err" id="err"></div>
      <button class="btn">${mode === 'edit' ? '保存する' : 'この内容で登録する'}</button>
    </form>`;
  re.bind();

  if (isImport && mode !== 'edit') {
    const out = document.getElementById('csv-result');
    const show = (title, r) => {
      const kind = r.kind === 'rooms' ? '部屋一覧' : r.kind === 'ledger' ? '収支' : '';
      out.insertAdjacentHTML('beforeend', `<div class="notice" style="margin-top:8px">
        <b>${esc(title)}</b>：${kind ? `${kind}として ${r.items.length}行を読み込みました` : '読み込めませんでした'}
        ${r.ignored.length ? `<br>読み込まなかった列：${r.ignored.map(esc).join('、')}` : ''}
        ${r.errors.length ? `<br><span class="neg">${r.errors.slice(0, 5).map(esc).join('<br>')}${r.errors.length > 5 ? `<br>ほか${r.errors.length - 5}件` : ''}</span>` : ''}</div>`);
    };
    const load = async (input, sample) => {
      const f = sample ? null : input.files[0];
      if (!f && !sample) return;
      const r = detect(parseCSV(sample ? SAMPLES[sample] : decode(await f.arrayBuffer())));
      show(sample ? (sample === 'rooms' ? '部屋一覧の見本' : '収支の見本') : f.name, r);
      if (r.kind === 'rooms') {
        document.querySelector('.rooms-ed tbody').innerHTML = '';
        const tmp = roomsEditor(r.items);
        document.querySelector('.rooms-ed').closest('.card').innerHTML = tmp.html; tmp.bind();
        re.read = tmp.read;
      } else if (r.kind === 'ledger') {
        ledger = r.items;
        const months = [...new Set(ledger.map((e) => e.month))].sort();
        out.insertAdjacentHTML('beforeend', `<div class="small muted">収支：${months.map(ym).join('・')}（${ledger.length}件）を一緒に登録します</div>`);
      }
    };
    document.getElementById('csv-rooms').onchange = (e) => load(e.target);
    document.getElementById('csv-ledger').onchange = (e) => load(e.target);
    document.querySelectorAll('[data-sample]').forEach((b) => { b.onclick = () => load(null, b.dataset.sample); });
  }

  document.getElementById('af').onsubmit = async (e) => {
    e.preventDefault();
    const err = document.getElementById('err');
    const body = { ...readBasic(), rooms: re.read() };
    if (!body.name.trim()) { err.textContent = '物件名を入力してください'; return; }
    if (isImport) body.company = document.getElementById('a-company').value;
    try {
      let r;
      if (mode === 'edit') r = await api(`/assets/${enc(id)}`, { method: 'PATCH', body });
      else r = await api('/assets', { method: 'POST', body: { ...body, source: x.source, finance: readFinance(), ledger } });
      toast(mode === 'edit' ? '保存しました' : '資産を登録しました');
      location.hash = `#/assets/${enc(r.id)}`;
    } catch (ex) { err.textContent = ex.message; }
  };
}

async function viewAsset(id, pane = 'now') {
  const x = await api(`/assets/${enc(id)}`);
  const k = x.kpi;
  const v = x.value;
  const own = x.source !== 'link';
  const P = (name, html) => `<section data-pane="${name}" ${name === pane ? '' : 'hidden'}>${html}</section>`;
  const past = x.timeline.filter((e) => e.when === 'past');
  const future = x.timeline.filter((e) => e.when !== 'past');
  $app.innerHTML = `
    <p><a href="#/assets">← 資産</a></p>
    <h1>${esc(x.name)}</h1>
    <div>${srcBadge(x)}</div>
    <div class="small muted">${esc(x.address)}${x.structure ? `／${esc(x.structure)}造` : ''}${x.floors ? ` ${x.floors}階建` : ''}${x.built ? `／${esc(x.built.slice(0, 4))}年${Number(x.built.slice(5))}月築` : ''}</div>
    <div class="seg" id="panes">
      <button type="button" data-p="past">⏪ 過去</button>
      <button type="button" data-p="now">📍 いま</button>
      <button type="button" data-p="future">⏩ 未来</button>
    </div>
    ${P('past', `
      <h2>月ごとの収支</h2>
      <div class="card"><table class="small">
        <tr><th>月</th><th class="r">収入</th><th class="r">支出</th><th class="r">差引</th></tr>
        ${x.monthly.map((m) => `<tr><td>${esc(ym(m.month))}</td><td class="r num">${yen(m.income)}</td><td class="r num">${yen(m.expense)}</td><td class="r num"><b>${yen(m.net)}</b></td></tr>`).join('') || '<tr><td colspan="4" class="muted">まだ記録がありません</td></tr>'}
      </table>${own ? '' : `<div class="small muted">${esc(x.company)}の計算どおり（収入＝入金額、支出＝管理料＋費用）。</div>`}</div>
      <h2>これまでの出来事</h2>${tlHTML(past)}`)}
    ${P('future', `
      <h2>これから10年の手取り（目安）</h2>
      <div class="card"><div class="tablewrap"><table class="small">
        <tr><th>年</th><th class="r">賃料</th><th class="r">運営費</th><th class="r">修繕</th><th class="r">返済</th><th class="r">手取り</th><th class="r">借入残高</th></tr>
        ${x.projection.years.map((y) => `<tr><td>${y.year}</td><td class="r num">${man(y.rent)}</td><td class="r num">${man(y.cost)}</td><td class="r num">${y.repair ? man(y.repair) : '—'}</td><td class="r num">${y.loan ? man(y.loan) : '—'}</td><td class="r num ${y.cash < 0 ? 'neg' : ''}"><b>${y.cash < 0 ? '−' : ''}${man(Math.abs(y.cash))}</b></td><td class="r num">${man(y.loanBalance)}</td></tr>`).join('')}
      </table></div>
      <div class="small muted">前提：${esc(x.projection.assumptions)}。${x.loan.payoff ? `ローン完済は${esc(ym(x.loan.payoff))}の見込み。` : ''}${x.loan.warning ? esc(x.loan.warning) : ''}</div></div>
      <h2>これからの予定</h2>${tlHTML(future)}`)}
    ${P('now', `
    <div class="card">
      <div class="row"><strong>💎 資産価値</strong><span class="small muted">${v.method === 'appraisal' ? '査定額' : `推定（想定の利回り ${v.capRate}%）`}</span></div>
      <div class="big num">${man(v.value)}</div>
      <div class="kpis">
        <div class="kpi"><div class="kk">純資産（価値−借入）</div><div class="kv2 ${v.equity < 0 ? 'neg' : ''}">${man(v.equity)}</div></div>
        <div class="kpi"><div class="kk">取得価格との差</div><div class="kv2 ${v.gain < 0 ? 'neg' : ''}">${v.gain == null ? '—' : `${v.gain < 0 ? '−' : '＋'}${man(Math.abs(v.gain))}`}</div></div>
        <div class="kpi"><div class="kk">年間の手取り（賃料−運営費）</div><div class="kv2">${man(v.noi)}</div></div>
      </div>
      ${v.method === 'income' ? `<div class="small muted">推定＝年間の手取り ÷ 想定の利回り。査定額があれば下の「取得・借入・税・保険」に入れると、そちらを使います。</div>` : ''}
    </div>
    <div class="card">
      <div class="kpis">
        <div class="kpi"><div class="kk">入居</div><div class="kv2">${k.occupied}/${k.units}<small>室</small></div></div>
        <div class="kpi"><div class="kk">満室想定 年間賃料</div><div class="kv2">${man(k.fullYear)}</div></div>
        <div class="kpi"><div class="kk">表面利回り</div><div class="kv2">${pct(k.grossYield)}</div></div>
        <div class="kpi"><div class="kk">実質利回り（見込み）</div><div class="kv2">${pct(k.netYield)}</div></div>
        <div class="kpi"><div class="kk">借入残高</div><div class="kv2">${man(x.finance.loanBalance)}</div></div>
        <div class="kpi"><div class="kk">年間返済</div><div class="kv2">${man(k.loanYear)}</div></div>
      </div>
      <div class="small muted">実質利回り（見込み）＝（いまの入居での年間賃料 − 年間の運営費の見込み${man(k.annualCost) !== '—' ? ` ${man(k.annualCost)}` : ''}）÷ 取得価格。運営費は${own ? '入力・取込した支出の月平均' : '締め済みの月の管理料・費用の平均'}×12＋固定資産税＋保険料。</div>
    </div>

    <h2>部屋</h2>
    <div class="card"><table class="small">
      <tr><th>部屋</th><th>間取り</th><th class="r">賃料＋共益費</th><th class="r">状態</th></tr>
      ${x.rooms.map((r) => `<tr class="click" data-room="${esc(r.no)}"><td><a href="#/assets/${enc(id)}/rooms/${enc(r.no)}">${esc(r.no)}</a></td><td>${esc(r.layout || '—')}</td><td class="r num">${yen(r.rent + r.fee)}</td><td class="r"><span class="pill ${r.status === '空室' ? 'warn' : 'ok'}">${esc(r.status)}</span></td></tr>`).join('') || '<tr><td colspan="4" class="muted">部屋が登録されていません</td></tr>'}
    </table>${own ? `<a class="btn sub" href="#/assets/${enc(id)}/edit">基本情報・部屋を編集</a>` : `<div class="small muted">部屋と入居状況は${esc(x.company)}のデータです（${esc(ym(seedClosedLabel()))}末時点）。</div>`}</div>

    ${own ? `
      <h2>収入・支出を記録</h2>
      <form id="lf" class="card">
        <div class="row2">
          <label>年月<input type="month" id="l-month" required></label>
          <label>区分<select id="l-type"><option value="income">収入</option><option value="expense">支出</option></select></label>
          <label>項目<input type="text" id="l-cat" placeholder="賃料・修繕・清掃など" required></label>
          <label>金額<span class="unit"><input type="text" id="l-amount" inputmode="numeric" required><i>円</i></span></label>
        </div>
        <div class="err" id="l-err"></div>
        <button class="btn">記録する</button>
        <label style="margin-top:12px">または、収支のCSVを読み込む<input type="file" id="l-csv" accept=".csv,.txt,text/csv"></label>
        <div id="l-res"></div>
      </form>
      ${x.ledger.length ? `<div class="card"><table class="small">${x.ledger.map((e) => `<tr><td>${esc(ym(e.month))}</td><td>${esc(e.category)}${e.room ? ` <span class="muted">${esc(e.room)}</span>` : ''}${e.source === 'import' ? ' <span class="muted">📄</span>' : ''}</td><td class="r num ${e.type === 'expense' ? 'neg' : ''}">${e.type === 'expense' ? '−' : ''}${yen(e.amount)}</td><td class="r"><button class="x" data-del="${esc(e.id)}" aria-label="削除">×</button></td></tr>`).join('')}</table></div>` : ''}` : ''}

    <h2>取得・借入・税・保険</h2>
    <form id="ff" class="card">
      ${financeFields(x.finance)}
      <div class="small muted">オーナーご自身の情報です。管理会社には送りません。</div>
      <button class="btn sub">保存する</button>
    </form>

    ${x.works.length ? `<h2>工事</h2><div class="card">${x.works.map((w) => `<div class="row small"><span>${esc(w.title)}</span><span class="pill info">${esc(w.status)}</span></div>`).join('')}<a class="small" href="#/works">工事の詳しい様子 ›</a></div>` : ''}
    ${own ? '<button class="btn danger" id="del">この資産を削除する</button>' : `<p class="small muted">この建物は${esc(x.company)}（${esc(x.system)}）から届いています。<a href="#/menu/companies">管理会社</a></p>`}`)}`;
  document.querySelectorAll('#panes button').forEach((b) => {
    b.classList.toggle('on', b.dataset.p === pane);
    b.onclick = () => {
      pane = b.dataset.p;
      document.querySelectorAll('#panes button').forEach((c) => c.classList.toggle('on', c === b));
      document.querySelectorAll('[data-pane]').forEach((sec) => { sec.hidden = sec.dataset.pane !== pane; });
    };
  });

  document.getElementById('ff').onsubmit = async (e) => {
    e.preventDefault();
    try { await api(`/assets/${enc(id)}`, { method: 'PATCH', body: { finance: readFinance() } }); toast('保存しました'); viewAsset(id); } catch (ex) { toast(ex.message); }
  };
  if (!own) return;
  document.getElementById('lf').onsubmit = async (e) => {
    e.preventDefault();
    const v = (i) => document.getElementById(i).value;
    try {
      await api(`/assets/${enc(id)}/ledger`, { method: 'POST', body: { month: v('l-month'), type: v('l-type'), category: v('l-cat'), amount: v('l-amount') } });
      toast('記録しました'); viewAsset(id);
    } catch (ex) { document.getElementById('l-err').textContent = ex.message; }
  };
  document.getElementById('l-csv').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const r = detect(parseCSV(decode(await f.arrayBuffer())));
    const res = document.getElementById('l-res');
    if (r.kind !== 'ledger' || !r.items.length) { res.innerHTML = `<p class="err">${esc(r.errors[0] || '収支の資料として読めませんでした')}</p>`; return; }
    if (!(await ask(`${r.items.length}件（${[...new Set(r.items.map((i) => ym(i.month)))].join('・')}）を取り込みます。よろしいですか？${r.errors.length ? `\n読めなかった行：${r.errors.length}件` : ''}`))) return;
    try { await api(`/assets/${enc(id)}/ledger`, { method: 'POST', body: { source: 'import', entries: r.items } }); toast(`${r.items.length}件を取り込みました`); viewAsset(id); } catch (ex) { res.innerHTML = `<p class="err">${esc(ex.message)}</p>`; }
  };
  $app.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = async () => { if (!(await ask('この記録を削除しますか？', '削除する'))) return; await api(`/assets/${enc(id)}/ledger/${enc(b.dataset.del)}`, { method: 'DELETE' }); viewAsset(id); };
  });
  document.getElementById('del').onclick = async () => {
    if (!(await ask(`「${x.name}」と、その収支の記録を削除します。よろしいですか？`, '削除する'))) return;
    await api(`/assets/${enc(id)}`, { method: 'DELETE' });
    toast('削除しました'); location.hash = '#/assets';
  };
}
async function viewRoom(id, no) {
  const r = await api(`/assets/${enc(id)}/rooms/${enc(no)}`);
  const x = r.room;
  const past = r.timeline.filter((e) => e.when === 'past');
  const future = r.timeline.filter((e) => e.when !== 'past');
  $app.innerHTML = `
    <p><a href="#/assets/${enc(id)}">← ${esc(r.asset.name)}</a></p>
    <h1>${esc(x.no)}号室</h1>
    <div class="small muted">${esc(r.asset.name)}</div>
    <div class="card">
      <div class="row"><span class="pill ${x.status === '空室' ? 'warn' : 'ok'}">${esc(x.status)}</span><span class="small muted">${esc(x.layout || '')}</span></div>
      <div class="kpis">
        <div class="kpi"><div class="kk">賃料</div><div class="kv2">${yen(x.rent)}</div></div>
        <div class="kpi"><div class="kk">共益費</div><div class="kv2">${yen(x.fee)}</div></div>
        <div class="kpi"><div class="kk">${x.moveOut ? '退去' : '入居'}</div><div class="kv2">${x.moveOut ? esc(ym(x.moveOut)) : x.since ? esc(ym(x.since)) : '—'}</div></div>
        <div class="kpi"><div class="kk">次の契約更新</div><div class="kv2">${x.leaseEnd ? esc(ym(x.leaseEnd)) : '—'}</div></div>
      </div>
      <div class="small muted">入居者の情報は持ちません。${r.asset.source === 'link' ? `入居・契約の時期は${esc(r.asset.company)}のデータです。` : ''}</div>
    </div>
    <h2>⏪ 過去</h2>${tlHTML(past, { roomLinks: false })}
    <h2>⏩ いま・未来</h2>${tlHTML(future, { roomLinks: false })}`;
}
let closedLatest = '';
const seedClosedLabel = () => closedLatest;


// ---------- ルーティング ----------

async function refreshBadge() {
  try {
    const n = (await api('/proposals?status=sent')).length;
    const b = document.getElementById('badge');
    b.hidden = !n; b.textContent = n;
    const notes = await api('/notifications');
    let seen = ''; try { seen = localStorage.getItem(KEY + ':seen') || ''; } catch { /* noop */ }
    document.getElementById('bellDot').hidden = !notes.some((x) => x.at > seen);
  } catch { /* noop */ }
}

async function route() {
  navSeq++;
  // 壊れた %xx が入っていても止まらない（そのままの文字で探して「見つかりません」を出す）
  const dec = (x) => { try { return decodeURIComponent(x); } catch { return x; } };
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(dec);
  const [page = 'home', a1, a2, a3] = parts;
  const loggedIn = !!session;
  document.getElementById('tabs').hidden = !loggedIn;
  document.getElementById('bell').hidden = !loggedIn;
  if (!loggedIn) { if (page !== 'login') { location.hash = '#/login'; return; } return viewLogin(); }
  if (page === 'login') { location.hash = '#/home'; return; }
  const tab = ['reports', 'notices', 'works'].includes(page) ? 'menu' : page;
  document.querySelectorAll('nav.tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
  try {
    if (!me) { me = await api('/me'); setHeader(); closedLatest = (await api('/months')).closed.slice(-1)[0]; }
    if (page === 'proposals') await (a1 && a2 ? viewProposal(a1, a2) : viewProposals());
    else if (page === 'money') await viewMoney(a1);
    else if (page === 'reports') await (a1 && a2 ? viewReport(a1, a2) : viewReports());
    else if (page === 'works') await viewWorks();
    else if (page === 'assets') {
      if (a1 === 'new') await (a2 ? viewAssetForm(a2 === 'import' ? 'import' : 'self') : viewAssetNew());
      else if (['by-company', 'by-type', 'timeline'].includes(a1)) await viewAssets(a1);
      else if (a1 && a2 === 'rooms' && a3) await viewRoom(a1, a3);
      else if (a1) await (a2 === 'edit' ? viewAssetForm('edit', a1) : viewAsset(a1));
      else await viewAssets();
    }
    else if (page === 'notices') await viewNotices();
    else if (page === 'menu') viewMenu(a1);
    else await viewHome();
    refreshBadge();
  } catch (e) {
    if (e.stale) return;
    if (session) $app.innerHTML = `<div class="card"><p class="err">${esc(e.message)}</p><a href="#/home">ホームへ戻る</a></div>`;
  }
  window.scrollTo(0, 0);
}

async function start() {
  appInfo = await api('/app');
  document.title = appInfo.name;
  setHeader();
  // 公開デモ：ログインの画面を出さずに、デモ（田中様の例）へ入る
  if (!session && window.__autoDemo) {
    session = await api('/auth/demo', { method: 'POST' });
    store.set(session);
    if (!location.hash || location.hash === '#/login') location.hash = '#/home';
  }
  window.addEventListener('hashchange', route);
  route();
}
start().catch(() => { $app.innerHTML = '<p class="err pad">接続できませんでした。時間をおいてお試しください。</p>'; });
