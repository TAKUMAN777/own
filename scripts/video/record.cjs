// 紹介動画の収録：stage.html の中のスマホ枠でアプリを動かし、画面を録画する
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const DIR = __dirname;
const APP = 'http://localhost:8791/';
const TOTAL = 180;

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, recordVideo: { dir: path.join(DIR, 'raw'), size: { width: 1280, height: 720 } } });
  const t0 = Date.now();
  const T = () => (Date.now() - t0) / 1000;
  const page = await ctx.newPage();
  page.on('dialog', (d) => setTimeout(() => d.accept(), 900));
  const taps = [];
  const marks = {};
  await page.route(APP + '__stage.html', (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: fs.readFileSync(path.join(DIR, 'stage.html'), 'utf8') }));
  // 収録のときだけ、アプリを枠の中に表示できるようにする（アプリ本体の設定は変えない）
  await page.route((u) => u.href.startsWith(APP) && !u.href.includes('__stage'), async (route) => {
    const r = await route.fetch();
    const h = { ...r.headers() }; delete h['x-frame-options'];
    await route.fulfill({ response: r, headers: h });
  });
  await page.goto(APP + '__stage.html');
  await page.evaluate(() => document.fonts.ready);
  const until = async (sec) => { const ms = sec * 1000 - (Date.now() - t0); if (ms > 0) await page.waitForTimeout(ms); };
  const cap = (c) => page.evaluate((c) => window.scene(c), c);
  const prog = (s) => page.evaluate((p) => window.progress(p), s / TOTAL);

  // ---- 0：タイトル ----
  await page.evaluate(() => window.cover(`%LOGO%<h1>REVO ASSET</h1><p>オーナーのための資産管理アプリ</p><small>建物ごと・管理会社ごと・自主管理<br>過去・いま・未来の資産を、ひとつに。</small>`));
  await page.evaluate((u) => { document.getElementById('app').src = u; }, APP);
  const F = () => page.frames().find((f) => f !== page.mainFrame() && f.url().startsWith(APP));
  for (let i = 0; i < 50 && !F(); i++) await page.waitForTimeout(200);
  if (!F()) throw new Error('frame not found: ' + page.frames().map((f) => f.url()).join(','));
  await F0();
  async function F0() { await F().waitForSelector('#f-code'); }
  const inject = () => F().evaluate(() => {
    if (window.__tap) return;
    const st = document.createElement('style');
    st.textContent = '.__rip{position:fixed;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;background:rgba(224,123,36,.45);border:3px solid #e07b24;pointer-events:none;z-index:9999;animation:__r .7s ease-out forwards}@keyframes __r{from{transform:scale(.4);opacity:1}to{transform:scale(1.6);opacity:0}}html{scroll-behavior:smooth}';
    document.head.appendChild(st);
    window.__tap = (x, y) => { const d = document.createElement('div'); d.className = '__rip'; d.style.left = x + 'px'; d.style.top = y + 'px'; document.body.appendChild(d); setTimeout(() => d.remove(), 800); };
  });
  await inject();
  const tap = async (sel, opts = {}) => {
    const f = F();
    const loc = f.locator(sel).first();
    await loc.scrollIntoViewIfNeeded();
    await page.waitForTimeout(350);
    const box = await loc.evaluate((e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await f.evaluate(({ x, y }) => window.__tap(x, y), box);
    taps.push(T());
    await page.waitForTimeout(250);
    await loc.click(opts);
    await page.waitForTimeout(600);
  };
  const type = async (sel, text) => { const loc = F().locator(sel).first(); await loc.click(); await loc.pressSequentially(text, { delay: 140 }); };
  const scroll = (y) => F().evaluate((y) => window.scrollTo({ top: y, behavior: 'smooth' }), y);
  const go = async (hash) => { await F().evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(900); };

  await until(8);
  // ---- 1：悩み ----
  marks.s1 = T(); await prog(9);
  await page.evaluate(() => window.cover(null));
  await cap({ kicker: 'こんなこと、ありませんか？', title: '物件も、管理会社も、<br><em>バラバラ</em>。', points: ['管理会社ごとに違う報告書と送金明細', '自主管理の物件はノートやExcel', '結局、資産はいくら？ これからどうなる？'] });
  await until(20);

  // ---- 2：招待コード ----
  marks.s2 = T(); await prog(20);
  await cap({ kicker: 'はじめかた', title: '管理会社の<em>招待コード</em>を<br>入れるだけ', sub: 'ご提案・送金・報告書・工事の様子が、このアプリにまとめて届きます。' });
  await page.waitForTimeout(1500);
  await type('#f-code', 'HKT-0001');
  await page.waitForTimeout(500);
  await tap('#f button');
  await inject();
  await until(33);

  // ---- 3：ホーム ----
  marks.s3 = T(); await prog(33);
  await cap({ kicker: 'ホーム', title: 'やることと数字が、<br><em>ひと目で</em>わかる', points: ['回答待ちのご提案を、大きなボタンで', '今月のご送金の合計', '進行中の工事'] });
  await page.waitForTimeout(4000); await scroll(330); await page.waitForTimeout(3500); await scroll(0);
  await until(46);

  // ---- 4：管理会社をつなぐ ----
  marks.s4 = T(); await prog(46);
  await cap({ kicker: '連携', title: '<em>REVO管理・REVO MANAGER</em><br>とつながる', sub: '使っている管理会社が違っても、招待コードを足すだけ。建物・部屋・収支が自動で届きます。' });
  await tap('nav.tabs a[data-tab=menu]');
  await tap('a[href="#/menu/companies"]');
  await page.waitForTimeout(800);
  await type('#lk-code', 'MGR-0021');
  await tap('#lk button');
  await page.waitForTimeout(1500); await scroll(0);
  await until(60);

  // ---- 5：資産 ----
  marks.s5 = T(); await prog(60);
  await cap({ kicker: '資産', title: '資産価値と純資産を、<br><em>いつでも</em>', points: ['資産価値（査定額、または収益からの目安）', '純資産＝資産価値 − 借入残高', '入居・利回り・借入をまとめて'] });
  await tap('nav.tabs a[data-tab=assets]');
  await page.waitForTimeout(4000); await scroll(520); await page.waitForTimeout(3000); await scroll(0);
  await until(74);

  // ---- 6：管理会社ごと・管理方法 ----
  marks.s6 = T(); await prog(74);
  await cap({ kicker: '見かたを切り替え', title: '建物ごと・<em>管理会社ごと</em>・<br>管理方法ごと', sub: '管理会社に任せている物件も、自主管理の物件も、同じ物差しで比べられます。' });
  await tap('a[href="#/assets/by-company"]');
  await page.waitForTimeout(1200); await scroll(430); await page.waitForTimeout(2500);
  await tap('a[href="#/assets/by-type"]');
  await page.waitForTimeout(1000); await scroll(430); await page.waitForTimeout(1500);
  await until(86);

  // ---- 7：建物 いま ----
  marks.s7 = T(); await prog(86);
  await cap({ kicker: '建物ごと', title: '<em>いま</em>の価値と稼ぎ', points: ['資産価値・純資産・取得価格との差', '表面・実質利回り', '部屋ごとの賃料と入居'] });
  await go('#/assets/L.T-01.BL-01');
  await inject();
  await page.waitForTimeout(3500); await scroll(420); await page.waitForTimeout(3000); await scroll(800); await page.waitForTimeout(2500); await scroll(0);
  await until(100);

  // ---- 8：過去 ----
  marks.s8 = T(); await prog(100);
  await cap({ kicker: '過去', title: 'これまでの<em>収支と出来事</em>', sub: '月ごとの収支、ご提案と回答、工事、入居と退去。建物の歴史が残ります。' });
  await tap('[data-p=past]');
  await page.waitForTimeout(2500); await scroll(500); await page.waitForTimeout(3000);
  await until(110);

  // ---- 9：未来 ----
  marks.s9 = T(); await prog(110);
  await cap({ kicker: '未来', title: 'これから<em>10年</em>の見通し', points: ['毎年の手取りと借入残高', '修繕の目安とローン完済', '契約の更新・法定耐用年数'] });
  await scroll(0); await page.waitForTimeout(600);
  await tap('[data-p=future]');
  await page.waitForTimeout(3500); await scroll(650); await page.waitForTimeout(3000); await scroll(1500);
  await until(122);

  // ---- 10：部屋 ----
  marks.s10 = T(); await prog(122);
  await cap({ kicker: '部屋ごと', title: '1部屋ずつの<em>タイムライン</em>', sub: '賃料・入居・次の契約更新と、その部屋の工事やご提案。入居者の個人情報は持ちません。' });
  await scroll(0); await page.waitForTimeout(500);
  await tap('[data-p=now]');
  await tap('[data-pane=now] a[href$="/rooms/203"]');
  await page.waitForTimeout(3000); await scroll(400);
  await until(133);

  // ---- 11：全体のタイムライン ----
  marks.s11 = T(); await prog(133);
  await cap({ kicker: 'タイムライン', title: 'すべての資産の<br><em>過去・いま・未来</em>', sub: 'お金・工事と修繕・部屋・建物と契約で絞り込めます。' });
  await go('#/assets/timeline');
  await inject();
  await page.waitForTimeout(1200); await scroll(380); await page.waitForTimeout(1500);
  await tap('#tlf [data-k=work]');
  await page.waitForTimeout(1200); await scroll(1400); await page.waitForTimeout(2500); await scroll(2600);
  await until(145);

  // ---- 12：ご提案に回答 ----
  marks.s12 = T(); await prog(145);
  await cap({ kicker: 'ご提案に回答', title: 'A案・B案を比べて、<br><em>スマホで承認</em>', sub: '回答は記録として管理会社に届きます。発注の確定は担当者が行います。' });
  await scroll(0); await page.waitForTimeout(300);
  await tap('nav.tabs a[data-tab=proposals]');
  await tap('a[href^="#/proposals/T-01/PR-301"]');
  await page.waitForTimeout(1500); await scroll(330); await page.waitForTimeout(1500);
  await tap('#go');
  await page.waitForTimeout(900);
  await tap('.ask [data-a="1"]');
  await page.waitForTimeout(1600); await scroll(0);
  await until(159);

  // ---- 13：資料から・自主管理 ----
  marks.s13 = T(); await prog(159);
  await cap({ kicker: '資料から・自主管理', title: '<em>どの管理会社</em>の物件も、<br>自主管理の物件も', points: ['送金明細・部屋一覧のCSVを読み込み', '自主管理は収入と支出を入力', '入居者名などの列は読み込みません'] });
  await go('#/assets/new/import');
  await inject();
  await page.waitForTimeout(800);
  await tap('[data-sample="rooms"]');
  await page.waitForTimeout(900);
  await tap('[data-sample="ledger"]');
  await page.waitForTimeout(1500); await scroll(560);
  await until(168);

  // ---- 14：締め ----
  marks.s14 = T(); await prog(180);
  await page.evaluate(() => window.cover(`%LOGO%<h1>REVO ASSET</h1><p>過去・いま・未来の資産を、ひとつに。</p><div class="chips"><span>🏢 建物ごと</span><span>🔗 管理会社ごと</span><span>✍️ 自主管理</span><span>💎 資産価値</span><span>🕒 タイムライン</span></div><small>REVO MANAGE ・ REVO MANAGER ・ REVO BUILD ・ REVO LINK とつながる、オーナーのためのアプリ</small>`));
  await until(TOTAL + 0.5);

  const vpath = await page.video().path();
  await ctx.close(); await browser.close();
  fs.writeFileSync(path.join(DIR, 'timeline.json'), JSON.stringify({ taps, marks, video: vpath }, null, 2));
  console.log('video', vpath, 'taps', taps.length, 'end', T());
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
