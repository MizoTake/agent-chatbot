#!/bin/bash

# Agent Chatbot 開発環境起動スクリプト
# Agent Chatbotを開発モードで起動します

echo "🔧 Agent Chatbot 開発環境起動スクリプト"
echo "======================================="

# 色付き出力用の関数
print_success() { echo -e "\033[0;32m✅ $1\033[0m"; }
print_error() { echo -e "\033[0;31m❌ $1\033[0m"; }
print_warning() { echo -e "\033[0;33m⚠️  $1\033[0m"; }
print_info() { echo -e "\033[0;36mℹ️  $1\033[0m"; }

# 実行ユーザーのPATHを引き継ぐ
apply_user_path() {
    local user_path=""

    if [ -n "$AGENT_CHATBOT_USER_PATH" ]; then
        user_path="$AGENT_CHATBOT_USER_PATH"
    elif [ -n "$SUDO_USER" ] && [ "$SUDO_USER" != "root" ] && command -v sudo >/dev/null 2>&1; then
        user_path=$(sudo -Hiu "$SUDO_USER" bash -lc 'printf "%s" "$PATH"' 2>/dev/null || true)
    else
        user_path=$(bash -lc 'printf "%s" "$PATH"' 2>/dev/null || true)
    fi

    if [ -n "$user_path" ]; then
        export AGENT_CHATBOT_USER_PATH="$user_path"
        export PATH="$user_path:$PATH"
        print_info "ユーザーPATHを引き継ぎました"
    else
        print_warning "ユーザーPATHを取得できなかったため、現在のPATHを使用します"
    fi
}

# 利用可能なCLIツールの存在チェック
detect_agent_cli() {
    if command -v claude &> /dev/null; then
        echo "claude"
        return 0
    fi
    if command -v codex &> /dev/null; then
        echo "codex"
        return 0
    fi
    if command -v vibe-local &> /dev/null; then
        echo "vibe-local"
        return 0
    fi
    return 1
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

# 依存関係のインストール
install_dependencies() {
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
        exit 1
    fi
fi

# 環境変数の読み込み
source .env
apply_user_path

# ツール実行ログを起動ターミナルで確認できるように既定有効化
if [ -z "$AGENT_CHATBOT_LOG_TOOL_STREAM" ]; then
    export AGENT_CHATBOT_LOG_TOOL_STREAM=true
fi

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
install_dependencies

# TypeScriptの型チェック（オプション）
# print_info "TypeScriptの型チェックを実行中..."
# npx tsc --noEmit
# if [ $? -eq 0 ]; then
#     print_success "TypeScriptの型チェックが成功しました"
# else
#     print_warning "TypeScriptの型エラーがあります"
# fi

# CLIツールの確認
echo ""
echo "📋 CLIツールの状態を確認中..."

DETECTED_CLI=$(detect_agent_cli)
if [ -n "$DETECTED_CLI" ]; then
    print_success "利用可能なCLIを検出しました: $DETECTED_CLI"
    print_info "コマンドはチャットメッセージごとに実行されます"
else
    print_error "利用可能なCLIが見つかりませんでした"
    echo ""
    echo "いずれかのCLIをインストールしてください:"
    echo "  Claude: https://claude.ai/download"
    echo "  Codex: https://github.com/openai/codex"
    echo "  vibe-local: https://github.com/ochyai/vibe-local"
    echo ""
    echo "※ vibe-localを使う場合は Ollama も必要です"
    echo ""
    echo "インストール後、再度このスクリプトを実行してください"
    exit 1
fi

# 開発サーバーの起動
echo ""
echo "🚀 開発サーバーを起動します..."
echo ""
print_info "開発サーバーはホットリロードに対応しています"
print_info "コードを変更すると自動的に再起動します"
echo ""
echo "停止するには Ctrl+C を押してください"
echo ""

# npm run devを実行
npm run dev
