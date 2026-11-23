// オーナー向けサービス（ホワイトラベル）のサーバー
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
  const sessions = new Map(); // token → { ownerId, tenantId, exp }
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
      if (size > 256 * 1024) throw new HttpError(413, 'too_large', 'データが大きすぎます');
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
  // パスの ownerId とログイン中のオーナーが一致しないと見せない
  function sameOwner(s, ownerId) {
    if (s.ownerId !== ownerId) throw new HttpError(403, 'forbidden', 'このデータは表示できません');
  }

  function verifySignature(req, raw) {
    const sig = String(req.headers['x-signature'] || '');
    const expected = 'sha256=' + crypto.createHmac('sha256', webhookSecret).update(raw).digest('hex');
    const a = Buffer.from(sig), b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new HttpError(401, 'bad_signature', '署名が正しくありません');
  }

  async function api(req, res, url) {
    const p = url.pathname.replace(/^\/api\/v1/, '');
    const seg = p.split('/').filter(Boolean).map(decodeURIComponent);
    const M = req.method;

    if (M === 'GET' && p === '/tenant') {
      const t = store.tenant();
      return send(res, 200, { company: t.company, ownerService: t.ownerService, tel: t.tel, demo: true });
    }

    if (M === 'POST' && p === '/auth/invite') {
      const ip = req.socket.remoteAddress || '';
      const a = attempts.get(ip) || { n: 0, until: 0 };
      if (a.until > Date.now()) throw new HttpError(429, 'too_many', 'しばらく時間をおいてからお試しください');
      const body = (await readBody(req)).json();
      let inv;
      try { inv = store.redeemInvite(body.code); } catch (e) {
        a.n += 1; if (a.n >= 5) { a.n = 0; a.until = Date.now() + 60_000; }
        attempts.set(ip, a);
        throw e;
      }
      attempts.delete(ip);
      const token = crypto.randomBytes(24).toString('base64url');
      sessions.set(token, { ownerId: inv.ownerId, tenantId: inv.tenantId, exp: Date.now() + SESSION_MS });
      return send(res, 200, { token, ownerId: inv.ownerId });
    }

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

    if (M === 'GET' && p === '/me') return send(res, 200, store.ownerProfile(s.ownerId));
    if (M === 'GET' && p === '/months') return send(res, 200, store.months());

    if (seg[0] === 'owners' && seg[1]) {
      sameOwner(s, seg[1]);
      const id = seg[1];
      if (M === 'GET' && seg.length === 2) return send(res, 200, store.ownerProfile(id));
      if (M === 'GET' && seg[2] === 'pl' && seg.length === 3) return send(res, 200, store.pl(id, url.searchParams.get('month')));
      if (M === 'GET' && seg[2] === 'proposals' && seg.length === 3) return send(res, 200, store.proposals(id, url.searchParams.get('status')));
      if (M === 'GET' && seg[2] === 'remittances' && seg.length === 3) return send(res, 200, store.remittances(id));
      if (M === 'GET' && seg[2] === 'reports' && seg.length === 3) return send(res, 200, store.reports(id, url.searchParams.get('month')));
      if (M === 'GET' && seg[2] === 'works' && seg.length === 3) return send(res, 200, store.works(id));
      if (M === 'GET' && seg[2] === 'notifications' && seg.length === 3) return send(res, 200, store.notifications(id));
    }

    if (seg[0] === 'proposals' && seg[1]) {
      if (M === 'GET' && seg.length === 2) {
        const pr = store.proposal(seg[1]);
        if (pr.ownerId !== s.ownerId) throw new HttpError(404, 'not_found', 'ご提案が見つかりません');
        return send(res, 200, pr);
      }
      if (M === 'POST' && seg[2] === 'respond' && seg.length === 3) {
        const body = (await readBody(req)).json();
        return send(res, 200, store.respond(seg[1], s.ownerId, body));
      }
    }

    throw new HttpError(404, 'not_found', '見つかりません');
  }

  // 工事写真（デモ用のプレースホルダー画像）
  function photo(req, res, url) {
    const id = url.pathname.replace(/^\/photos\//, '').replace(/\.svg$/, '');
    const token = url.searchParams.get('t');
    const s = token && sessions.get(token);
    if (!s || s.exp < Date.now() || !store.photoBelongsTo(id, s.ownerId)) { res.writeHead(404); return res.end(); }
    const ph = store.photo(id);
    const before = ph.kind === 'before';
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480"><rect width="640" height="480" fill="${before ? '#8a8f98' : '#d7e6f5'}"/>
<rect x="40" y="300" width="560" height="140" fill="${before ? '#6b6f76' : '#b9cfe4'}"/>
${[120, 260, 400, 540].map((x) => `<circle cx="${x}" cy="90" r="22" fill="${before ? '#c9b87a' : '#fffbe6'}" ${before ? '' : 'stroke="#f5d76e" stroke-width="10"'}/>`).join('')}
<text x="320" y="250" font-family="sans-serif" font-size="30" text-anchor="middle" fill="${before ? '#fff' : '#1f3b57'}">${esc(ph.caption)}</text>
<text x="320" y="290" font-family="sans-serif" font-size="18" text-anchor="middle" fill="${before ? '#eee' : '#3d5a78'}">デモ用の画像（架空）</text></svg>`;
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
