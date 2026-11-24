// 乱数（シード付き）と、いろいろな「意地悪な」値
export function rng(seed) {
  let a = seed >>> 0;
  const r = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  r.int = (n) => Math.floor(r() * n);
  r.pick = (xs) => xs[Math.floor(r() * xs.length)];
  r.chance = (p) => r() < p;
  r.range = (a0, b0) => a0 + Math.floor(r() * (b0 - a0 + 1));
  return r;
}

export const NASTY = [
  '', ' ', '　', '\n', '\t', '0', '-1', '-0', 'NaN', 'Infinity', '-Infinity', '1e400', '9e20', '1e15', '0.0001', '3.5', '0x10', '1,000', '１２３', '¥1,000円',
  'null', 'undefined', 'true', '[]', '{}', '"', "'", '\\', '/', '../', '../../etc/passwd', '%2e%2e%2f', '#/', '?a=1', '&', '<', '>',
  '<script>window.__xss=1</script>', '<img src=x onerror="window.__xss=1">', '"><svg onload=window.__xss=1>', "'); window.__xss=1; ('", '${7*7}', '{{7*7}}',
  '\u0000', '‮逆向き', '😀🏢', '𠮷野家', 'ｱｲｳｴｵ', 'Ä̷̡͝', 'a'.repeat(5000), '漢'.repeat(300), 'DROP TABLE owners;--', '__proto__', 'constructor', 'prototype',
];

export function str(r, max = 40) {
  if (r.chance(0.35)) return r.pick(NASTY);
  const pools = ['abcdefghijklmnopqrstuvwxyz', '0123456789', 'あいうえおかきくけこ管理建物部屋賃料', '<>"\'&/\\;:{}[]()#%', ' 　\t'];
  let s = ''; const n = r.int(max);
  for (let i = 0; i < n; i++) { const p = r.pick(pools); s += p[r.int(p.length)]; }
  return s;
}
export function num(r) {
  return r.pick([0, 1, -1, 50000, 1e7, 1e15, 9e20, Number.MAX_SAFE_INTEGER, 1.5, -99999, NaN, Infinity, '12,000', '１０００', 'abc', null, undefined, true, [], {}, r.int(200000)]);
}
export function anyValue(r, depth = 0) {
  const k = r.int(depth > 2 ? 4 : 7);
  if (k === 0) return str(r);
  if (k === 1) return num(r);
  if (k === 2) return r.chance(0.5);
  if (k === 3) return null;
  if (k === 4) return Array.from({ length: r.int(4) }, () => anyValue(r, depth + 1));
  const o = {}; for (let i = 0; i < r.int(5); i++) o[str(r, 8)] = anyValue(r, depth + 1); return o;
}

export class Tally {
  constructor() { this.n = {}; this.fail = []; }
  ok(area) { this.n[area] = (this.n[area] || 0) + 1; }
  bad(area, msg, ctx) { this.n[area] = (this.n[area] || 0) + 1; if (this.fail.length < 200) this.fail.push({ area, msg, ctx }); }
  check(area, cond, msg, ctx) { if (cond) this.ok(area); else this.bad(area, msg, ctx); return cond; }
  get total() { return Object.values(this.n).reduce((a, b) => a + b, 0); }
}
