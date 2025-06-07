# Claude Codeのセットアップガイド

## 重要な注意事項

**Claude Codeは公式Dockerイメージを提供していません。** ホストマシンで直接実行する必要があります。

## セットアップ方法

### 1. ホストマシンでClaude Codeを起動

```bash
# Claude Codeがインストールされていない場合
# 公式サイトからインストール

# Claude Codeを起動
claude code

# デフォルトでは http://localhost:5173 で起動します
```

### 2. ボットアプリケーションの設定

#### 方法A: ホストマシンで直接実行

```bash
# 依存関係のインストール
npm install

# 環境変数の設定
cp .env.example .env
# .envファイルを編集

# 開発モードで起動
npm run dev

# または本番モード
npm run build
npm start
```

#### 方法B: Dockerでボットのみ実行

```bash
# .envファイルの設定
cp .env.example .env
# 編集して必要なトークンを設定

# Dockerで起動（Claude Codeはホストで実行中）
docker-compose up -d
```

`.env`ファイルでは以下のように設定：

```env
# ホストのClaude Codeに接続
CLAUDE_CODE_URL=http://host.docker.internal:5173
```

## Max Planユーザー向け設定

### 認証の違い

- **API Plan**: Anthropic APIキーを使用
- **Max Plan**: ブラウザベースの認証（セッション/Cookie）を使用

### Max Planでの認証確認

1. ブラウザで[claude.ai](https://claude.ai)にログイン
2. Claude Codeを起動して正常に動作することを確認
3. ボットアプリケーションから接続

## トラブルシューティング

### 接続できない場合

1. **Claude Codeが起動しているか確認**
   ```bash
   # ヘルスチェック
   curl http://localhost:5173/health
   ```

2. **ファイアウォール設定**
   - ポート5173が開いているか確認
   - Dockerコンテナからホストへの接続が許可されているか

3. **ネットワーク設定**
   - Dockerの場合: `host.docker.internal`を使用
   - WSL2の場合: ホストのIPアドレスを直接指定が必要な場合あり

### 認証エラー（Max Plan）

1. ブラウザでclaude.aiに再ログイン
2. Claude Codeを再起動
3. セッションが期限切れの場合は再認証が必要

## 推奨構成

### 開発環境
- ホストマシン: Claude Code + ボットアプリ（npm run dev）

### 本番環境
- ホストマシン: Claude Code（systemdサービスとして）
- Docker: ボットアプリケーション

### セキュリティ考慮事項

1. Claude Codeはローカルネットワークのみでアクセス可能にする
2. 本番環境では適切なファイアウォール設定を行う
3. Max Planの認証情報は定期的に更新する

## 代替案

Claude APIを直接使用する場合は、アプリケーションを以下のように修正：

```typescript
// claudeCodeClient.tsを修正して、直接Anthropic APIを使用
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});
```

この場合、Claude Codeは不要になりますが、APIキーが必要です。