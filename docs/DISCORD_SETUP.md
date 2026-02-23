# Discord Bot セットアップガイド

## エラー: "Used disallowed intents" の解決方法

このエラーは、Discord Developer PortalでボットのIntents（権限）が有効化されていない場合に発生します。

## Discord Developer Portalでの設定手順

### 1. Discord Developer Portalにアクセス
1. [Discord Developer Portal](https://discord.com/developers/applications)にログイン
2. 対象のアプリケーションを選択

### 2. Bot設定でIntentsを有効化

1. 左側メニューから「Bot」を選択
2. 「Privileged Gateway Intents」セクションまでスクロール
3. 以下のIntentsをONにする：
   - **MESSAGE CONTENT INTENT** ✅ （必須）
   - **PRESENCE INTENT** ✅ （推奨）
   - **SERVER MEMBERS INTENT** ✅ （推奨）

4. 「Save Changes」をクリック

### 3. ボットの権限設定

1. 左側メニューから「OAuth2」→「URL Generator」を選択
2. **Scopes**で以下を選択：
   - `bot`
   - `applications.commands`

3. **Bot Permissions**で以下を選択：
   - `Send Messages`
   - `Read Message History`
   - `Use Slash Commands`
   - `Embed Links`
   - `Attach Files`
   - `Read Messages/View Channels`
   - `Add Reactions`

4. 生成されたURLをコピー

### 4. ボットをサーバーに再招待

1. 生成されたURLをブラウザで開く
2. ボットを追加したいサーバーを選択
3. 権限を確認して「認証」をクリック

### 5. アプリケーションを再起動

```bash
# 停止
./scripts/stop.sh

# 再起動
./scripts/start.sh
```

## トラブルシューティング

### それでもエラーが続く場合

1. **トークンの再生成**
   - Bot設定で「Reset Token」をクリック
   - 新しいトークンを`.env`ファイルに設定

2. **キャッシュのクリア**
   ```bash
   rm -rf node_modules
   npm install
   ```

3. **Intentsの確認**
   - Developer Portalで全てのIntentsが保存されているか確認
   - ページをリロードして設定が維持されているか確認

### 重要な注意事項

- **MESSAGE CONTENT INTENT**は2022年9月以降、100サーバー以上のボットでは審査が必要
- 開発段階では問題ありませんが、大規模展開時は審査申請が必要です

## 必要な環境変数

`.env`ファイルに以下が正しく設定されているか確認：

```env
DISCORD_BOT_TOKEN=your-discord-bot-token
```

## 動作確認

1. Discordサーバーでボットがオンラインになっているか確認
2. `/agent Hello`でテスト
3. `/agent-repo https://github.com/username/repo.git` でリポジトリを紐付け
4. `/agent-repo tool vibe-local`（または `claude` / `codex`）でチャンネル既定ツールを設定
5. ボットにDMを送信してテスト
6. ボットをメンション（@ボット名）してテスト
