#!/bin/bash
# Setup script to create a dedicated user for Agent Chatbot (Claude CLI) with proper permissions

set -e

echo "Setting up dedicated agent-chatbot user for Agent Chatbot (Claude CLI)..."

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo "This script must be run as root"
    exit 1
fi

# Create agent-chatbot user if it doesn't exist
if ! id "agent-chatbot" &>/dev/null; then
    echo "Creating agent-chatbot user..."
    useradd -r -s /bin/bash -m -d /var/lib/agent-chatbot agent-chatbot
    echo "✅ Created agent-chatbot user"
else
    echo "ℹ️  agent-chatbot user already exists"
fi

# Ensure home directory exists with correct permissions
mkdir -p /var/lib/agent-chatbot
chown agent-chatbot:agent-chatbot /var/lib/agent-chatbot
chmod 755 /var/lib/agent-chatbot

# Find Claude binary
CLAUDE_BINARY=$(which claude 2>/dev/null || echo "")
if [ -z "$CLAUDE_BINARY" ]; then
    echo "Error: Claude CLI not found in PATH"
    echo "Please install Claude CLI first: npm install -g @anthropic-ai/claude-code"
    exit 1
fi

echo "Found Claude at: $CLAUDE_BINARY"

# Install Claude for the agent-chatbot user
echo "Installing Claude for agent-chatbot user..."

# Create .npm directory for agent-chatbot
sudo -u agent-chatbot mkdir -p /var/lib/agent-chatbot/.npm
sudo -u agent-chatbot npm config set prefix /var/lib/agent-chatbot/.npm

# Install Claude CLI for agent-chatbot user
echo "Installing Claude CLI globally for agent-chatbot user..."
sudo -u agent-chatbot npm install -g @anthropic-ai/claude-code

# Add npm bin to agent-chatbot's PATH
echo 'export PATH="/var/lib/agent-chatbot/.npm/bin:$PATH"' >> /var/lib/agent-chatbot/.bashrc

# Create a wrapper script for easy access
cat > /usr/local/bin/agent-chatbot << 'EOF'
#!/bin/bash
# Wrapper to run Claude as agent-chatbot user
export PATH="/var/lib/agent-chatbot/.npm/bin:$PATH"
exec sudo -u agent-chatbot /var/lib/agent-chatbot/.npm/bin/claude "$@"
EOF

chmod 755 /usr/local/bin/agent-chatbot

# Test the installation
echo ""
echo "Testing Claude installation for agent-chatbot user..."
if sudo -u agent-chatbot bash -c 'export PATH="/var/lib/agent-chatbot/.npm/bin:$PATH"; claude --version' >/dev/null 2>&1; then
    echo "✅ Success! agent-chatbot user can run Claude."
else
    echo "❌ Failed to setup Claude for agent-chatbot user."
    exit 1
fi

echo ""
echo "Setup complete!"
echo ""

# Offer to share authentication
echo "Would you like to share root's Claude authentication with agent-chatbot? (y/n)"
read -r SHARE_AUTH

if [[ "$SHARE_AUTH" =~ ^[Yy]$ ]]; then
    echo "Sharing authentication..."
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    if [ -x "$SCRIPT_DIR/share-agent-auth.sh" ]; then
        "$SCRIPT_DIR/share-agent-auth.sh"
    else
        echo "Warning: share-agent-auth.sh not found or not executable"
    fi
fi

echo ""
echo "The bot will now use the 'agent-chatbot' user instead of 'nobody'."
echo "You can test it manually with:"
echo "  sudo -u agent-chatbot /var/lib/agent-chatbot/.npm/bin/claude --version"
echo "  or simply: agent-chatbot --version"
echo ""
echo "Update your environment variable:"
echo "  export CLAUDE_RUN_AS_USER=agent-chatbot"
