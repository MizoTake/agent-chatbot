#!/bin/bash

# Agent Chatbot 再起動スクリプト

echo "🔄 Agent Chatbot 再起動スクリプト"
echo "================================="

# 色付き出力用の関数
print_info() { echo -e "\033[0;36mℹ️  $1\033[0m"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

print_info "停止処理を実行しています..."
"$SCRIPT_DIR/stop.sh"

echo ""
print_info "3秒待機中..."
sleep 3

echo ""
print_info "起動処理を実行しています..."
"$SCRIPT_DIR/start.sh"
