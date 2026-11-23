// オーナー自身が使うアプリ（フロント）
// - オーナーのアカウントに、複数の管理会社がつながる。データの正は各社の管理システム。
// - 金額は各社の計算結果をそのまま表示し、ここでは再計算しない（会社をまたぐ合計はサーバーで出す）。
// - 入居者の個人情報は扱わない（部屋番号まで）。
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

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600);
}

async function api(path, opts = {}) {
  const res = await fetch(`/api/v1${path}`, {
    method: opts.method || 'GET',
    headers: { 'content-type': 'application/json', ...(session ? { authorization: `Bearer ${session.token}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && session && path !== '/auth/invite') { logout(true); throw new Error('ログインの有効期限が切れました'); }
  if (!res.ok) { const e = new Error(data.message || 'エラーが発生しました'); e.code = data.error; throw e; }
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
    <p>物件の管理を任せている管理会社から届いた<strong>招待コード</strong>を入力してください。<br>
      その会社からのご提案・送金・報告書・工事の様子が、このアプリにまとめて届きます。</p>
    ${codeForm('f', 'はじめる')}
    <p class="notice">デモ用の招待コード：<strong>HKT-0001</strong>（田中様）／<strong>HKT-0002</strong>（山本様）<br>
      田中様はログイン後、メニューの「管理会社」で <strong>TNJ-0011</strong> を入れると2社目がつながります。</p>`;
  document.getElementById('f').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    try {
      const r = await api('/auth/invite', { method: 'POST', body: { code: document.getElementById('f-code').value } });
      session = r; store.set(r);
      location.hash = '#/home';
    } catch (err) {
      document.getElementById('f-err').textContent = err.message;
    } finally { btn.disabled = false; }
  };
}

async function viewHome() {
  const [pending, months, rems, works] = await Promise.all([
    api('/proposals?status=sent'), api('/months'), api('/remittances'), api('/works'),
  ]);
  const last = months.closed[months.closed.length - 1];
  const pl = await api(`/pl?month=${last}`);
  const monthRems = rems.filter((r) => r.month === last);
  const active = works.filter((w) => w.status !== '支払済');
  const nb = me.links.reduce((s, l) => s + l.buildings.length, 0);
  const chip = (href, ic, label, n, unit = '') => `<a class="chip" href="${href}"><span class="ic">${ic}</span>${label}<b>${n}</b>${unit ? `<small>${unit}</small>` : ''}</a>`;
  $app.innerHTML = `
    <div class="chips">
      ${chip('#/menu/buildings', '🏢', '物件', nb, '棟')}
      ${chip('#/money', '🏠', '入居', pl.total ? `${pl.total.occupied}/${pl.total.units}` : '—')}
      ${chip('#/proposals', '🤝', '回答待ち', pending.length)}
      ${chip('#/works', '🏗️', '工事中', active.length)}
      ${chip('#/menu/companies', '🔗', '管理会社', me.links.length, '社')}
    </div>
    ${pending.length
      ? `<a class="btn hero" href="#/proposals/${enc(pending[0].tenantId)}/${enc(pending[0].id)}">▶ ご提案に回答する（${pending.length}件）</a>`
      : `<a class="btn hero" href="#/reports">📄 ${Number(last.slice(5))}月の月次報告書を見る</a>`}
    ${pending.map((p) => `<a class="card attn" href="#/proposals/${enc(p.tenantId)}/${enc(p.id)}">
        <div class="row"><strong>${esc(p.title)}</strong><span class="pill warn">ご回答待ち</span></div>
        <div class="small muted">${co(p)} ${esc(md(p.sentAt))}・${p.quotes.length}案からお選びください</div></a>`).join('')}
    <a class="card" href="#/money/${esc(last)}">
      <div class="row"><span>💴 ${esc(ym(last))}分 ご送金の合計</span>${monthRems.length ? `<span class="pill ok">${monthRems.length}社 送金済</span>` : ''}</div>
      <div class="big num">${monthRems.length ? yen(monthRems.reduce((s, r) => s + r.amount, 0)) : '—'}</div>
      ${monthRems.map((r) => `<div class="row small"><span>${co(r)}</span><span class="num">${yen(r.amount)}（${esc(md(r.date))}）</span></div>`).join('')}
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
    if (!confirm(msg)) return;
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
    <p class="small muted">月締めが終わった月の数字を、各管理会社の計算どおりに表示しています。</p>`;
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
    $app.innerHTML = `${back}<h1>🏢 物件・契約</h1>
      ${me.links.map((l) => `<h2>🔗 ${esc(l.company)}</h2>
        ${l.buildings.map((b) => `<div class="card"><strong>${esc(b.name)}</strong><div class="small muted">${esc(b.address)}<br>${esc(b.structure)}造 ${b.floors}階建／${b.units}室／${esc(b.built.replace('-', '年'))}月築</div></div>`).join('')}
        ${l.mgmt.map((m) => `<div class="card small">管理委託契約：管理料 入金額の${(m.rate * 100).toFixed(1)}%／毎月${m.remitDay}日送金<br>契約期間 ${esc(ymd(m.start))}〜${esc(ymd(m.end))}</div>`).join('')}`).join('')}`;
    return;
  }
  if (arg === 'companies') {
    $app.innerHTML = `${back}<h1>🔗 管理会社</h1>
      <p class="small muted">物件の管理を任せている会社です。各社からのご提案・送金・報告書がこのアプリに届きます。</p>
      <div class="menu">${me.links.map((l) => `<a class="menu-item" href="tel:${esc(l.tel)}"><span class="ic">🏢</span><span><b>${esc(l.company)}</b><small>物件 ${l.buildings.length}棟／📞 ${esc(l.tel)}</small></span><span class="go">›</span></a>`).join('')}</div>
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
      ${item('#/reports', '📄', '月次報告書', '各管理会社からの毎月のご報告・PDFで保存')}
      ${item('#/notices', '🔔', 'お知らせ', 'ご提案・送金・報告書のお知らせ')}
      ${item('#/menu/buildings', '🏢', '物件・契約', '物件の一覧と管理委託契約')}
      ${item('#/menu/companies', '🔗', '管理会社', `つながっている会社 ${me.links.length}社・追加・お問い合わせ`)}
    </div>
    <button class="btn sub" id="out">ログアウト</button>
    <p class="small muted">${esc(me.name)} 様でログイン中</p>`;
  document.getElementById('out').onclick = () => logout(false);
}

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
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const [page = 'home', a1, a2] = parts;
  const loggedIn = !!session;
  document.getElementById('tabs').hidden = !loggedIn;
  document.getElementById('bell').hidden = !loggedIn;
  if (!loggedIn) { if (page !== 'login') { location.hash = '#/login'; return; } return viewLogin(); }
  if (page === 'login') { location.hash = '#/home'; return; }
  const tab = ['reports', 'notices'].includes(page) ? 'menu' : page;
  document.querySelectorAll('nav.tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
  try {
    if (!me) { me = await api('/me'); setHeader(); }
    if (page === 'proposals') await (a1 && a2 ? viewProposal(a1, a2) : viewProposals());
    else if (page === 'money') await viewMoney(a1);
    else if (page === 'reports') await (a1 && a2 ? viewReport(a1, a2) : viewReports());
    else if (page === 'works') await viewWorks();
    else if (page === 'notices') await viewNotices();
    else if (page === 'menu') viewMenu(a1);
    else await viewHome();
    refreshBadge();
  } catch (e) {
    if (session) $app.innerHTML = `<div class="card"><p class="err">${esc(e.message)}</p><a href="#/home">ホームへ戻る</a></div>`;
  }
  window.scrollTo(0, 0);
}

async function start() {
  appInfo = await api('/app');
  document.title = appInfo.name;
  setHeader();
  window.addEventListener('hashchange', route);
  route();
}
start().catch(() => { $app.innerHTML = '<p class="err pad">接続できませんでした。時間をおいてお試しください。</p>'; });
