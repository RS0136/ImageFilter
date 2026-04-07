# Open Filter Studio

ログイン不要で公開できる、**GitHub Pages対応の静的画像フィルターアプリ**です。  
特定製品のコード・素材・UIを流用せず、一般的な画像処理アルゴリズムを独自実装しています。

## 特徴

- 純粋な **HTML / CSS / JavaScript** だけで構成
- **約60種類**のフィルターを収録
- **複数画像レイヤー**の追加・前後入れ替え・移動・拡大縮小・回転に対応
- **お絵かきレイヤー**の追加、ブラシ / 消しゴム、色・サイズ・不透明度・柔らかさの調整に対応
- **レイヤーごとに独立したフィルタースタック**を追加・並べ替え・ON/OFF可能
- **比較表示**で元画像と加工後を見比べ可能
- **PNG / JPEG 書き出し**対応
- **ドラッグ＆ドロップ / ペースト**対応
- **GitHub Pages / GitHub Actions** でそのまま公開可能
- `.nojekyll` 同梱

## 実装済みフィルター

### 補正
- Brightness
- Contrast
- Exposure
- Gamma
- Saturation
- Vibrance
- Hue Shift
- Temperature & Tint
- RGB Balance
- Levels
- Auto Contrast
- Threshold
- Posterize
- Solarize
- Sepia
- Grayscale
- Invert
- Duotone / Gradient Map
- Colorize
- Vignette

### ぼかし・シャープ
- Box Blur
- Gaussian Blur
- Motion Blur
- Zoom Blur
- Sharpen
- Sharpen More
- Unsharp Mask
- High Pass
- Emboss
- Median Blur

### 補修・クリーニング
- Dust & Scratches

### 効果
- Edge Detect
- Outline
- Laplacian
- Pixelate
- Mosaic
- Noise
- Film Grain
- Scanlines
- Chromatic Aberration
- RGB Split
- Bloom
- Pencil Sketch
- Halftone
- Dither (Floyd-Steinberg)
- Dither (Bayer)
- Cartoon
- Retro Film
- Glitch
- Normal Map
- Crystallize
- Neon Edges

### 変形
- Ripple
- Wave
- Twirl
- Pinch
- Bulge
- Fisheye
- Offset
- Mirror

## ファイル構成

```text
.
├── .github/workflows/deploy-pages.yml
├── .nojekyll
├── LICENSE
├── README.md
├── app.js
├── index.html
└── styles.css
```

## すぐ試す

### ローカルで確認

```bash
python -m http.server 8000
```

その後、ブラウザで `http://localhost:8000` を開いてください。

## GitHub Pages で公開する方法

### 方法 1: GitHub Actions で公開（おすすめ）

1. このフォルダを GitHub リポジトリへ push
2. GitHub の **Settings → Pages** を開く
3. **Source** を **GitHub Actions** に変更
4. `main` ブランチへ push すると自動で公開

このリポジトリには `.github/workflows/deploy-pages.yml` が含まれているため、追加ビルド設定なしでそのまま使えます。

### 方法 2: ブランチ公開

1. このフォルダ一式をリポジトリのルートへ配置
2. GitHub の **Settings → Pages** を開く
3. **Deploy from a branch** を選ぶ
4. `main` ブランチ / `/ (root)` を選ぶ

`.nojekyll` が含まれているため、静的ファイルをそのまま配信しやすい構成です。

## 使い方

1. 「画像を開く」でベース画像を読み込みます
2. 「画像を追加」で画像レイヤーを重ねます
3. 選択ツールでドラッグ移動し、右側のレイヤー設定で拡大率や回転を調整します
4. 描画レイヤーを選び、ブラシ / 消しゴムのサイズ・不透明度・柔らかさを調整しながら描き込みます
5. フィルターを掛けたいレイヤーを選び、左側からそのレイヤー専用のフィルターを追加します
6. 比較表示で確認します
7. PNG または JPEG で書き出します

## 注意点

- すべてブラウザ内処理のため、**大きい画像 + レイヤー多数 + 重いフィルター** では遅くなります
- `Motion Blur`、`Zoom Blur`、`Crystallize`、`Halftone` などは比較的重めです
- 端末性能に応じて **プレビュー品質** を 75% / 50% / 25% に落とすと軽くなります
- AIモデルや外部APIは使っていません

## 権利面の前提

- 特定製品のプログラムや素材、ロゴ、スクリーンショットは同梱していません
- 一般的な画像処理アルゴリズムを独自に実装しています
- 公開前には、サービス名・説明文・比較表現が他社商標や誤認を招かないかを確認してください

## ライセンス

MIT License
