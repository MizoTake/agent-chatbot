# Claude CLIのセットアップガイド

## 重要な注意事項

**このボットはClaude CLIを使用します。** ホストマシンにClaude CLIがインストールされている必要があります。

## セットアップ方法

### 1. Claude CLIのインストール

```bash
# Claude CLIがインストールされていない場合
# 公式サイトからインストール: https://claude.ai/download

# インストール確認
claude --version
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


## Claude CLIの認証

### 初回セットアップ

1. Claude CLIを実行:
   ```bash
   claude
   ```

2. ブラウザが自動的に開き、Claude.aiにログイン

3. 認証が完了するとCLIが使用可能になります

## トラブルシューティング

### Claude CLIが動作しない場合

1. **インストールの確認**
   ```bash
   # バージョン確認
   claude --version
   ```

2. **認証の再実行**
   ```bash
   # 認証をリセット
   claude logout
   claude login
   ```

3. **環境変数の確認**
   - PATHにClaude CLIが含まれているか確認

### 認証エラー

1. Claude CLIで再ログイン:
   ```bash
   claude logout
   claude login
   ```

2. セッションが期限切れの場合は再認証が必要

## 推奨構成

### 開発環境
- ホストマシン: Claude CLI + ボットアプリ（npm run dev）

### 本番環境
- ホストマシン: Claude CLI + ボットアプリ（npm start）
- スクリプトを使用してバックグラウンド実行

### セキュリティ考慮事項

1. Claude CLIの認証情報は安全に保管
2. 本番環境では適切なファイアウォール設定を行う
3. 認証情報は定期的に更新する

## トラブルシューティングの詳細

### コマンドが見つからない

```bash
# macOS/Linux
which claude

# Windows
where claude
```

### パーミッションエラー

```bash
# 実行権限を付与
chmod +x /path/to/claude
```