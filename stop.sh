#!/bin/bash

# Claude Chat Bot 停止スクリプト（ローカル実行）

echo "🛑 Claude Chat Bot 停止スクリプト"
echo "================================"

# 色付き出力用の関数
print_success() { echo -e "\033[0;32m✅ $1\033[0m"; }
print_error() { echo -e "\033[0;31m❌ $1\033[0m"; }
print_warning() { echo -e "\033[0;33m⚠️  $1\033[0m"; }
print_info() { echo -e "\033[0;36mℹ️  $1\033[0m"; }

# Node.jsプロセスの確認と停止
echo ""
echo "📦 Node.jsプロセスを確認しています..."

# npm startまたはnpm run devで起動したプロセスを探す
NODE_PIDS=$(ps aux | grep -E "(node|nodemon).*src/index" | grep -v grep | awk '{print $2}')

if [ -n "$NODE_PIDS" ]; then
    print_info "Node.jsプロセスを検出しました"
    for PID in $NODE_PIDS; do
        kill $PID 2>/dev/null
        if [ $? -eq 0 ]; then
            print_success "プロセス $PID を停止しました"
        fi
    done
else
    print_info "実行中のNode.jsプロセスはありません"
fi

# ts-nodeプロセスの確認
TS_NODE_PIDS=$(ps aux | grep "ts-node" | grep -v grep | awk '{print $2}')

if [ -n "$TS_NODE_PIDS" ]; then
    for PID in $TS_NODE_PIDS; do
        kill $PID 2>/dev/null
        if [ $? -eq 0 ]; then
            print_success "ts-nodeプロセス $PID を停止しました"
        fi
    done
fi

# Claude関連プロセスについて
echo ""
print_info "注: Claude CLIはチャットメッセージごとに実行されるため、常駐プロセスはありません"

# ポートの確認
echo ""
echo "🔍 使用ポートの確認..."

# ポート3000の確認
if lsof -i:3000 > /dev/null 2>&1; then
    print_warning "ポート3000はまだ使用中です"
    echo "使用中のプロセス:"
    lsof -i:3000 | grep LISTEN
else
    print_success "ポート3000は解放されました"
fi


echo ""
print_success "停止処理が完了しました"