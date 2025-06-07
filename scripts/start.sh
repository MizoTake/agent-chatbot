#!/bin/bash

# Claude Chat Bot 起動スクリプト（ローカル実行）

echo "🚀 Claude Chat Bot 起動スクリプト"
echo "================================="

# 色付き出力用の関数
print_success() { echo -e "\033[0;32m✅ $1\033[0m"; }
print_error() { echo -e "\033[0;31m❌ $1\033[0m"; }
print_warning() { echo -e "\033[0;33m⚠️  $1\033[0m"; }
print_info() { echo -e "\033[0;36mℹ️  $1\033[0m"; }

# Claude CLIの存在チェック
check_claude_cli() {
    if command -v claude &> /dev/null; then
        return 0
    else
        return 1
    fi
}

# Node.jsのバージョンチェック
check_node_version() {
    if ! command -v node &> /dev/null; then
        print_error "Node.jsがインストールされていません"
        echo "Node.js v14以上をインストールしてください"
        exit 1
    fi
    
    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -lt 14 ]; then
        print_error "Node.jsのバージョンが古いです (v$NODE_VERSION)"
        echo "Node.js v14以上が必要です"
        exit 1
    fi
    
    print_success "Node.js $(node -v) を検出"
}

# 環境変数ファイルのチェック
if [ ! -f .env ]; then
    print_error ".envファイルが見つかりません"
    
    if [ -f .env.example ]; then
        print_info ".env.exampleから.envファイルを作成します..."
        cp .env.example .env
        print_success ".envファイルを作成しました"
        print_warning "重要: .envファイルを編集してトークンを設定してください"
        echo ""
        echo "必要な設定:"
        echo "  Slack: SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, SLACK_APP_TOKEN"
        echo "  Discord: DISCORD_BOT_TOKEN"
        echo ""
        echo "設定後、再度このスクリプトを実行してください"
        exit 1
    else
        print_error ".env.exampleファイルも見つかりません"
        exit 1
    fi
fi

# 環境変数の読み込み
source .env

# プラットフォーム設定の確認
has_platform=false
if [ -n "$SLACK_BOT_TOKEN" ] && [ -n "$SLACK_SIGNING_SECRET" ] && [ -n "$SLACK_APP_TOKEN" ]; then
    print_success "Slack設定を検出"
    has_platform=true
fi

if [ -n "$DISCORD_BOT_TOKEN" ]; then
    print_success "Discord設定を検出"
    has_platform=true
fi

if [ "$has_platform" = false ]; then
    print_error "SlackまたはDiscordの設定が必要です"
    exit 1
fi

# Node.jsのチェック
check_node_version

# 依存関係のインストール
if [ ! -d "node_modules" ]; then
    print_info "依存関係をインストールします..."
    npm install
    if [ $? -eq 0 ]; then
        print_success "依存関係のインストールが完了しました"
    else
        print_error "依存関係のインストールに失敗しました"
        exit 1
    fi
else
    print_success "依存関係は既にインストールされています"
fi

# TypeScriptのビルド
print_info "TypeScriptをビルドしています..."
npm run build
if [ $? -eq 0 ]; then
    print_success "ビルドが完了しました"
else
    print_error "ビルドに失敗しました"
    exit 1
fi

# Claude CLIの確認
echo ""
echo "📋 Claude CLIの状態を確認中..."

if check_claude_cli; then
    print_success "Claude CLIがインストールされています"
    print_info "Claudeコマンドはチャットメッセージごとに実行されます"
else
    print_error "Claude CLIがインストールされていません"
    echo ""
    echo "Claudeをインストールしてください:"
    echo "  https://claude.ai/download"
    echo ""
    echo "インストール後、再度このスクリプトを実行してください"
    exit 1
fi

# アプリケーションの起動
echo ""
echo "🚀 ボットアプリケーションを起動します..."
echo ""
print_info "停止するには Ctrl+C を押してください"
echo ""

# npm startを実行
npm start