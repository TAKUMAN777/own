// オーナー自身が使うアプリのサーバー（複数の管理会社とつながる）
// - 静的配信（public/）
// - API（/api/v1/...）：引き継ぎメモ「6. 連動のAPI案」の形。今は架空データのモック。
// 起動：PORT=8791 npm start
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createStore, HttpError } from './store.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const SESSION_MS = 12 * 60 * 60 * 1000;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

export function createServer({ webhookSecret = process.env.WEBHOOK_SECRET || 'demo-secret' } = {}) {
  const store = createStore();
  const sessions = new Map(); // token → { accountId, exp }
  const attempts = new Map(); // ip → { n, until }

  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
    res.end(JSON.stringify(body));
  };

  async function readBody(req) {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > 2 * 1024 * 1024) throw new HttpError(413, 'too_large', 'データが大きすぎます');
      chunks.push(c);
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    return { raw, json: () => { try { return raw ? JSON.parse(raw) : {}; } catch { throw new HttpError(400, 'bad_json', 'JSONの形式が正しくありません'); } } };
  }

  function auth(req) {
    const m = /^Bearer (\S+)$/.exec(req.headers.authorization || '');
    const s = m && sessions.get(m[1]);
    if (!s || s.exp < Date.now()) {
      if (m) sessions.delete(m[1]);
      throw new HttpError(401, 'unauthorized', 'ログインしてください');
    }
    return { ...s, token: m[1] };
  }
  function verifySignature(req, raw) {
    const sig = String(req.headers['x-signature'] || '');
    const expected = 'sha256=' + crypto.createHmac('sha256', webhookSecret).update(raw).digest('hex');
    const a = Buffer.from(sig), b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new HttpError(401, 'bad_signature', '署名が正しくありません');
  }

  function newSession(acc) {
    const token = crypto.randomBytes(24).toString('base64url');
    sessions.set(token, { accountId: acc.id, exp: Date.now() + SESSION_MS });
    return { token, accountId: acc.id };
  }

  async function api(req, res, url) {
    const p = url.pathname.replace(/^\/api\/v1/, '');
    const seg = p.split('/').filter(Boolean).map(decodeURIComponent);
    const M = req.method;

    if (M === 'GET' && p === '/app') return send(res, 200, { name: store.app().name, systems: store.systems(), demo: true });

    if (M === 'POST' && p === '/auth/invite') {
      const ip = req.socket.remoteAddress || '';
      const a = attempts.get(ip) || { n: 0, until: 0 };
      if (a.until > Date.now()) throw new HttpError(429, 'too_many', 'しばらく時間をおいてからお試しください');
      const body = (await readBody(req)).json();
      let acc;
      try { acc = store.login(body.code); } catch (e) {
        a.n += 1; if (a.n >= 5) { a.n = 0; a.until = Date.now() + 60_000; }
        attempts.set(ip, a);
        throw e;
      }
      attempts.delete(ip);
      return send(res, 200, newSession(acc));
    }
    if (M === 'POST' && p === '/auth/start') return send(res, 200, newSession(store.start((await readBody(req)).json().name)));
    if (M === 'POST' && p === '/auth/demo') return send(res, 200, newSession(store.demo()));

    if (M === 'POST' && p === '/auth/logout') {
      const s = auth(req);
      sessions.delete(s.token);
      return send(res, 200, { ok: true });
    }

    // REVO管理 → このサービス（Webhook）
    if (M === 'POST' && p === '/events') {
      const { raw, json } = await readBody(req);
      verifySignature(req, raw);
      return send(res, 200, store.ingestEvent(json()));
    }
    // このサービス → REVO管理（オーナーの回答を取りに来る。本番は REVO管理 へ直接 POST する）
    if (M === 'POST' && p === '/outbox/drain') {
      const { raw } = await readBody(req);
      verifySignature(req, raw);
      return send(res, 200, { items: store.drainOutbox() });
    }

    const s = auth(req);

    const A = s.accountId;
    const q = (k) => url.searchParams.get(k);
    if (M === 'GET' && p === '/me') return send(res, 200, store.me(A));
    if (M === 'POST' && p === '/links') return send(res, 200, store.addLink(A, (await readBody(req)).json().code));
    if (M === 'GET' && p === '/months') return send(res, 200, store.months());
    if (M === 'GET' && p === '/pl') return send(res, 200, store.pl(A, q('month')));
    if (M === 'GET' && p === '/proposals') return send(res, 200, store.proposals(A, q('status')));
    if (M === 'GET' && p === '/remittances') return send(res, 200, store.remittances(A));
    if (M === 'GET' && p === '/reports') return send(res, 200, store.reports(A));
    if (M === 'GET' && p === '/works') return send(res, 200, store.works(A));
    if (M === 'GET' && p === '/notifications') return send(res, 200, store.notifications(A));
    if (M === 'GET' && p === '/timeline') return send(res, 200, store.timeline(A));
    // 資産（建物）
    if (seg[0] === 'assets') {
      if (seg.length === 1 && M === 'GET') return send(res, 200, store.assets(A));
      if (seg.length === 1 && M === 'POST') return send(res, 200, store.createAsset(A, (await readBody(req)).json()));
      if (seg.length === 2 && M === 'GET') return send(res, 200, store.asset(A, seg[1]));
      if (seg.length === 4 && seg[2] === 'rooms' && M === 'GET') return send(res, 200, store.room(A, seg[1], seg[3]));
      if (seg.length === 2 && M === 'PATCH') return send(res, 200, store.updateAsset(A, seg[1], (await readBody(req)).json()));
      if (seg.length === 2 && M === 'DELETE') return send(res, 200, store.deleteAsset(A, seg[1]));
      if (seg.length === 3 && seg[2] === 'ledger' && M === 'POST') return send(res, 200, store.addLedger(A, seg[1], (await readBody(req)).json()));
      if (seg.length === 4 && seg[2] === 'ledger' && M === 'DELETE') return send(res, 200, store.deleteLedger(A, seg[1], seg[3]));
    }
    // 管理会社ごとのデータ：/companies/{tenantId}/...
    if (seg[0] === 'companies' && seg[1]) {
      if (M === 'GET' && seg[2] === 'proposals' && seg[3] && seg.length === 4) return send(res, 200, store.proposal(A, seg[1], seg[3]));
      if (M === 'POST' && seg[2] === 'proposals' && seg[3] && seg[4] === 'respond' && seg.length === 5) {
        return send(res, 200, store.respond(A, seg[1], seg[3], (await readBody(req)).json()));
      }
      if (M === 'GET' && seg[2] === 'reports' && seg[3] && seg.length === 4) return send(res, 200, store.report(A, seg[1], seg[3]));
    }

    throw new HttpError(404, 'not_found', '見つかりません');
  }

  // 工事写真（デモ用のプレースホルダー画像）。つながっている管理会社の工事のものだけ
  function photo(req, res, url) {
    const id = url.pathname.replace(/^\/photos\//, '').replace(/\.svg$/, '');
    const token = url.searchParams.get('t');
    const s = token && sessions.get(token);
    if (!s || s.exp < Date.now() || !store.photoBelongsTo(id, s.accountId)) { res.writeHead(404); return res.end(); }
    const ph = store.photo(id);
    const before = ph.kind === 'before';
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480"><rect width="640" height="480" fill="${before ? '#8a8f98' : '#d7e6f5'}"/>
<rect x="40" y="300" width="560" height="140" fill="${before ? '#6b6f76' : '#b9cfe4'}"/>
${[120, 260, 400, 540].map((x) => `<circle cx="${x}" cy="90" r="22" fill="${before ? '#c9b87a' : '#fffbe6'}" ${before ? '' : 'stroke="#f5d76e" stroke-width="10"'}/>`).join('')}
<text x="320" y="250" font-family="'Noto Sans JP','Hiragino Kaku Gothic ProN','Yu Gothic',Meiryo,sans-serif" font-size="30" text-anchor="middle" fill="${before ? '#fff' : '#1f3b57'}">${esc(ph.caption)}</text>
<text x="320" y="290" font-family="'Noto Sans JP','Hiragino Kaku Gothic ProN','Yu Gothic',Meiryo,sans-serif" font-size="18" text-anchor="middle" fill="${before ? '#eee' : '#3d5a78'}">デモ用の画像（架空）</text></svg>`;
    res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'private, max-age=300' });
    res.end(svg);
  }

  async function staticFile(req, res, url) {
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/index.html';
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end(); }
    try {
      const data = await fs.readFile(file);
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(data);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found');
    }
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('x-frame-options', 'DENY');
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/v1/')) return await api(req, res, url);
      if (url.pathname.startsWith('/photos/') && req.method === 'GET') return photo(req, res, url);
      if (req.method === 'GET' || req.method === 'HEAD') return await staticFile(req, res, url);
      res.writeHead(405); res.end();
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.code, message: e.message });
      console.error(e);
      send(res, 500, { error: 'server_error', message: 'エラーが発生しました' });
    }
  });
  server.store = store;
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8791);
  createServer().listen(port, () => console.log(`owner service: http://localhost:${port}/`));
}
