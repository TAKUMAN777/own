// サーバーなしで動く1枚のページ（公開デモ用）を作る：node scripts/build-static.mjs [出力先]
// - server/ のデータとルール（seed・insights・store）をブラウザの中で動かす
// - 画面からの /api/v1 の呼び出しは、ページの中で受けて store に渡す
// - データはページを開いている間だけ（再読み込みで初期状態に戻る）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const out = process.argv[2] || path.join(ROOT, 'dist', 'revo-asset.html');

// ES モジュールを、1つのスクリプトの中の関数に包む
function wrap(name, src, imports) {
  const names = new Set();
  let body = src.replace(/^import\s+(.+?)\s+from\s+'(.+?)';?\s*$/gm, (_, what, from) => {
    const mod = imports[from];
    if (!mod) throw new Error(`${name}: 不明な import ${from}`);
    const ns = what.match(/^\*\s+as\s+(\w+)$/);
    return ns ? `const ${ns[1]} = ${mod};` : `const ${what.replace(/\s+as\s+/g, ': ')} = ${mod};`;
  });
  body = body.replace(/^export\s+((?:async\s+)?(?:const|let|function|class)\s+(\w+))/gm, (_, decl, n) => { names.add(n); return decl; });
  body = body.replace(/^export\s*\{([^}]+)\};?\s*$/gm, (_, list) => { list.split(',').map((x) => x.trim()).filter(Boolean).forEach((n) => names.add(n)); return ''; });
  return `const __m_${name} = (() => {\n${body}\nreturn { ${[...names].join(', ')} };\n})();\n`;
}

const seed = wrap('seed', read('server/seed.mjs'), {});
const ins = wrap('ins', read('server/insights.mjs'), {});
const store = wrap('store', read('server/store.mjs'), { './seed.mjs': '__m_seed', './insights.mjs': '__m_ins' });
const csv = wrap('csv', read('public/csv.js'), {});

let app = read('public/app.js');
// 工事写真：サーバーの代わりにページの中で画像を作る
app = app.replaceAll('/photos/${esc(ph.id)}.svg?t=${t}', '${__photo(ph.id)}');
// 印刷はこのページでは使えないので、ボタンを出さない
app = app.replace(/\s*<button class="btn sub no-print" onclick="window\.print\(\)">[^<]*<\/button>/, '');
if (app.includes('window.print')) throw new Error('印刷ボタンを外せませんでした');
const appMod = wrap('app', app, { './csv.js': '__m_csv' });

