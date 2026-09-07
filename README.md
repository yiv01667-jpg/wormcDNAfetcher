# WormBase Transcript Sequence Finder

`C. elegans` の WormBase transcript ID から、spliced cDNA、CDS、exon座標を取得するWebアプリです。annotation付きFASTA／GenBankファイルもダウンロードできます。

アプリはブラウザからWormBase REST APIを直接呼び出します。GitHub PagesではHTML・CSS・JavaScriptだけを配信し、専用サーバーやAPIキーは使用しません。

## ローカルで動かす

### 必要なもの

- Node.js 22以上
- Git

### 起動

```bash
npm install
npm run dev
```

表示されたURL（通常は `http://localhost:3000`）をブラウザで開きます。

## GitHub Pagesで公開する

以下はGitHub Pagesを初めて使う場合の手順です。

### 1. GitHubで新しいrepositoryを作る

1. [GitHub](https://github.com/) にサインインします。
2. 画面右上の `+` → `New repository` を選びます。
3. `Repository name` に任意の名前を入力します。例: `wormbase-transcript-finder`
4. GitHub Freeを利用する場合は `Public` を選びます。
5. `Add a README file` などの初期化項目は選択せず、空のrepositoryとして作成します。
6. `Create repository` を押します。

### 2. このフォルダをGit repositoryにしてpushする

ターミナルでこのプロジェクトのフォルダを開き、次を実行します。`YOUR-USERNAME` と `YOUR-REPOSITORY` は自分の値に置き換えてください。

```bash
git init
git add .
git commit -m "Initial GitHub Pages version"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPOSITORY.git
git push -u origin main
```

GitHubへの認証を求められた場合は、画面の案内に従ってブラウザでサインインしてください。GitHubのパスワードをターミナルへ直接入力する方式ではなく、Git Credential Managerまたはpersonal access tokenを使う場合があります。

### 3. GitHub Pagesの公開元をActionsにする

1. GitHubで作成したrepositoryを開きます。
2. `Settings` → 左側の `Pages` を開きます。
3. `Build and deployment` の `Source` で `GitHub Actions` を選びます。
4. `Actions` タブを開き、`Deploy to GitHub Pages` workflowが完了するまで待ちます。

成功すると、Pages画面またはworkflowのdeploy stepに公開URLが表示されます。通常は次の形式です。

```text
https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/
```

以後は `main` branchへpushするたびに、自動的に再ビルド・再公開されます。

```bash
git add .
git commit -m "Update application"
git push
```

### 4. workflowが失敗した場合

- `Settings` → `Pages` → `Source` が `GitHub Actions` になっているか確認します。
- `Actions` タブで失敗したrunを開き、赤くなっているstepを確認します。
- repositoryのdefault branchが `main` 以外の場合は、`.github/workflows/deploy-pages.yml` の `branches: [main]` を実際のbranch名に変更します。
- 初回だけPagesの有効化後にworkflowを再実行する必要がある場合があります。`Actions` → workflow → `Run workflow` から手動実行できます。

## GitHub Pages用ビルド

ローカルで静的出力を確認する場合:

```bash
PAGES_BASE_PATH=/YOUR-REPOSITORY npm run build:pages
```

生成物は `out/` に出力されます。GitHub Actionsでは `actions/configure-pages` が公開URLのbase pathを自動検出するため、repository名をコードへ直接書く必要はありません。ユーザーサイト用repository（`YOUR-USERNAME.github.io`）ではbase pathは空になります。

通常の `npm run dev` と `npm run build` は従来どおり動作します。GitHub Pages用の静的exportは `npm run build:pages` のときだけ有効になります。

## WormBase APIとCORS

アプリが利用する `https://rest.wormbase.org` は、現在のレスポンスで `Access-Control-Allow-Origin: *` を返すため、GitHub Pagesのoriginから直接取得できます。APIキーやproxy serverは不要です。

ただし、これはWormBase側の運用に依存します。将来CORSポリシーが変更された場合、ブラウザだけのGitHub Pagesからは取得できなくなります。その場合はCloudflare Worker、GitHub以外のserverless function、または自前API proxyを追加し、許可するtranscript IDと転送先を制限する方法が安全です。公開proxyを無制限に中継する構成にはしないでください。

## コマンド

- `npm run dev`: ローカル開発サーバー
- `npm run build`: 現在のvinextビルド
- `npm run build:pages`: GitHub Pages用の静的export（`out/`）
- `npm test`: ビルドとGenBank整合性テスト
- `npm run test:genbank`: WormBase実データを使うGenBankテスト

## 自動deployの構成

`.github/workflows/deploy-pages.yml` は次を実行します。

1. ソースコードをcheckout
2. Node.js 22をセットアップ
3. GitHub Pagesのbase pathを検出
4. `npm ci` と静的ビルドを実行
5. `out/` をPages artifactとしてアップロード
6. GitHub Pagesへdeploy
