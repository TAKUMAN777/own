// ⑥ 画面をでたらめに操作する ⑦ サーバーと公開ページ（サーバーなし版）が同じ答えを返すか
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(__dirname, '.out');
const seed = Number(process.argv[2] || 1);
const UI_STEPS = Number(process.env.UI_STEPS || 400);
const PARITY = Number(process.env.PARITY || 200);

function rng(s) { let a = s >>> 0; const r = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; r.int = (n) => Math.floor(r() * n); r.pick = (x) => x[Math.floor(r() * x.length)]; r.chance = (p) => r() < p; return r; }
const XSS = ['<img src=x onerror="window.__xss=1">', '"><svg onload=window.__xss=1>', '<script>window.__xss=1</script>', "'-window.__xss=1-'", 'javascript:window.__xss=1'];
const WEIRD = ['', ' ', '0', '-5', '1e400', '9999999999999999', '12,000', '１２３', '😀🏢', '𠮷', 'a'.repeat(300), '‮逆', '../', '%', '2026-13'];
const n = {}; const fail = [];
const ok = (a) => { n[a] = (n[a] || 0) + 1; };
const bad = (a, msg, ctx) => { n[a] = (n[a] || 0) + 1; if (fail.length < 200) fail.push({ area: a, msg, ctx }); };

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const html = path.join(OUT, 'revo-asset.html');
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-static.mjs'), html]);
  const r = rng(seed);
  const browser = await chromium.launch();

  // ---------- ⑥ 画面 ----------
  {
    const ctx = await browser.newContext({ ...devices['iPhone 13'], deviceScaleFactor: 1 });
    const p = await ctx.newPage();
    let errs = [];
    p.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error') errs.push(`console: ${m.text()}`); });
    await p.goto('file://' + html);
    await p.waitForSelector('.chips', { timeout: 15000 });
    const routes = ['#/home', '#/assets', '#/assets/by-company', '#/assets/by-type', '#/assets/timeline', '#/assets/new', '#/assets/new/self', '#/assets/new/import', '#/assets/L.T-01.BL-01', '#/assets/L.T-01.BL-01/rooms/203', '#/assets/AS-2', '#/proposals', '#/proposals/T-01/PR-301', '#/money', '#/money/2026-09', '#/money/2026-11', '#/reports', '#/reports/T-01/2026-10', '#/reports/T-02/2026-09', '#/works', '#/notices', '#/menu', '#/menu/companies', '#/menu/buildings',
      '#/assets/%E0%A4%A', '#/assets/<img>', '#/proposals/T-09/PR-1', '#/reports/T-01/2026-11', '#/money/abc', '#/nope', '#/assets/L.T-01.BL-01/rooms/999', '#/assets/new/xxx', '#//', '#/assets/AS-999/edit'];
    for (let i = 0; i < UI_STEPS; i++) {
      const kind = r.pick(['click', 'click', 'click', 'click', 'fill', 'fill', 'select', 'route', 'route', 'xss-asset', 'back']);
      let desc = kind;
      errs = [];
      try {
        if (kind === 'route') { desc += ' ' + r.pick(routes); await p.evaluate((h) => { location.hash = h; }, desc.slice(6)); }
        else if (kind === 'back') await p.goBack({ timeout: 3000 }).catch(() => {});
        else if (kind === 'click') {
          const els = await p.$$('main a[href^="#"], main button, main summary, main label.opt, nav.tabs a, #bell, .ask button, .seg a, .seg button, .chipf button');
          const vis = []; for (const e of els) if (await e.isVisible()) vis.push(e);
          if (vis.length) { const e = r.pick(vis); desc += ' ' + ((await e.textContent()) || '').trim().slice(0, 20); await e.click({ timeout: 3000 }).catch(() => {}); }
        } else if (kind === 'fill') {
          const els = await p.$$('main input[type=text], main input[type=month], main textarea');
          const vis = []; for (const e of els) if (await e.isVisible()) vis.push(e);
          if (vis.length) {
            const e = r.pick(vis); const type = await e.getAttribute('type');
            const v = type === 'month' ? r.pick(['2026-10', '2030-01', '']) : r.pick([...XSS, ...WEIRD, '佐藤 花子', '50000', 'HKT-0001', 'MGR-0021', 'TNJ-0011']);
            desc += ' ' + v.slice(0, 20);
            await e.fill(v, { timeout: 3000 }).catch(() => {});
            if (r.chance(0.5)) await e.press('Enter').catch(() => {});
          }
        } else if (kind === 'select') {
          const els = await p.$$('main select');
          const vis = []; for (const e of els) if (await e.isVisible()) vis.push(e);
          if (vis.length) { const e = r.pick(vis); const opts = await e.$$eval('option', (o) => o.map((x) => x.value)); await e.selectOption(r.pick(opts)).catch(() => {}); }
        } else if (kind === 'xss-asset') {
          // 名前・部屋・資料に悪意のある文字を入れて、全部の画面に出す
          await p.evaluate(() => { location.hash = '#/assets/new/self'; });
          await p.waitForSelector('#a-name', { timeout: 5000 });
          const x = r.pick(XSS);
          await p.fill('#a-name', `名前${x}`); await p.fill('#a-address', x);
          await p.fill('.rooms-ed tbody tr:first-child [name=no]', `1${x}`.slice(0, 20)); await p.fill('.rooms-ed tbody tr:first-child [name=rent]', '50000');
          await p.click('#af > button.btn');
          await p.waitForTimeout(300);
          for (const h of ['#/assets', '#/assets/timeline', '#/assets/by-type', '#/money', '#/home']) { await p.evaluate((hh) => { location.hash = hh; }, h); await p.waitForTimeout(150); }
        }
        await p.waitForTimeout(120);
        const st = await p.evaluate(() => ({ xss: window.__xss, h: document.documentElement.scrollWidth > innerWidth + 1, text: (document.getElementById('app').innerText || '').trim().length, hash: location.hash }));
        const problems = [];
        if (st.xss) problems.push('悪意のある文字が実行された');
        if (st.h) problems.push(`横にはみ出した ${st.hash}`);
        if (!st.text) problems.push(`画面が空 ${st.hash}`);
        problems.push(...errs.filter((e) => !/Failed to load resource/.test(e)));
        if (problems.length) bad('⑥画面', problems[0], { step: i, action: desc.slice(0, 80) }); else ok('⑥画面');
      } catch (e) { bad('⑥画面', `例外 ${e.message.split('\n')[0]}`, { step: i, action: desc }); }
    }
    await ctx.close();
  }

  // ---------- ⑦ サーバーと公開ページ ----------
  {
    const { createServer } = await import(path.join(ROOT, 'server', 'server.mjs'));
    const server = createServer({ webhookSecret: 'x' });
    await new Promise((res) => server.listen(0, res));
    const base = `http://127.0.0.1:${server.address().port}`;
    const strip = (v) => (Array.isArray(v) ? v.map(strip) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => !['token', 'at'].includes(k)).map(([k, x]) => [k, strip(x)])) : v);
    const callServer = async (q, tok) => {
      const res = await fetch(base + '/api/v1' + q.path, { method: q.method, headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}) }, body: q.body === undefined ? undefined : JSON.stringify(q.body) });
      return { status: res.status, body: await res.json().catch(() => null) };
    };
    // サーバーで操作を作りながら記録する
    const reqs = []; const want = []; let tok = null; let assets = [];
    const push = async (q) => { const x = await callServer(q, q.auth ? tok : null); reqs.push(q); want.push(x); if (q.login && x.status === 200) tok = x.body.token; return x; };
    await push({ method: 'POST', path: '/auth/demo', login: true });
    for (let i = 0; i < PARITY - 1; i++) {
      const k = r.pick(['read', 'read', 'read', 'asset', 'room', 'create', 'patch', 'ledger', 'respond', 'link', 'start']);
      if (k === 'read') await push({ method: 'GET', auth: 1, path: r.pick(['/me', '/assets', '/timeline', '/proposals', '/remittances', '/reports', '/works', '/notifications', '/months', '/pl?month=2026-10', '/pl?month=2026-09', '/pl?month=2026-11', '/companies/T-01/reports/2026-10', '/companies/T-02/reports/2026-09']) });
      else if (k === 'asset' && assets.length) await push({ method: 'GET', auth: 1, path: `/assets/${encodeURIComponent(r.pick(assets).id)}` });
      else if (k === 'room' && assets.length) { const a = r.pick(assets); if (a.rooms.length) await push({ method: 'GET', auth: 1, path: `/assets/${encodeURIComponent(a.id)}/rooms/${encodeURIComponent(r.pick(a.rooms).no)}` }); }
      else if (k === 'create') await push({ method: 'POST', auth: 1, path: '/assets', body: { source: r.pick(['self', 'import']), company: 'x社', name: r.chance(0.9) ? `P${i}` : '', structure: r.pick(['RC', '木造']), built: '2010-04', rooms: [{ no: '101', rent: r.int(90000), fee: 1000, status: '入居中' }, { no: '102', rent: 50000, status: r.pick(['入居中', '空室']) }], finance: { price: r.int(50000000), loanBalance: r.int(30000000), loanRate: 1.1, loanMonthly: r.int(200000) }, ledger: [{ month: '2026-10', type: 'income', category: '賃料', amount: r.int(100000) + 1 }] } });
      else if (k === 'patch' && assets.length) await push({ method: 'PATCH', auth: 1, path: `/assets/${encodeURIComponent(r.pick(assets).id)}`, body: { finance: { price: r.int(90000000), appraisal: r.chance(0.3) ? 70000000 : 0, capRate: r.pick([0, 4.5]) } } });
      else if (k === 'ledger') { const own = assets.filter((a) => a.source !== 'link'); if (own.length) await push({ method: 'POST', auth: 1, path: `/assets/${encodeURIComponent(r.pick(own).id)}/ledger`, body: { month: r.pick(['2026-09', '2026-10', '2026-11']), type: r.pick(['income', 'expense']), category: '項目', amount: r.int(50000) + 1 } }); }
      else if (k === 'respond') await push({ method: 'POST', auth: 1, path: '/companies/T-01/proposals/PR-301/respond', body: { decision: r.pick(['approve', 'return', 'conditional']), quoteId: 'Q-302', comment: r.pick(['', 'お願いします']) } });
      else if (k === 'link') await push({ method: 'POST', auth: 1, path: '/links', body: { code: r.pick(['TNJ-0011', 'MGR-0021', 'HKT-0002']) } });
      else if (k === 'start' && r.chance(0.1)) await push({ method: 'POST', path: '/auth/start', body: { name: `人${i}` }, login: true });
      const l = await callServer({ method: 'GET', path: '/assets' }, tok); assets = l.body?.list || [];
    }
    server.close();
    // 公開ページで同じ順に実行
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await p.goto('file://' + html + '#/login');
    await p.waitForSelector('#app');
    await p.evaluate(() => new Promise((res) => setTimeout(res, 500)));
    // 自動でデモに入った分のアカウントを、サーバーと揃えるため読み直す（同じ demo は同じアカウントになる）
    const got = await p.evaluate(async (reqs) => {
      const out = []; let tok = null;
      for (const q of reqs) {
        const res = await fetch('/api/v1' + q.path, { method: q.method, headers: { 'content-type': 'application/json', ...(q.auth && tok ? { authorization: `Bearer ${tok}` } : {}) }, body: q.body === undefined ? undefined : JSON.stringify(q.body) });
        const body = await res.json().catch(() => null);
        if (q.login && res.status === 200) tok = body.token;
        out.push({ status: res.status, body });
      }
      return out;
    }, reqs);
    await ctx.close();
    for (let i = 0; i < reqs.length; i++) {
      const a = JSON.stringify(strip(want[i])); const b = JSON.stringify(strip(got[i]));
      if (a === b) ok('⑦サーバーと公開ページ');
      else {
        let k = 0; while (k < a.length && a[k] === b[k]) k++;
        bad('⑦サーバーと公開ページ', `${reqs[i].method} ${reqs[i].path} の答えが違う`, { server: a.slice(Math.max(0, k - 60), k + 80), page: b.slice(Math.max(0, k - 60), k + 80) });
      }
    }
  }

  await browser.close();
  console.log(JSON.stringify({ n, fail }));
})().catch((e) => { console.log(JSON.stringify({ n, fail: [...fail, { area: '⑥画面', msg: `動かない：${e.message}` }] })); });