// /api/v1 をページの中で受ける（server/server.mjs の api() と同じ道筋）
const shim = `
const __store = __m_store.createStore();
const __sessions = new Map();
const __esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function __photo(id) {
  const ph = __store.photo(id);
  if (!ph) return '';
  const before = ph.kind === 'before';
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480"><rect width="640" height="480" fill="' + (before ? '#8a8f98' : '#d7e6f5') + '"/>'
    + '<rect x="40" y="300" width="560" height="140" fill="' + (before ? '#6b6f76' : '#b9cfe4') + '"/>'
    + [120, 260, 400, 540].map((x) => '<circle cx="' + x + '" cy="90" r="22" fill="' + (before ? '#c9b87a' : '#fffbe6') + '"' + (before ? '' : ' stroke="#f5d76e" stroke-width="10"') + '/>').join('')
    + '<text x="320" y="250" font-family="sans-serif" font-size="30" text-anchor="middle" fill="' + (before ? '#fff' : '#1f3b57') + '">' + __esc(ph.caption) + '</text>'
    + '<text x="320" y="290" font-family="sans-serif" font-size="18" text-anchor="middle" fill="' + (before ? '#eee' : '#3d5a78') + '">デモ用の画像（架空）</text></svg>';
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}
function __api(method, url, headers, raw) {
  const u = new URL(url, location.href);
  const p = u.pathname.replace(/^.*\\/api\\/v1/, '');
  const seg = p.split('/').filter(Boolean).map(decodeURIComponent);
  const q = (k) => u.searchParams.get(k);
  const json = () => { try { return raw ? JSON.parse(raw) : {}; } catch { throw Object.assign(new Error('JSONの形式が正しくありません'), { status: 400, code: 'bad_json' }); } };
  const M = method;
  if (M === 'GET' && p === '/app') return { name: __store.app().name, systems: __store.systems(), demo: true };
  if (M === 'POST' && p === '/auth/invite') {
    const acc = __store.login(json().code);
    const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
    __sessions.set(token, acc.id);
    return { token, accountId: acc.id };
  }
  const m = /^Bearer (\\S+)$/.exec(headers.authorization || '');
  const A = m && __sessions.get(m[1]);
  if (!A) throw Object.assign(new Error('ログインしてください'), { status: 401, code: 'unauthorized' });
  if (M === 'POST' && p === '/auth/logout') { __sessions.delete(m[1]); return { ok: true }; }
  if (M === 'GET' && p === '/me') return __store.me(A);
  if (M === 'POST' && p === '/links') return __store.addLink(A, json().code);
  if (M === 'GET' && p === '/months') return __store.months();
  if (M === 'GET' && p === '/pl') return __store.pl(A, q('month'));
  if (M === 'GET' && p === '/proposals') return __store.proposals(A, q('status'));
  if (M === 'GET' && p === '/remittances') return __store.remittances(A);
  if (M === 'GET' && p === '/reports') return __store.reports(A);
  if (M === 'GET' && p === '/works') return __store.works(A);
  if (M === 'GET' && p === '/notifications') return __store.notifications(A);
  if (M === 'GET' && p === '/timeline') return __store.timeline(A);
  if (seg[0] === 'assets') {
    if (seg.length === 1 && M === 'GET') return __store.assets(A);
    if (seg.length === 1 && M === 'POST') return __store.createAsset(A, json());
    if (seg.length === 2 && M === 'GET') return __store.asset(A, seg[1]);
    if (seg.length === 4 && seg[2] === 'rooms' && M === 'GET') return __store.room(A, seg[1], seg[3]);
    if (seg.length === 2 && M === 'PATCH') return __store.updateAsset(A, seg[1], json());
    if (seg.length === 2 && M === 'DELETE') return __store.deleteAsset(A, seg[1]);
    if (seg.length === 3 && seg[2] === 'ledger' && M === 'POST') return __store.addLedger(A, seg[1], json());
    if (seg.length === 4 && seg[2] === 'ledger' && M === 'DELETE') return __store.deleteLedger(A, seg[1], seg[3]);
  }
  if (seg[0] === 'companies' && seg[1]) {
    if (M === 'GET' && seg[2] === 'proposals' && seg[3] && seg.length === 4) return __store.proposal(A, seg[1], seg[3]);
    if (M === 'POST' && seg[2] === 'proposals' && seg[3] && seg[4] === 'respond' && seg.length === 5) return __store.respond(A, seg[1], seg[3], json());
    if (M === 'GET' && seg[2] === 'reports' && seg[3] && seg.length === 4) return __store.report(A, seg[1], seg[3]);
  }
  throw Object.assign(new Error('見つかりません'), { status: 404, code: 'not_found' });
}
const __fetch = window.fetch.bind(window);
window.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  if (!url.includes('/api/v1/')) return __fetch(input, init);
  const headers = {};
  for (const [k, v] of Object.entries(init.headers || {})) headers[k.toLowerCase()] = v;
  let status = 200, body;
  try { body = JSON.parse(JSON.stringify(__api((init.method || 'GET').toUpperCase(), url, headers, init.body))); }
  catch (e) { status = e.status || 500; body = { error: e.code || 'server_error', message: e.status ? e.message : 'エラーが発生しました' }; if (!e.status) console.error(e); }
  await new Promise((r) => setTimeout(r, 60));
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
};
// 公開デモは開くたびに初期状態から（前回のログインは使わない）
try { localStorage.removeItem('owner-app-session-v2'); } catch { /* noop */ }
`;

let html = read('public/index.html');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'))
  .replace(/\s*<script type="module" src="\/app\.js"><\/script>/, '')
  .replace('デモ版：表示している物件・金額・写真はすべて架空のデータです', 'デモ版：物件・金額・写真はすべて架空です（再読み込みで初期状態に戻ります）');
const css = read('public/styles.css');
const page = `<title>REVO ASSET</title>
<meta name="theme-color" content="#233746">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&display=swap">
<style>
${css}
</style>
${body.trim()}
<script type="module">
${seed}
${ins}
${store}
${csv}
${shim}
${appMod}
</script>
`;
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, page);
console.log(out, `${Math.round(page.length / 1024)}KB`);
