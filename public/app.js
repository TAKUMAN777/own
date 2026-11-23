// オーナー向けサービス（フロント）
// ルール：金額はサーバー（REVO管理）の計算結果をそのまま表示し、ここでは再計算しない。
//         入居者の個人情報は扱わない（部屋番号まで）。サービス名・会社名は管理会社の設定値を使う。
const $app = document.getElementById('app');
const KEY = 'owner-session-v1';
let tenant = null;
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
const ownerApi = (p) => api(`/owners/${encodeURIComponent(session.ownerId)}${p}`);

function logout(expired) {
  if (session && !expired) api('/auth/logout', { method: 'POST' }).catch(() => {});
  session = null; me = null; store.clear();
  location.hash = '#/login';
  if (expired) toast('もう一度ログインしてください');
}

const STATUS = {
  sent: ['ご回答待ち', 'warn'], approved: ['承認済み', 'ok'], conditional: ['条件付きで承認', 'ok'], returned: ['差戻し', 'ng'],
};
const DECISION = { approve: '承認', conditional: '条件付きで承認', return: '差戻し' };

// ---------- 画面 ----------

function viewLogin() {
  $app.innerHTML = `
    <h1>ログイン</h1>
    <p>${esc(tenant.company)}からお送りした<strong>招待コード</strong>を入力してください。</p>
    <form id="f" class="card">
      <label for="code">招待コード</label>
      <input id="code" type="text" autocomplete="one-time-code" autocapitalize="characters" placeholder="例：HKT-0001" required>
      <div class="err" id="err"></div>
      <button class="btn">ログイン</button>
    </form>
    <p class="notice">デモ用の招待コード：<strong>HKT-0001</strong>（田中様・2棟）／<strong>HKT-0002</strong>（山本様・1棟）</p>
    <p class="small muted">招待コードがお手元にない場合は、${esc(tenant.company)}（${esc(tenant.tel)}）までお問い合わせください。</p>`;
  document.getElementById('f').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    try {
      const r = await api('/auth/invite', { method: 'POST', body: { code: document.getElementById('code').value } });
      session = r; store.set(r);
      location.hash = '#/home';
    } catch (err) {
      document.getElementById('err').textContent = err.message;
    } finally { btn.disabled = false; }
  };
}

async function viewHome() {
  const [pending, months, rems, works, notes] = await Promise.all([
    ownerApi('/proposals?status=sent'), api('/months'), ownerApi('/remittances'), ownerApi('/works'), ownerApi('/notifications'),
  ]);
  const last = months.closed[months.closed.length - 1];
  const pl = await ownerApi(`/pl?month=${last}`);
  const rem = rems.find((r) => r.month === last);
  const active = works.filter((w) => w.status !== '支払済');
  $app.innerHTML = `
    <h1>${esc(me.name)} 様</h1>
    ${pending.length ? `<a class="card attn" href="#/proposals/${esc(pending[0].id)}">
        <div class="row"><strong>ご回答をお待ちしているご提案</strong><span class="pill warn">${pending.length}件</span></div>
        <div class="small">${pending.map((p) => esc(p.title)).join('<br>')}</div></a>`
      : '<div class="card"><strong>ご回答待ちのご提案はありません</strong></div>'}
    <a class="card" href="#/money">
      <div class="row"><span>${esc(ym(last))}分 ご送金額</span>${rem ? `<span class="pill ok">${esc(rem.status)}</span>` : ''}</div>
      <div class="big num">${rem ? yen(rem.amount) : '—'}</div>
      <div class="small muted">入居 ${pl.occupied}／${pl.units}室　${rem ? `送金日 ${esc(ymd(rem.date))}` : ''}</div>
    </a>
    <a class="card" href="#/works">
      <div class="row"><strong>進行中の工事</strong><span class="pill info">${active.length}件</span></div>
      ${active.map((w) => `<div class="small">${esc(w.title)}：${esc(w.status)}</div>`).join('') || '<div class="small muted">ありません</div>'}
    </a>
    <h2>物件</h2>
    ${me.buildings.map((b) => `<div class="card"><strong>${esc(b.name)}</strong><div class="small muted">${esc(b.address)}／${esc(b.structure)}造 ${b.floors}階建／${b.units}室</div></div>`).join('')}
    ${notes.length ? `<h2>お知らせ</h2>${notes.map((n) => `<${n.link ? `a href="${esc(n.link)}"` : 'div'} class="card small"><div class="muted">${esc(md(n.at))}</div>${esc(n.title)}</${n.link ? 'a' : 'div'}>`).join('')}` : ''}
    <h2>管理委託契約</h2>
    ${me.mgmt.map((m) => `<div class="card small">管理料 入金額の${(m.rate * 100).toFixed(1)}%／毎月${m.remitDay}日送金<br>契約期間 ${esc(ymd(m.start))}〜${esc(ymd(m.end))}</div>`).join('')}`;
}

