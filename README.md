# Claude Slack/Discord ボット

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://www.typescriptlang.org/)

Claude CLIをSlackとDiscordに統合し、Gitリポジトリのコンテキスト認識機能を備えたAIアシスタントを提供するマルチプラットフォームボットです。

## 🌟 機能

- **マルチプラットフォーム対応**: SlackとDiscordの両方で動作
- **リポジトリコンテキスト**: チャンネルごとにGitリポジトリをクローンして管理
- **Claude CLI統合**: Claudeの機能に直接アクセス
- **スレッド管理**: スレッド内で会話のコンテキストを維持
- **Socket Mode**: パブリックURLを必要としない簡単なセットアップ（Slack）
- **グレースフルシャットダウン**: 適切なシグナル処理とクリーンアップ
- **構造化ログ**: JSONと人間が読みやすいログ形式
- **エラー回復**: 指数バックオフによる自動リトライ
- **セキュリティ**: 入力検証とサニタイゼーション

## 📦 必要な環境

- Node.js 18以上とnpm
- [Claude CLI](https://claude.ai/download) がインストールされ設定済みであること
- Slack用: 管理者アクセス権限を持つワークスペース
- Discord用: ボット管理権限を持つサーバー
- Git（リポジトリ機能用）

## 🚀 クイックスタート

1. リポジトリをクローン:
   ```bash
   git clone https://github.com/yourusername/claude-slack-discord-bot.git
   cd claude-slack-discord-bot
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

**本番モード:**
```bash
npm start
```

**スクリプトを使用:**
```bash
./scripts/start.sh       # バックグラウンドで起動
./scripts/stop.sh        # ボットを停止
./scripts/restart.sh     # ボットを再起動
```

### ボットコマンド

#### 一般的なコマンド
- **ダイレクトメッセージ**: ボットに直接メッセージを送信
- **チャンネルメンション**: `@ボット名 メッセージ`
- **スラッシュコマンド**:
  - `/claude <プロンプト>` - Claudeにプロンプトを送信
  - `/claude-repo <URL>` - リポジトリをクローンしてリンク
  - `/claude-repo status` - リポジトリの状態を確認
  - `/claude-repo delete` - リポジトリのリンクを削除
  - `/claude-repo reset` - すべてのチャンネルのリポジトリリンクをリセット
  - `/claude-help` - コマンドのヘルプを表示
  - `/claude-status` - Claude CLIとリポジトリの状態を確認
  - `/claude-clear` - 会話のコンテキストをクリア

### リポジトリ統合

チャンネルにGitリポジトリをリンクしてClaudeにコンテキストを提供:

```
/claude-repo https://github.com/user/repo.git
```

一度リンクされると、そのチャンネルでのすべてのClaudeコマンドがリポジトリのコードにアクセスできるようになります。

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

### ファイル構造

```
claude-slack-app/
├── src/
│   ├── adapters/        # プラットフォーム固有のアダプター
│   ├── config/          # 設定と検証
│   ├── interfaces/      # TypeScriptインターフェース
│   ├── services/        # ビジネスロジックサービス
│   ├── utils/           # ユーティリティ関数
│   ├── BotManager.ts    # ボット中央コーディネーター
│   ├── claudeCLIClient.ts # Claude CLIラッパー
│   └── index.ts         # アプリケーションエントリーポイント
├── config/              # 設定ファイル
├── docs/                # ドキュメント
├── scripts/             # シェルスクリプト
└── repositories/        # クローンされたGitリポジトリ
```

## 📖 ドキュメント

- [Slackセットアップガイド](./docs/SLACK_SETUP.md)
- [Discordセットアップガイド](./docs/DISCORD_SETUP.md)
- [リポジトリ機能](./docs/REPOSITORY_FEATURE.md)
- [タイムアウト設定](./docs/TIMEOUT_LIMITS.md)
- [開発ガイド](./CLAUDE.md)

## 🔧 トラブルシューティング

### ボットが応答しない
1. 環境変数が正しく設定されているか確認
2. Claude CLIがインストールされているか確認: `claude --version`
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
- 🧪 テスト基盤の構築
- 💾 会話履歴の永続化
- 🔌 プラグインシステム
- 📊 メトリクスとダッシュボード
- 🔐 高度なセキュリティ機能

## 📄 ライセンス

このプロジェクトはMITライセンスの下でライセンスされています - 詳細は[LICENSE](LICENSE)ファイルを参照してください。

---

*このプロジェクトは[Claude Code](https://claude.ai/code)を使用して生成されました。*