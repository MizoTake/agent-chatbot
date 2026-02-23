#!/bin/bash
# Setup script to allow nobody user to run Agent Chatbot's Claude CLI

set -e

echo "Setting up Agent Chatbot Claude CLI for nobody user..."

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo "This script must be run as root"
    exit 1
fi

# Find Claude binary
CLAUDE_BINARY=$(which claude 2>/dev/null || echo "")
if [ -z "$CLAUDE_BINARY" ]; then
    echo "Error: Claude CLI not found in PATH"
    echo "Please install Claude CLI first: npm install -g @anthropic-ai/claude-code"
    exit 1
fi

echo "Found Claude at: $CLAUDE_BINARY"

# Create a system-wide binary directory if it doesn't exist
SYSTEM_BIN="/usr/local/bin"
if [ ! -d "$SYSTEM_BIN" ]; then
    mkdir -p "$SYSTEM_BIN"
fi

# Create a wrapper script that sets up the environment
WRAPPER_SCRIPT="$SYSTEM_BIN/claude-wrapper"
cat > "$WRAPPER_SCRIPT" << 'EOF'
#!/bin/bash
# Claude wrapper script for nobody user

# Set up Node.js environment
export NODE_PATH="/usr/local/lib/node_modules"
export PATH="/usr/local/bin:$PATH"

# Create temporary home directory for nobody if needed
if [ "$USER" = "nobody" ] || [ "$UID" = "65534" ]; then
    export HOME="/tmp/claude-nobody-home"
    mkdir -p "$HOME"
    chmod 700 "$HOME"
fi

# Execute the real Claude binary
exec /usr/local/bin/claude-real "$@"
EOF

chmod 755 "$WRAPPER_SCRIPT"

# Copy or link the Claude binary to system location
if [ -L "$CLAUDE_BINARY" ]; then
    # If it's a symlink, resolve and copy the actual file
    REAL_CLAUDE=$(readlink -f "$CLAUDE_BINARY")
    echo "Copying Claude from: $REAL_CLAUDE"
    cp "$REAL_CLAUDE" "$SYSTEM_BIN/claude-real"
else
    cp "$CLAUDE_BINARY" "$SYSTEM_BIN/claude-real"
fi

chmod 755 "$SYSTEM_BIN/claude-real"

# Create the main claude symlink
ln -sf "$WRAPPER_SCRIPT" "$SYSTEM_BIN/claude"

# Also copy Node.js modules if they're in a user-specific location
if [[ "$CLAUDE_BINARY" == */node_modules/* ]]; then
    # Extract the node_modules path
    NODE_MODULES_PATH=$(echo "$CLAUDE_BINARY" | sed 's|/bin/claude.*|/lib/node_modules|')
    CLAUDE_MODULE_PATH="$NODE_MODULES_PATH/@anthropic-ai/claude-code"
    
    if [ -d "$CLAUDE_MODULE_PATH" ]; then
        echo "Copying Claude module from: $CLAUDE_MODULE_PATH"
        mkdir -p "/usr/local/lib/node_modules/@anthropic-ai"
        cp -r "$CLAUDE_MODULE_PATH" "/usr/local/lib/node_modules/@anthropic-ai/"
        
        # Fix permissions
        chmod -R a+rX "/usr/local/lib/node_modules/@anthropic-ai"
    fi
fi

# Test if nobody can execute claude
echo "Testing Claude access for nobody user..."
if sudo -u nobody "$SYSTEM_BIN/claude" --version >/dev/null 2>&1; then
    echo "✅ Success! Nobody user can now run Claude."
else
    echo "⚠️  Warning: Nobody user might not be able to run Claude. Checking permissions..."
    
    # Additional setup for nobody user
    # Create a minimal home directory for nobody
    mkdir -p /var/lib/nobody
    chown nobody:nogroup /var/lib/nobody || chown nobody:nobody /var/lib/nobody
    
    # Try again with HOME set
    if HOME=/var/lib/nobody sudo -u nobody "$SYSTEM_BIN/claude" --version >/dev/null 2>&1; then
        echo "✅ Success with HOME=/var/lib/nobody!"
        echo "You may need to set HOME=/var/lib/nobody when running as nobody."
    else
        echo "❌ Failed to setup Claude for nobody user. Please check the error messages above."
    fi
fi

echo ""
echo "Setup complete!"
echo ""
echo "To use Claude as nobody user, the bot will automatically run:"
echo "  sudo -u nobody claude --dangerously-skip-permissions --print \"your prompt\""
echo ""
echo "You can also manually test with:"
echo "  sudo -u nobody claude --version"