async function viewProposals() {
  const list = await ownerApi('/proposals');
  const pending = list.filter((p) => p.status === 'sent');
  const done = list.filter((p) => p.status !== 'sent');
  const item = (p) => {
    const [label, cls] = STATUS[p.status] || [p.status, ''];
    return `<a class="card" href="#/proposals/${esc(p.id)}">
      <div class="row"><strong>${esc(p.title)}</strong><span class="pill ${cls}">${esc(label)}</span></div>
      <div class="small muted">${esc(md(p.sentAt))}にお送りしました・${p.quotes.length}案</div></a>`;
  };
  $app.innerHTML = `
    <h1>ご提案</h1>
    <h2>ご回答待ち</h2>${pending.map(item).join('') || '<p class="muted">ありません</p>'}
    <h2>これまでのご回答</h2>${done.map(item).join('') || '<p class="muted">ありません</p>'}`;
}

async function viewProposal(id) {
  const p = await api(`/proposals/${encodeURIComponent(id)}`);
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
    <div class="small muted">${esc(p.buildingName)}／${esc(md(p.sentAt))}にお送りしました</div>
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
        <label for="c" id="clabel" class="small">コメント（任意）</label>
        <textarea id="c" maxlength="500" placeholder=""></textarea>
        <div class="err" id="err"></div>
        <button class="btn" id="go">この内容で回答する</button>
        <p class="small muted">ご回答は記録として${esc(tenant.company)}に届きます。発注などの手続きは担当者が確認のうえ行います。</p>
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
    const msg = decision === 'return' ? 'このご提案を差戻します。よろしいですか？'
      : `${letters[p.quoteIds.indexOf(quoteId)]}案（${q.contractor}・${yen(q.total)}）を${DECISION[decision]}します。よろしいですか？`;
    if (!confirm(msg)) return;
    const btn = document.getElementById('go');
    btn.disabled = true; err.textContent = '';
    try {
      await api(`/proposals/${encodeURIComponent(p.id)}/respond`, { method: 'POST', body: { decision, quoteId: decision === 'return' ? undefined : quoteId, comment } });
      toast('ご回答を受け付けました');
      refreshBadge();
      await viewProposal(p.id);
    } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
  };
}

async function viewMoney(month) {
  const [months, rems] = await Promise.all([api('/months'), ownerApi('/remittances')]);
  const m = months.closed.includes(month) ? month : months.closed[months.closed.length - 1];
  const pl = await ownerApi(`/pl?month=${m}`);
  const rem = rems.find((r) => r.month === m);
  $app.innerHTML = `
    <h1>収支・送金</h1>
    <div class="seg">${months.months.map((x) => months.closed.includes(x)
      ? `<a href="#/money/${x}" class="${x === m ? 'on' : ''}">${Number(x.slice(5))}月</a>`
      : `<button disabled title="月締め前">${Number(x.slice(5))}月（締め前）</button>`).join('')}</div>
    ${rem ? `<div class="card">
      <div class="row"><span>${esc(ym(m))}分 ご送金額</span><span class="pill ok">${esc(rem.status)}</span></div>
      <div class="big num">${yen(rem.amount)}</div>
      <table class="small">
        <tr><td>入金額（賃料・共益費）</td><td class="r num">${yen(rem.detail.received)}</td></tr>
        <tr><td>管理料</td><td class="r num">−${yen(rem.detail.fee)}</td></tr>
        <tr><td>費用（清掃・点検など）</td><td class="r num">−${yen(rem.detail.expense)}</td></tr>
        ${rem.detail.works ? `<tr><td>工事代金<div class="muted">${rem.detail.worksOrders.map((w) => `${esc(w.title)} ${yen(w.amount)}`).join('<br>')}</div></td><td class="r num">−${yen(rem.detail.works)}</td></tr>` : ''}
        <tr class="total"><td>ご送金額</td><td class="r num">${yen(rem.amount)}</td></tr>
      </table>
      <div class="small muted">送金日 ${esc(ymd(rem.date))}／${esc(rem.bank)}</div>
    </div>` : '<div class="card muted">この月の送金はまだありません</div>'}
    <h2>物件ごとの収支</h2>
    ${pl.buildings.map((b) => `<div class="card">
      <div class="row"><strong>${esc(b.name)}</strong><span class="small">入居 ${b.occupied}／${b.units}室</span></div>
      <table class="small">
        <tr><td>請求額</td><td class="r num">${yen(b.billed)}</td></tr>
        <tr><td>入金額</td><td class="r num">${yen(b.received)}</td></tr>
        ${b.unpaid ? `<tr><td>未入金</td><td class="r num" style="color:var(--ng)">${yen(b.unpaid)}</td></tr>` : ''}
        <tr><td>管理料</td><td class="r num">−${yen(b.fee)}</td></tr>
        <tr><td>費用${b.expenses.length ? `<div class="muted">${b.expenses.map((e) => `${esc(e.kind)} ${yen(e.amount)}`).join('／')}</div>` : ''}</td><td class="r num">−${yen(b.expense)}</td></tr>
        <tr class="total"><td>差引</td><td class="r num">${yen(b.remit)}</td></tr>
      </table></div>`).join('')}
    <p class="small muted">月締めが終わった月の数字を表示しています。</p>`;
}

