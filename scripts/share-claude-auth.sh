#!/bin/bash
# Script to share Claude authentication from root to claude-bot user

set -e

echo "Sharing Claude authentication with claude-bot user..."

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo "This script must be run as root"
    exit 1
fi

# Check if claude-bot user exists
if ! id "claude-bot" &>/dev/null; then
    echo "Error: claude-bot user does not exist. Please run setup-claude-user.sh first."
    exit 1
fi

# Claude config directory for claude-bot
CLAUDE_BOT_HOME="/var/lib/claude-bot"
CLAUDE_BOT_CONFIG="$CLAUDE_BOT_HOME/.claude"

# Root Claude config directory
ROOT_CLAUDE_CONFIG="/root/.claude"
ROOT_CLAUDE_JSON="/root/.claude.json"

# Check if root has Claude configuration
if [ ! -d "$ROOT_CLAUDE_CONFIG" ]; then
    echo "Error: No Claude configuration found for root user."
    echo "Please login to Claude as root first: claude login"
    exit 1
fi

# Create .claude directory for claude-bot
echo "Creating Claude config directory for claude-bot..."
mkdir -p "$CLAUDE_BOT_CONFIG"

# Copy configuration files
echo "Copying Claude configuration..."

# Copy the entire .claude directory
cp -r "$ROOT_CLAUDE_CONFIG"/* "$CLAUDE_BOT_CONFIG/" 2>/dev/null || true

# Copy .claude.json if it exists
if [ -f "$ROOT_CLAUDE_JSON" ]; then
    cp "$ROOT_CLAUDE_JSON" "$CLAUDE_BOT_HOME/.claude.json"
fi

# Special handling for credentials - ensure it exists and has correct permissions
if [ -f "$ROOT_CLAUDE_CONFIG/.credentials.json" ]; then
    cp "$ROOT_CLAUDE_CONFIG/.credentials.json" "$CLAUDE_BOT_CONFIG/.credentials.json"
    chmod 600 "$CLAUDE_BOT_CONFIG/.credentials.json"
fi

# Set correct ownership
chown -R claude-bot:claude-bot "$CLAUDE_BOT_CONFIG"
chown -R claude-bot:claude-bot "$CLAUDE_BOT_HOME/.claude.json" 2>/dev/null || true

# Set correct permissions
chmod 700 "$CLAUDE_BOT_CONFIG"
find "$CLAUDE_BOT_CONFIG" -type d -exec chmod 700 {} \;
find "$CLAUDE_BOT_CONFIG" -type f -exec chmod 600 {} \;

# Test the authentication
echo ""
echo "Testing Claude authentication for claude-bot user..."
if sudo -u claude-bot /var/lib/claude-bot/.npm/bin/claude --version >/dev/null 2>&1; then
    echo "✅ Claude CLI is accessible"
    
    # Try a simple command to verify authentication
    if echo "Say hello" | sudo -u claude-bot /var/lib/claude-bot/.npm/bin/claude --print >/dev/null 2>&1; then
        echo "✅ Claude authentication is working!"
    else
        echo "⚠️  Claude CLI works but authentication might need attention"
        echo "The claude-bot user may need to login separately"
    fi
else
    echo "❌ Failed to run Claude CLI as claude-bot user"
fi

echo ""
echo "Setup complete!"
echo ""
echo "Note: If authentication fails, you may need to:"
echo "1. Run: sudo -u claude-bot /var/lib/claude-bot/.npm/bin/claude login"
echo "2. Or set ANTHROPIC_API_KEY environment variable"