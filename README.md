# WormBase Transcript Sequence Finder

`C. elegans` の WormBase transcript ID から、spliced cDNA、CDS、exon座標を取得するWebアプリです。annotation付きFASTA／GenBankファイルもダウンロードできます。

アプリはブラウザからWormBase REST APIを直接呼び出します。GitHub PagesではHTML・CSS・JavaScriptだけを配信し、専用サーバーやAPIキーは使用しません。

## ローカルで動かす

### 必要なもの

- Node.js 22以上
- Git

