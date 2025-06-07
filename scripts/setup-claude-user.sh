#!/bin/bash
# Setup script to create a dedicated user for Claude CLI with proper permissions

set -e

echo "Setting up dedicated claude-bot user for Claude CLI..."

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo "This script must be run as root"
    exit 1
fi

# Create claude-bot user if it doesn't exist
if ! id "claude-bot" &>/dev/null; then
    echo "Creating claude-bot user..."
    useradd -r -s /bin/bash -m -d /var/lib/claude-bot claude-bot
    echo "✅ Created claude-bot user"
else
    echo "ℹ️  claude-bot user already exists"
fi

# Ensure home directory exists with correct permissions
mkdir -p /var/lib/claude-bot
chown claude-bot:claude-bot /var/lib/claude-bot
chmod 755 /var/lib/claude-bot

# Find Claude binary
CLAUDE_BINARY=$(which claude 2>/dev/null || echo "")
if [ -z "$CLAUDE_BINARY" ]; then
    echo "Error: Claude CLI not found in PATH"
    echo "Please install Claude CLI first: npm install -g @anthropic-ai/claude-code"
    exit 1
fi

echo "Found Claude at: $CLAUDE_BINARY"

# Install Claude for the claude-bot user
echo "Installing Claude for claude-bot user..."

# Create .npm directory for claude-bot
sudo -u claude-bot mkdir -p /var/lib/claude-bot/.npm
sudo -u claude-bot npm config set prefix /var/lib/claude-bot/.npm

# Install Claude CLI for claude-bot user
echo "Installing Claude CLI globally for claude-bot user..."
sudo -u claude-bot npm install -g @anthropic-ai/claude-code

# Add npm bin to claude-bot's PATH
echo 'export PATH="/var/lib/claude-bot/.npm/bin:$PATH"' >> /var/lib/claude-bot/.bashrc

# Create a wrapper script for easy access
cat > /usr/local/bin/claude-bot << 'EOF'
#!/bin/bash
# Wrapper to run Claude as claude-bot user
export PATH="/var/lib/claude-bot/.npm/bin:$PATH"
exec sudo -u claude-bot /var/lib/claude-bot/.npm/bin/claude "$@"
EOF

chmod 755 /usr/local/bin/claude-bot

# Test the installation
echo ""
echo "Testing Claude installation for claude-bot user..."
if sudo -u claude-bot bash -c 'export PATH="/var/lib/claude-bot/.npm/bin:$PATH"; claude --version' >/dev/null 2>&1; then
    echo "✅ Success! claude-bot user can run Claude."
else
    echo "❌ Failed to setup Claude for claude-bot user."
    exit 1
fi

echo ""
echo "Setup complete!"
echo ""
echo "The bot will now use the 'claude-bot' user instead of 'nobody'."
echo "You can test it manually with:"
echo "  sudo -u claude-bot /var/lib/claude-bot/.npm/bin/claude --version"
echo "  or simply: claude-bot --version"
echo ""
echo "Update your environment variable:"
echo "  export CLAUDE_RUN_AS_USER=claude-bot"