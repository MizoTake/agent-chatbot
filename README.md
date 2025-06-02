# Claude Slack App

Claude CodeをローカルサーバーでSlackと連携させるアプリケーション

## 機能

- **スラッシュコマンド**
  - `/claude <prompt>` - Claude Codeにチャット形式で質問
  - `/claude-code <prompt>` - コーディング特化のクエリ
- **メンション応答** - ボットをメンションして質問
- **ダイレクトメッセージ** - DMで直接会話

## セットアップ

### 1. 必要なもの

- Node.js (v14以上) またはDocker
- Claude Codeがローカルで実行中（デフォルト: http://localhost:5173）
- Slack ワークスペース管理権限

### 2. Slack App作成

1. [Slack API](https://api.slack.com/apps)にアクセス
2. "Create New App" → "From scratch"を選択
3. アプリ名を入力し、ワークスペースを選択

### 3. Slack App設定

#### Socket Mode有効化
- Settings → Socket Mode → Enable Socket Mode
- App-Level Tokenを生成（connections:write scope）

#### OAuth & Permissions
以下のBot Token Scopesを追加:
- `app_mentions:read`
- `chat:write`
- `commands`
- `im:history`
- `im:read`
- `im:write`

#### Event Subscriptions
- Enable Events → On
- Subscribe to bot events:
  - `app_mention`
  - `message.im`

#### Slash Commands
以下のコマンドを作成:
- `/claude` - Command: /claude, Request URL: 任意
- `/claude-code` - Command: /claude-code, Request URL: 任意

### 4. アプリケーションセットアップ

#### 方法1: Node.jsで直接実行

```bash
# リポジトリをクローン
git clone <repository-url>
cd claude-slack-app

# 依存関係インストール
npm install

# 環境変数設定
cp .env.example .env
# .envファイルを編集してSlackトークンを設定

# 開発モードで起動
npm run dev

# プロダクションビルド
npm run build
npm start
```

#### 方法2: Dockerを使用

```bash
# リポジトリをクローン
git clone <repository-url>
cd claude-slack-app

# 環境変数設定
cp .env.example .env
# .envファイルを編集してSlackトークンを設定

# Docker Composeで起動
docker-compose up -d

# ログを確認
docker-compose logs -f

# 停止
docker-compose down
```

#### 方法3: Dockerイメージを直接使用

```bash
# イメージをビルド
docker build -t claude-slack-app .

# コンテナを実行
docker run -d \
  --name claude-slack-app \
  -p 3000:3000 \
  --env-file .env \
  --add-host host.docker.internal:host-gateway \
  claude-slack-app
```

### 5. 環境変数

`.env`ファイルに以下を設定:

```env
# Slack App Configuration
SLACK_BOT_TOKEN=xoxb-your-bot-token       # OAuth & Permissions → Bot User OAuth Token
SLACK_SIGNING_SECRET=your-signing-secret   # Basic Information → Signing Secret
SLACK_APP_TOKEN=xapp-your-app-token       # Basic Information → App-Level Tokens

# Claude Code Server Configuration
CLAUDE_CODE_URL=http://localhost:5173      # Claude Codeサーバーのアドレス

# Server Port (optional)
PORT=3000
```

### 6. Slackワークスペースにインストール

1. Slack APIページでアプリを選択
2. "Install App" → "Install to Workspace"
3. 権限を確認して承認

## 使用方法

### スラッシュコマンド
```
/claude TypeScriptでFizzBuzzを書いて
/claude-code React Hooksの使い方を教えて
```

### メンション
```
@ClaudeBot Pythonでファイルを読み込む方法は？
```

### ダイレクトメッセージ
ボットとのDMチャンネルで直接メッセージを送信

## トラブルシューティング

- **"Claude Code server is not reachable"エラー**
  - Claude Codeがローカルで起動しているか確認
  - `CLAUDE_CODE_URL`が正しいか確認
  - Dockerの場合: `host.docker.internal:5173`を使用

- **Slackコマンドが反応しない**
  - Socket Modeが有効になっているか確認
  - App-Level Tokenが正しく設定されているか確認

- **権限エラー**
  - Bot Token Scopesが全て設定されているか確認
  - アプリを再インストール

- **Dockerネットワークエラー**
  - `docker-compose logs`でエラーを確認
  - ホストマシンのClaude Codeには`host.docker.internal`を使用

## 開発

```bash
# TypeScriptファイル変更を監視
npm run dev

# ビルド
npm run build

# タイプチェック
npx tsc --noEmit
```

## Docker設定詳細

### docker-compose.yml

- `host.docker.internal`を使用してホストマシンのClaude Codeに接続
- ヘルスチェック機能付き
- 自動再起動設定

### Dockerfile

- マルチステージビルドで軽量化
- Node.js 18 Alpine Linuxベース
- セキュリティのため非rootユーザーで実行

### カスタマイズ

Claude CodeもDockerで実行する場合は、`docker-compose.yml`のコメントアウトされた`claude-code`サービスを有効化してください。