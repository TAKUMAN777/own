# 紹介動画の音（BGM・タップ音・場面転換）をその場で合成する。外部の音源は使わない
import json, sys, wave
import numpy as np

SR = 44100
DUR = 180.0
N = int(SR * DUR)
t_all = np.arange(N) / SR
L = np.zeros(N); R = np.zeros(N)
rng = np.random.default_rng(7)

BPM = 96
BEAT = 60 / BPM
BAR = BEAT * 4

def hz(n):  # MIDI → 周波数
    return 440.0 * 2 ** ((n - 69) / 12)

# I–V–vi–IV（C, G/B, Am, F）
CHORDS = [[60, 64, 67, 72], [59, 62, 67, 71], [57, 60, 64, 69], [53, 57, 60, 65]]
ROOTS = [36, 43, 45, 41]

def add(sig, start, pan=0.0, gain=1.0):
    i = int(start * SR)
    if i >= N: return
    sig = sig[: N - i] * gain
    L[i:i + len(sig)] += sig * (1 - pan) / 2 * 2 ** 0.5
    R[i:i + len(sig)] += sig * (1 + pan) / 2 * 2 ** 0.5

def lowpass(x, a=0.05):
    y = np.empty_like(x); acc = 0.0
    # 1次のローパス（ベクトル化のため指数移動平均を scipy なしで）
    for k in range(0, len(x), 4096):
        seg = x[k:k + 4096]
        out = np.empty_like(seg)
        for j, v in enumerate(seg):
            acc += a * (v - acc); out[j] = acc
        y[k:k + 4096] = out
    return y

def pad(notes, dur):
    n = int(dur * SR); t = np.arange(n) / SR
    s = np.zeros(n)
    for m in notes:
        f = hz(m)
        for det in (-0.12, 0.0, 0.11):  # 少しずらして厚みを出す
            ff = f * 2 ** (det / 12)
            s += np.sin(2 * np.pi * ff * t) * 0.6 + np.sin(2 * np.pi * 2 * ff * t) * 0.18 + np.sin(2 * np.pi * 3 * ff * t) * 0.06
    env = np.minimum(1, t / 0.6) * np.minimum(1, (dur - t) / 0.5).clip(0, 1)
    return s * env / (len(notes) * 3)

def pluck(m, dur=0.5):
    n = int(dur * SR); t = np.arange(n) / SR; f = hz(m)
    s = (np.sin(2 * np.pi * f * t) + 0.35 * np.sin(2 * np.pi * 2 * f * t) + 0.12 * np.sin(2 * np.pi * 3 * f * t)) * np.exp(-t * 7)
    return s * np.minimum(1, t / 0.004)

def bass(m, dur):
    n = int(dur * SR); t = np.arange(n) / SR; f = hz(m)
    s = np.sin(2 * np.pi * f * t) + 0.25 * np.sin(2 * np.pi * 2 * f * t)
    return s * np.minimum(1, t / 0.01) * np.exp(-t * 2.2)

def kick():
    n = int(0.25 * SR); t = np.arange(n) / SR
    f = 110 * np.exp(-t * 18) + 45
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 14)

def hat():
    n = int(0.06 * SR); t = np.arange(n) / SR
    x = rng.standard_normal(n); x = x - np.concatenate([[0], x[:-1]])  # 高い音だけ残す
    return x * np.exp(-t * 70) * 0.25

# 盛り上がりの設計：0-8 はパッドだけ、8- アルペジオ、20- 低音とリズム、168- 静かに締める
nbars = int(DUR / BAR) + 1
arp_pattern = [0, 1, 2, 3, 2, 1, 2, 3]
for b in range(nbars):
    st = b * BAR
    if st >= DUR: break
    c = CHORDS[b % 4]
    add(pad(c, BAR + 0.4), st, gain=0.55)
    if 8 <= st < 170:
        for k, idx in enumerate(arp_pattern):
            add(pluck(c[idx] + 12, 0.45), st + k * BEAT / 2, pan=(-0.35 if k % 2 else 0.35), gain=0.16)
    if 20 <= st < 168:
        add(bass(ROOTS[b % 4], BEAT * 2), st, gain=0.35)
        add(bass(ROOTS[b % 4], BEAT * 2), st + BEAT * 2, gain=0.28)
        for k in range(4):
            add(kick(), st + k * BEAT, gain=0.22 if k % 2 == 0 else 0.12)
            add(hat(), st + k * BEAT + BEAT / 2, pan=0.2, gain=0.5)
# 最後の和音（長く伸ばす）
add(pad([48, 60, 64, 67, 72], 9.0), 170.5, gain=0.6)

mix = np.stack([L, R])
# パッドのざらつきを少し丸める（左右それぞれ）
mix = np.stack([lowpass(mix[0], 0.35), lowpass(mix[1], 0.35)])

# ---- 効果音（タップ・場面転換）----
tl = json.load(open(sys.argv[1]))
def tap_sfx():
    n = int(0.09 * SR); t = np.arange(n) / SR
    return (np.sin(2 * np.pi * 1650 * t) * 0.6 + np.sin(2 * np.pi * 2480 * t) * 0.3) * np.exp(-t * 55)
def whoosh():
    n = int(0.7 * SR); t = np.arange(n) / SR
    x = rng.standard_normal(n)
    x = lowpass(x, 0.08) * 3
    env = np.sin(np.pi * t / 0.7) ** 2
    return x * env * 0.5
sfx = np.zeros((2, N))
def put(sig, at, g):
    i = int(at * SR)
    if 0 <= i < N:
        s = sig[: N - i] * g
        sfx[0, i:i + len(s)] += s; sfx[1, i:i + len(s)] += s
for at in tl['taps']:
    put(tap_sfx(), at - 0.25, 0.35)  # 波紋が出た瞬間に合わせる
for k, at in tl['marks'].items():
    put(whoosh(), at - 0.35, 0.18)

# 全体の音量：BGM は控えめ（ナレーションを後から足せるように）
mix = mix / np.max(np.abs(mix)) * 0.42 + sfx
fade_in = np.minimum(1, t_all / 2.0)
fade_out = np.clip((DUR - t_all) / 4.0, 0, 1)
mix *= fade_in * fade_out
mix = np.clip(mix / max(1.0, np.max(np.abs(mix)) / 0.89), -1, 1)

pcm = (mix.T * 32767).astype('<i2')
with wave.open(sys.argv[2], 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
print('ok', sys.argv[2])
