# 紹介動画（3分）の作り方

アプリを実際に動かして録画し、BGM・効果音を合成して1本の MP4 にします。外部の音源・サービスは使いません。

```bash
PORT=8791 npm start                         # 別のターミナルで（初期データの状態で）
cd scripts/video
node record.cjs                             # 収録（約3分）→ raw/*.webm と timeline.json
python3 music.py timeline.json audio.wav    # BGM・タップ音・場面転換の音
ffmpeg -i raw/*.webm -i audio.wav -t 180 -c:v libx264 -crf 20 -pix_fmt yuv420p -r 30 \
  -af volume=4dB -c:a aac -b:a 192k -movflags +faststart ../../video/REVO_ASSET_紹介動画.mp4
```

- 場面と字幕は `record.cjs`（各場面の開始秒も同じファイル）、見た目は `stage.html`
- ナレーションを入れる場合は、場面ごとの開始秒（`timeline.json` の `marks`）に合わせて音声を重ねる
