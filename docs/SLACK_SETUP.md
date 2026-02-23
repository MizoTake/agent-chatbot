# Slack Bot セットアップガイド

## 前提条件

- Slackワークスペースの管理者権限
- Node.js 18以上
- Claude CLIがインストール済み

## セットアップ手順

### 1. Slack Appの作成

1. [Slack API](https://api.slack.com/apps)にアクセス
2. "Create New App" をクリック
3. "From scratch" を選択
4. App名とワークスペースを設定

### 2. Socket Modeの有効化

1. "Socket Mode" に移動
2. "Enable Socket Mode" をONにする
3. App-Level Tokenを生成（スコープ: `connections:write`）
4. トークンを保存（`SLACK_APP_TOKEN`として使用）

### 3. OAuth & Permissionsの設定

1. "OAuth & Permissions" に移動
2. 以下のBot Token Scopesを追加：
   - `app_mentions:read` - メンション読み取り
   - `channels:history` - チャンネル履歴読み取り
   - `channels:read` - チャンネル情報読み取り
   - `chat:write` - メッセージ送信
   - `commands` - スラッシュコマンド
   - `im:history` - DM履歴読み取り
   - `im:read` - DM情報読み取り
   - `im:write` - DM送信

3. "Install to Workspace" をクリック
4. Bot User OAuth Tokenを保存（`SLACK_BOT_TOKEN`として使用）

### 4. Event Subscriptionsの設定

1. "Event Subscriptions" に移動
2. "Enable Events" をONにする
3. 以下のBot Eventsを追加：
   - `app_mention` - ボットへのメンション
   - `message.channels` - チャンネルメッセージ
   - `message.im` - ダイレクトメッセージ

### 5. Slash Commandsの設定

以下のコマンドを追加：

1. `/agent`
   - Command: `/agent`
   - Short Description: Chat with Agent
   - Usage Hint: [your message]

2. `/agent-repo`
   - Command: `/agent-repo`
   - Short Description: Manage repository connection
   - Usage Hint: [git-url | status | delete | reset]

3. `/agent-help`
   - Command: `/agent-help`
   - Short Description: Show help

4. `/agent-status`
   - Command: `/agent-status`
   - Short Description: Check system status

5. `/agent-clear`
   - Command: `/agent-clear`
   - Short Description: Clear conversation context

6. `/agent-tool`
   - Command: `/agent-tool`
   - Short Description: List or switch tools

7. `/agent-skip-permissions`
   - Command: `/agent-skip-permissions`
   - Short Description: Toggle dangerous skip permissions mode

※ 互換用として `/claude*` 系を併用する場合は同様にSlack側へ追加してください。

### 6. Basic Informationからの設定

1. "Basic Information" に移動
2. "App Credentials" から Signing Secret を保存（`SLACK_SIGNING_SECRET`として使用）

### 7. 環境変数の設定

`.env`ファイルに以下を設定：

```env
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
SLACK_APP_TOKEN=xapp-your-app-token
```

### 8. ボットの起動

```bash
npm install
npm run build
npm start
```

## トラブルシューティング

### ボットが応答しない

1. Socket Modeが有効になっているか確認
2. App-Level Tokenに`connections:write`スコープがあるか確認
3. ボットがチャンネルに招待されているか確認
4. ログを確認: `npm run dev`

### 権限エラー

1. Bot Token Scopesがすべて追加されているか確認
2. ワークスペースに再インストール
3. トークンが正しく設定されているか確認

### Socket Mode接続エラー

1. App-Level Tokenが正しいか確認
2. インターネット接続を確認
3. ファイアウォール設定を確認
