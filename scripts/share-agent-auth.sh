#!/bin/bash
# Script to share Agent Chatbot Claude authentication from root to agent-chatbot user

set -e

echo "Sharing Claude authentication with agent-chatbot user..."

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo "This script must be run as root"
    exit 1
fi

# Check if agent-chatbot user exists
if ! id "agent-chatbot" &>/dev/null; then
    echo "Error: agent-chatbot user does not exist. Please run setup-agent-user.sh first."
    exit 1
fi

# Claude config directory for agent-chatbot
AGENT_CHATBOT_HOME="/var/lib/agent-chatbot"
AGENT_CHATBOT_CONFIG="$AGENT_CHATBOT_HOME/.claude"

# Root Claude config directory
ROOT_CLAUDE_CONFIG="/root/.claude"
ROOT_CLAUDE_JSON="/root/.claude.json"

# Check if root has Claude configuration
if [ ! -d "$ROOT_CLAUDE_CONFIG" ]; then
    echo "Error: No Claude configuration found for root user."
    echo "Please login to Claude as root first: claude login"
    exit 1
fi

# Create .claude directory for agent-chatbot
echo "Creating Claude config directory for agent-chatbot..."
mkdir -p "$AGENT_CHATBOT_CONFIG"

# Copy configuration files
echo "Copying Claude configuration..."

# Copy the entire .claude directory
cp -r "$ROOT_CLAUDE_CONFIG"/* "$AGENT_CHATBOT_CONFIG/" 2>/dev/null || true

# Copy .claude.json if it exists
if [ -f "$ROOT_CLAUDE_JSON" ]; then
    cp "$ROOT_CLAUDE_JSON" "$AGENT_CHATBOT_HOME/.claude.json"
fi

# Special handling for credentials - ensure it exists and has correct permissions
if [ -f "$ROOT_CLAUDE_CONFIG/.credentials.json" ]; then
    cp "$ROOT_CLAUDE_CONFIG/.credentials.json" "$AGENT_CHATBOT_CONFIG/.credentials.json"
    chmod 600 "$AGENT_CHATBOT_CONFIG/.credentials.json"
fi

# Set correct ownership
chown -R agent-chatbot:agent-chatbot "$AGENT_CHATBOT_CONFIG"
chown -R agent-chatbot:agent-chatbot "$AGENT_CHATBOT_HOME/.claude.json" 2>/dev/null || true

# Set correct permissions
chmod 700 "$AGENT_CHATBOT_CONFIG"
find "$AGENT_CHATBOT_CONFIG" -type d -exec chmod 700 {} \;
find "$AGENT_CHATBOT_CONFIG" -type f -exec chmod 600 {} \;

# Test the authentication
echo ""
echo "Testing Claude authentication for agent-chatbot user..."
if sudo -u agent-chatbot /var/lib/agent-chatbot/.npm/bin/claude --version >/dev/null 2>&1; then
    echo "✅ Claude CLI is accessible"
    
    # Try a simple command to verify authentication
    if echo "Say hello" | sudo -u agent-chatbot /var/lib/agent-chatbot/.npm/bin/claude --print >/dev/null 2>&1; then
        echo "✅ Claude authentication is working!"
    else
        echo "⚠️  Claude CLI works but authentication might need attention"
        echo "The agent-chatbot user may need to login separately"
    fi
else
    echo "❌ Failed to run Claude CLI as agent-chatbot user"
fi

echo ""
echo "Setup complete!"
echo ""
echo "Note: If authentication fails, you may need to:"
echo "1. Run: sudo -u agent-chatbot /var/lib/agent-chatbot/.npm/bin/claude login"
echo "2. Or set ANTHROPIC_API_KEY environment variable"
