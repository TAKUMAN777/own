// まとめて実行：node scripts/fuzz/run.mjs [シード]
// ①〜⑤はこのプロセスで、⑥画面・⑦サーバーと公開ページの一致は browser.cjs（Playwright）で
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Tally } from './lib.mjs';
import { runApi } from './api.mjs';
import { runPure } from './pure.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const seed = Number(process.argv[2] || 20261124);
const only = process.argv[3]; // 例：api / pure / browser
const t = new Tally();
const t0 = Date.now();

if (!only || only === 'pure') runPure(t, seed);
if (!only || only === 'api') await runApi(t, seed);
if (!only || only === 'browser') {
  const r = spawnSync(process.execPath, [path.join(DIR, 'browser.cjs'), String(seed)], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  try {
    const b = JSON.parse(r.stdout.trim().split('\n').pop());
    for (const [k, n] of Object.entries(b.n)) t.n[k] = (t.n[k] || 0) + n;
    t.fail.push(...b.fail);
  } catch { t.bad('⑥画面', `ブラウザの確認が動かなかった：${(r.stderr || r.stdout).slice(-400)}`); }
}

const report = { seed, total: t.total, failed: t.fail.length, byArea: t.n, seconds: Math.round((Date.now() - t0) / 1000), failures: t.fail };
fs.writeFileSync(path.join(DIR, 'last-report.json'), JSON.stringify(report, null, 2));
console.log(`シード ${seed}：${t.total}件（${report.seconds}秒）`);
for (const [k, n] of Object.entries(t.n)) console.log(`  ${k}: ${n}件 ${t.fail.filter((f) => f.area === k).length ? `／失敗 ${t.fail.filter((f) => f.area === k).length}` : 'OK'}`);
const groups = {};
for (const f of t.fail) { const k = `${f.area}｜${String(f.msg).replace(/\d+/g, '#').slice(0, 70)}`; groups[k] = (groups[k] || 0) + 1; }
for (const [k, n] of Object.entries(groups).sort((a, b) => b[1] - a[1]).slice(0, 30)) console.log(`  ✗ ${n}× ${k}`);
process.exitCode = t.fail.length ? 1 : 0;
