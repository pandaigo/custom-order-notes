# Chrome拡張テンプレート

新しい拡張を作るときにこのフォルダをコピーして使う。

## セットアップ手順

1. `_template` フォルダをコピーして拡張名にリネーム
2. 全ファイルの `EXTENSION_NAME` `EXTENSION_ID` `TODO` を置換
3. `npm install`
4. `npm run icons` でアイコン生成（SVGを先に編集）
5. ExtensionPay で拡張を登録し、IDを `background.js` と `popup.js` に設定
6. `npm run build` で確認
7. `npm run zip` で提出用ZIP作成

## 置換が必要なプレースホルダー

| プレースホルダー | 説明 | 例 |
|----------------|------|-----|
| EXTENSION_NAME | 表示名 | QuickReply Templates |
| EXTENSION_ID | ExtensionPay登録ID・パッケージ名 | quickreply-templates |
| TODO | 拡張固有の内容 | — |
| YYYY-MM-DD | 日付 | 2026-05-03 |
| TODO_DESCRIPTION | 拡張の説明（プライバシーポリシー用） | — |
| TODO_TAGLINE | キャッチコピー（LP用） | — |

## GitHub Pages（プライバシーポリシー・LP公開）

1. GitHubリポジトリを **public** で作成（GitHub Pages無料利用に必要）
   ```
   gh repo create pandaigo/EXTENSION_ID --public --source=. --push
   ```
2. GitHub Pagesを有効化（masterブランチ、ルート）
   ```
   gh api repos/pandaigo/EXTENSION_ID/pages -X POST -f "build_type=legacy" -f "source[branch]=master" -f "source[path]=/"
   ```
3. 公開URL:
   - LP: `https://pandaigo.github.io/EXTENSION_ID/`
   - プライバシーポリシー: `https://pandaigo.github.io/EXTENSION_ID/store/privacy-policy.html`
4. CWS提出時・ExtensionPay登録時にこのURLを使う

## 特商法ページ

全拡張共通で `https://microforge-hq.pages.dev/tokushoho.html` を使用。
拡張ごとに個別作成は不要。Stripe審査で必要。

## CWSストアアセット

### 推奨ワークフロー（自動化）

1. **e2e でスクショを取得** ← `npm run e2e` を WSL2 で実行（後述「自動テスト」セクション参照）
   - `screenshots/` に PNG が13-16枚保存される（CRUD・モーダル・ダーク等）
2. **`scripts/gen-store-assets.mjs` の `targets` を編集** ← e2e で撮ったスクショから掲載5枚を選んでキャプションを書く
3. **`npm run store-assets` を実行** ← 以下が自動生成される:
   - プロモタイル: `store/promo-small-440x280.png` + `.svg`
   - スクショ: `store/screenshots/screenshot-1〜5-1280x800.png` + `.svg`
4. **微調整は SVG を Figma で開いて編集** → PNG 再エクスポート

### 設計指針（lessons-learned 参照）

**プロモタイル**:
- **値段は載せない**（CWSタイル下部にインストール数/星が自動表示される、値上げ時の差し替え回避）
- **主見出し 46pt 以上、サブコピー 20pt 以上**（220x140 縮小時の可読性）
- **差し色1点で視線フック**（「No Subscription」のうち「No」だけ赤、CTR +15-25%）

**スクリーンショット**:
- **順序は 機能 → 課金**（購買動機を喚起してから価格提示、1枚目に課金モーダルを置くと離脱）
- **キャプションは句読点を全体ありか全体なしで統一**（混在は素人感）
- **mode 指定**: popup単体は `'popup'`（左上 380x500 抽出して 1.3倍）、モーダルは `'fullscreen'`（800x700 全体縮小）

### 出力先

- `store/promo-small-440x280.svg` + `.png`（プロモタイル）
- `store/screenshots/screenshot-1〜5-1280x800.svg` + `.png`（スクショ）

## 含まれるもの

- ExtensionPay統合済み（background.js, popup.js）
- Freemiumゲート（アップグレードモーダル）
- ビルド・ZIP・アイコン生成スクリプト
- CWSストア提出用テンプレート（description.txt）
- プライバシーポリシー・LP（GitHub Pages用）
- 自動テストスクリプト（smoke / e2e）
- .gitignore

## 自動テスト

### smoke（必須・軽量）

`npm run smoke` で以下を機械的に検査:

- manifest.json の妥当性（MV3、description長、`<all_urls>`なし）
- popup.html ↔ popup.js の ID 整合性
- CSP適合（インラインscript・onclick・javascript:URL なし）
- JS 文法チェック
- 必須ファイル存在確認

数秒で完了。出荷前に必ず通すこと。

### e2e（推奨・拡張固有のロジック検証）

Puppeteer で実際の Chrome 拡張をロードして popup を操作する。

**Windows ローカル実行は注意**:
プロファイルロックで失敗するケース多数。WSL2(Ubuntu) + xvfb で実行するのが推奨。

**WSL2 での初期セットアップ**（一度だけ）:
```bash
wsl -u root -d Ubuntu -- bash -lc '
DEBIAN_FRONTEND=noninteractive apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
  libnss3 libnspr4 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 \
  libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
  libgbm1 libpango-1.0-0 libcairo2 libasound2t64 libxshmfence1 \
  fonts-liberation rsync curl ca-certificates xvfb
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
'
```

**E2E 実行**:
```bash
wsl -u root -d Ubuntu -- bash -lc '
rsync -a --exclude=node_modules --exclude="*.zip" --exclude=_zip_tmp --exclude=screenshots \
  "/mnt/c/Users/dgfuj/Documents/Chrome拡張機能/EXTENSION_ID/" /root/qcn/
cd /root/qcn
[ -d node_modules ] || npm install --silent
xvfb-run --auto-servernum npm run e2e
mkdir -p "/mnt/c/Users/dgfuj/Documents/Chrome拡張機能/EXTENSION_ID/screenshots"
rsync -a --delete /root/qcn/screenshots/ "/mnt/c/Users/dgfuj/Documents/Chrome拡張機能/EXTENSION_ID/screenshots/"
'
```

スクリーンショットは `screenshots/` に保存される。

**E2E でカバーできない（手動テスト必須）**:
- 右クリック→ contextMenu からの保存
- グローバルキーボードショートカット起動
- `chrome.alarms` の通知（時刻待ち必要）
- ExtensionPay の実決済フロー
- Edge 互換性

これらは Chrome に手動インストールして 5-10 分で確認する。
