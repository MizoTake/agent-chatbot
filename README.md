# Agent Chatbot

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://www.typescriptlang.org/)

Claude / Codex / vibe-local などのCLIエージェントをSlackとDiscordに統合し、Gitリポジトリのコンテキスト認識機能を備えたAIアシスタントを提供するマルチプラットフォームボットです。

## 🌟 機能

- **マルチプラットフォーム対応**: SlackとDiscordの両方で動作
- **リポジトリコンテキスト**: チャンネルごとにGitリポジトリをクローンして管理
- **マルチAI CLI統合**: Claude / Codex / vibe-local を既定サポート（設定次第でGemini/Aider等も追加可能）
- **スレッド返信**: チャンネルメッセージにスレッドで応答
- **Socket Mode**: パブリックURLを必要としない簡単なセットアップ（Slack）
- **グレースフルシャットダウン**: 適切なシグナル処理とクリーンアップ
- **構造化ログ**: JSONと人間が読みやすいログ形式
- **エラー回復**: 指数バックオフによる自動リトライ
- **セキュリティ**: 入力検証とサニタイゼーション

## 📦 必要な環境

- Node.js 18以上とnpm
- 次のいずれか1つ以上のCLIが利用可能であること
  - [Claude CLI](https://claude.ai/download)
  - [Codex CLI](https://github.com/openai/codex)
  - [vibe-local](https://github.com/ochyai/vibe-local)（利用時は Ollama も必要）
  - Claude以外を既定にする場合は `AGENT_CHATBOT_TOOLS_DEFAULTTOOL` か `/agent-tool use <name>` で切り替え
- Slack用: 管理者アクセス権限を持つワークスペース
- Discord用: ボット管理権限を持つサーバー
- Git（リポジトリ機能用）

## 🚀 クイックスタート

1. リポジトリをクローン:
   ```bash
   git clone https://github.com/MizoTake/agent-chatbot.git
   cd agent-chatbot
   ```

2. 依存関係をインストール:
   ```bash
   npm install
   ```

3. 環境変数を設定:

   プロジェクトルートに `.env` ファイルを作成:
   ```env
   # Slack Bot設定（オプション）
   SLACK_BOT_TOKEN=xoxb-your-bot-token
   SLACK_SIGNING_SECRET=your-signing-secret
   SLACK_APP_TOKEN=xapp-your-app-token

   # Discord Bot設定（オプション）
   DISCORD_BOT_TOKEN=your-discord-bot-token

   # サーバー設定
   PORT=3000

   # ログ設定
   LOG_LEVEL=info        # debug, info, warn, error
   LOG_FORMAT=human      # human または json

   # デバッグモード
   DEBUG=false
   ```

4. ビルドしてボットを起動:
   ```bash
   npm run build
   npm start
   ```

## 🚀 使用方法

### ボットの起動

**開発モード:**
```bash
npm run dev
```

**テスト実行:**
```bash
npm test
```

**本番モード:**
```bash
npm start
```

**スクリプトを使用:**
```bash
./scripts/start.sh       # ローカルで起動（フォアグラウンド）
./scripts/stop.sh        # ボットを停止
./scripts/restart.sh     # ボットを再起動
```

### ボットコマンド

#### 一般的なコマンド
- **ダイレクトメッセージ**: ボットに直接メッセージを送信
- **チャンネルメンション**: `@ボット名 メッセージ`
- **スラッシュコマンド**:
  - `/agent <プロンプト>` - 現在の既定ツールでプロンプトを送信
  - `/agent --tool <name> <プロンプト>` - 1回だけ実行ツールを指定（例: `claude` / `codex` / `vibe-local`）
  - `/agent-tool status` - 現在の有効ツールを確認
  - `/agent-tool list` - 設定済みツールとCLI検出状態を確認
  - `/agent-tool use <name>` - このチャンネルの既定ツールを変更
  - `/agent-tool clear` - チャンネル既定ツールを解除
  - `/agent-repo <URL>` - リポジトリをクローンしてリンク
  - `/agent-repo status` - リポジトリの状態を確認
  - `/agent-repo delete` - リポジトリのリンクを削除
  - `/agent-repo reset` - すべてのチャンネルのリポジトリリンクをリセット
  - `/agent-help` - コマンドのヘルプを表示
  - `/agent-status` - 現在の有効ツールとリポジトリの状態を確認
  - `/agent-clear` - 会話のコンテキストをクリア
  - `/agent-skip-permissions` - --dangerously-skip-permissionsフラグの切り替え
  - `/agent-skip-permissions on/off` - 権限スキップモードの有効化/無効化
    - ⚠️ **注意**: root権限で実行時は、`CLAUDE_FORCE_ALLOW_ROOT=true`を設定するか、`CLAUDE_RUN_AS_USER`で別ユーザーを指定してください（この設定は `supportsSkipPermissions=true` のツールに適用）
  - 互換エイリアスとして `/claude*` 系コマンドも引き続き利用可能

利用ツールを切り替える例:
```text
/agent-tool list
/agent-tool use codex
```

### リポジトリ統合

チャンネルにGitリポジトリをリンクして、現在有効なCLIツールにコンテキストを提供:

```
/agent-repo https://github.com/user/repo.git
```

一度リンクされると、そのチャンネルでのすべての `/agent` コマンドがリポジトリのコードにアクセスできるようになります。

## ⚙️ 設定

### 環境変数

**Slack設定:**
- `SLACK_BOT_TOKEN`: Bot User OAuth Token (xoxb-...)
- `SLACK_SIGNING_SECRET`: App Signing Secret
- `SLACK_APP_TOKEN`: Socket Mode用のApp-Level Token (xapp-...)

**Discord設定:**
- `DISCORD_BOT_TOKEN`: Discord Bot Token

**一般設定:**
- `PORT`: ヘルスチェックサーバーのポート（デフォルト: 3000）
- `LOG_LEVEL`: ログレベル（debug/info/warn/error）
- `LOG_FORMAT`: ログ形式（human/json）
- `DEBUG`: デバッグ出力を有効化（true/false）
- `AGENT_CHATBOT_TOOLS_DEFAULTTOOL`: 既定ツール名（例: `claude`, `codex`, `vibe-local`）
- `AGENT_CHATBOT_APP_NAME`: Slack/Discordの表示名を固定したい場合に指定（未指定時は既定ツール名を使用）

**権限設定（Claude CLI利用時）:**
- `CLAUDE_FORCE_ALLOW_ROOT`: root権限での--dangerously-skip-permissions使用を許可（true/false）
- `CLAUDE_RUN_AS_USER`: --dangerously-skip-permissions使用時に実行するユーザー名（デフォルト: agent-chatbot）

**vibe-local設定（必要な場合）:**
- `OLLAMA_HOST`: Ollama API endpoint
- `VIBE_LOCAL_MODEL`: メインモデル
- `VIBE_LOCAL_SIDECAR_MODEL`: サイドカーモデル
- `VIBE_LOCAL_DEBUG`: デバッグログ（`1`で有効）

**Codex設定（必要な場合）:**
- `CODEX_API_KEY`: Codex CLIをAPIキー運用する場合のみ設定

### ファイル構造

```
agent-chatbot/
├── src/
│   ├── adapters/        # プラットフォーム固有のアダプター
│   ├── config/          # 設定と検証
│   ├── interfaces/      # TypeScriptインターフェース
│   ├── services/        # ビジネスロジックサービス
│   ├── utils/           # ユーティリティ関数
│   ├── BotManager.ts    # ボット中央コーディネーター
│   ├── toolCLIClient.ts # AIツールCLIラッパー（Claude/Codex/vibe-local等）
│   └── index.ts         # アプリケーションエントリーポイント
├── config/              # 設定ファイル
├── docs/                # ドキュメント
├── scripts/             # シェルスクリプト
└── repositories/        # クローンされたGitリポジトリ
```

### 追加ツールの設定例

デフォルトで `claude` / `codex` / `vibe-local` は定義済みです。  
`agent-chatbot.yml` の `tools.definitions` にCLI定義を追加すると、さらに他のツールも利用できます。

```yaml
tools:
  defaultTool: codex
  definitions:
    gemini:
      command: gemini
      args: ["chat", "--prompt", "{prompt}"]
      versionArgs: ["--version"]
      description: Google Gemini CLI
```

`{prompt}` はユーザー入力に置換されます。`args`/`versionArgs` は各CLIの仕様に合わせて調整してください。

## 📖 ドキュメント

- [Slackセットアップガイド](./docs/SLACK_SETUP.md)
- [Discordセットアップガイド](./docs/DISCORD_SETUP.md)
- [リポジトリ機能](./docs/REPOSITORY_FEATURE.md)
- [タイムアウト設定](./docs/TIMEOUT_LIMITS.md)
- [開発ガイド](./CLAUDE.md)

## 🔒 権限設定 (root環境での実行・Claude CLI利用時)

root権限で実行する場合、`--dangerously-skip-permissions`フラグを使用するには専用ユーザーのセットアップが必要です：

```bash
# agent-chatbotユーザーをセットアップ
sudo ./scripts/setup-agent-user.sh

# 認証情報を共有（rootで認証済みの場合）
sudo ./scripts/share-agent-auth.sh

# または、既存のnobodyユーザー用にセットアップ（非推奨）
sudo ./scripts/setup-agent-for-nobody.sh
```

セットアップ後、以下のいずれかの方法で使用：
- 環境変数: `export CLAUDE_RUN_AS_USER=agent-chatbot`
- 強制許可: `export CLAUDE_FORCE_ALLOW_ROOT=true` (セキュリティリスクあり)

## 🔧 トラブルシューティング

### ボットが応答しない
1. 環境変数が正しく設定されているか確認
2. 使用するCLIがインストールされているか確認（例: `claude --version` / `codex --version` / `vibe-local --version`）
3. ログを確認: `npm run dev`
4. ボットがチャンネル/サーバーに招待されているか確認
5. チャンネル/サーバー設定でボットの権限を確認

### 接続の問題
- **Slack**: app-levelトークンに`connections:write`スコープがあるか確認
- **Discord**: ボットトークンとインテントが設定されているか確認
- 1つのインスタンスのみが実行されていることを確認

### リポジトリ機能
- Gitがインストールされアクセス可能か確認
- `repositories/`ディレクトリへの書き込み権限を確認
- リポジトリURLがアクセス可能か確認

## 🔮 今後の展望

このプロジェクトの改善提案については[IMPROVEMENT_PROPOSALS.md](IMPROVEMENT_PROPOSALS.md)を参照してください。

主な改善予定：
- 🧪 テスト基盤の拡充
- 💾 会話履歴の永続化
- 🔌 プラグインシステム
- 📊 メトリクスとダッシュボード
- 🔐 高度なセキュリティ機能

## 📄 ライセンス

このプロジェクトはMITライセンスの下でライセンスされています - 詳細は[LICENSE](LICENSE)ファイルを参照してください。

---