async function viewReports() {
  const list = await ownerApi('/reports');
  $app.innerHTML = `<h1>月次報告書</h1>${list.map((r) => `<a class="card" href="#/reports/${esc(r.month)}">
    <div class="row"><strong>${esc(ym(r.month))} 月次報告書</strong><span class="small muted">${esc(ymd(r.publishedAt))}</span></div></a>`).join('') || '<p class="muted">まだありません</p>'}`;
}

async function viewReport(month) {
  const r = await ownerApi(`/reports?month=${encodeURIComponent(month)}`);
  const pl = r.pl;
  $app.innerHTML = `
    <p class="no-print"><a href="#/reports">← 報告書一覧</a></p>
    <div class="doc-head">${esc(tenant.ownerService)}｜${esc(tenant.company)}</div>
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
    ${r.works.length ? `<h2>工事</h2><div class="card">${r.works.map((w) => `<div class="row"><span>${esc(w.title)}</span><span class="pill">${esc(w.status)}</span></div>`).join('')}</div>` : ''}
    <h2>お部屋の状況</h2>
    ${pl.buildings.map((b) => `<div class="card"><strong>${esc(b.name)}</strong>
      <div class="rooms" style="margin-top:6px">${b.rooms.map((x) => `<span class="${esc(x.status)}">${esc(x.no)} ${esc(x.status)}</span>`).join('')}</div></div>`).join('')}
    <button class="btn sub no-print" onclick="window.print()">印刷・PDFで保存</button>
    <p class="print-only small">${esc(tenant.company)}　TEL ${esc(tenant.tel)}</p>`;
}

async function viewWorks() {
  const list = await ownerApi('/works');
  const t = encodeURIComponent(session.token);
  $app.innerHTML = `<h1>工事</h1>${list.map((w) => {
    const idx = w.steps.indexOf(w.status);
    return `<div class="card">
      <div class="row"><strong>${esc(w.title)}</strong><span class="pill ${w.status === '支払済' ? 'ok' : 'info'}">${esc(w.status)}</span></div>
      <div class="small muted">${esc(w.buildingName)}／${esc(w.contractor)}／${yen(w.amount)}</div>
      <ol class="steps">${w.steps.map((s, i) => `<li class="${i <= idx ? 'done' : ''} ${i === idx ? 'cur' : ''}">${esc(s)}</li>`).join('')}</ol>
      ${w.report ? `<p class="small">${esc(w.report)}</p>` : ''}
      ${w.photos.length ? `<div class="photos">${w.photos.map((ph) => `<figure><a href="/photos/${esc(ph.id)}.svg?t=${t}" target="_blank" rel="noopener"><img src="/photos/${esc(ph.id)}.svg?t=${t}" alt="${esc(ph.caption)}" loading="lazy"></a><figcaption>${esc(ph.caption)}</figcaption></figure>`).join('')}</div>` : ''}
      <details class="small"><summary>経過</summary>${w.history.map((h) => `<div>${esc(ymd(h.at))}　${esc(h.status)}</div>`).join('')}</details>
    </div>`;
  }).join('') || '<p class="muted">工事はありません</p>'}`;
}

// ---------- ルーティング ----------

async function refreshBadge() {
  try {
    const n = (await ownerApi('/proposals?status=sent')).length;
    const b = document.getElementById('badge');
    b.hidden = !n; b.textContent = n;
  } catch { /* noop */ }
}

async function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [page = 'home', arg] = parts;
  const loggedIn = !!session;
  document.getElementById('tabs').hidden = !loggedIn;
  document.getElementById('logout').hidden = !loggedIn;
  if (!loggedIn) { if (page !== 'login') { location.hash = '#/login'; return; } return viewLogin(); }
  if (page === 'login') { location.hash = '#/home'; return; }
  document.querySelectorAll('nav.tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === page));
  try {
    if (!me) me = await api('/me');
    if (page === 'proposals') await (arg ? viewProposal(arg) : viewProposals());
    else if (page === 'money') await viewMoney(arg);
    else if (page === 'reports') await (arg ? viewReport(arg) : viewReports());
    else if (page === 'works') await viewWorks();
    else await viewHome();
    refreshBadge();
  } catch (e) {
    if (session) $app.innerHTML = `<div class="card"><p class="err">${esc(e.message)}</p><a href="#/home">ホームへ戻る</a></div>`;
  }
  window.scrollTo(0, 0);
}

async function start() {
  tenant = await api('/tenant');
  // オーナーに見せる名前は「サービス名｜管理会社名」
  document.getElementById('svc').textContent = tenant.ownerService;
  document.getElementById('co').textContent = tenant.company;
  document.title = `${tenant.ownerService}｜${tenant.company}`;
  document.getElementById('logout').onclick = () => logout(false);
  window.addEventListener('hashchange', route);
  route();
}
start().catch(() => { $app.innerHTML = '<p class="err pad">接続できませんでした。時間をおいてお試しください。</p>'; });
