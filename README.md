# Claude Slack/Discord Bot

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://www.typescriptlang.org/)

A multi-platform bot that integrates Claude CLI with Slack and Discord, providing AI assistance with Git repository context awareness.

## 🌟 Features

- **Multi-Platform Support**: Works with both Slack and Discord
- **Repository Context**: Clone and manage Git repositories per channel
- **Claude CLI Integration**: Direct access to Claude's capabilities
- **Thread Management**: Maintains conversation context within threads
- **Socket Mode**: Easy setup without public URL requirements (Slack)
- **Docker Support**: Containerized deployment
- **Graceful Shutdown**: Proper signal handling and cleanup
- **Structured Logging**: JSON and human-readable log formats
- **Error Recovery**: Automatic retry with exponential backoff
- **Security**: Input validation and sanitization

## 📦 Prerequisites

- Node.js 18+ and npm
- [Claude CLI](https://claude.ai/download) installed and configured
- For Slack: Workspace with admin access
- For Discord: Server with bot management permissions
- Docker (optional, for containerized deployment)
- Git (for repository features)

## 🚀 Quick Start

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/claude-slack-discord-bot.git
   cd claude-slack-discord-bot
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure your environment variables:

   Create a `.env` file in the project root:
   ```env
   # Slack Bot Configuration (optional)
   SLACK_BOT_TOKEN=xoxb-your-bot-token
   SLACK_SIGNING_SECRET=your-signing-secret
   SLACK_APP_TOKEN=xapp-your-app-token

   # Discord Bot Configuration (optional)
   DISCORD_BOT_TOKEN=your-discord-bot-token

   # Server Configuration
   PORT=3000

   # Logging
   LOG_LEVEL=info        # debug, info, warn, error
   LOG_FORMAT=human      # human or json

   # Debug Mode
   DEBUG=false
   ```

4. Build and start the bot:
   ```bash
   npm run build
   npm start
   ```

## 🚀 Usage

### Starting the Bot

**Development mode:**
```bash
npm run dev
```

**Production mode:**
```bash
npm start
```

**Using scripts:**
```bash
./scripts/start.sh       # Start in background
./scripts/stop.sh        # Stop the bot
./scripts/restart.sh     # Restart the bot
```

### Bot Commands

#### General Commands
- **Direct Message**: Send any message to the bot
- **Channel Mention**: `@BotName your message`
- **Slash Commands**:
  - `/claude <prompt>` - Send a prompt to Claude
  - `/claude-code <prompt>` - Get code-specific help
  - `/claude-repo <url>` - Clone and link a repository
  - `/claude-repo status` - Check repository status
  - `/claude-repo delete` - Remove repository link

### Docker Deployment

```bash
# Build and run with Docker Compose
docker-compose up -d

# View logs
docker-compose logs -f

# Stop containers
docker-compose down
```

### Repository Integration

Link a Git repository to a channel to give Claude context:

```
/claude-repo https://github.com/user/repo.git
```

Once linked, all Claude commands in that channel will have access to the repository's code.

## ⚙️ Configuration

### Environment Variables

**Slack Configuration:**
- `SLACK_BOT_TOKEN`: Bot User OAuth Token (xoxb-...)
- `SLACK_SIGNING_SECRET`: App Signing Secret
- `SLACK_APP_TOKEN`: App-Level Token for Socket Mode (xapp-...)

**Discord Configuration:**
- `DISCORD_BOT_TOKEN`: Discord Bot Token

**General Configuration:**
- `PORT`: Health check server port (default: 3000)
- `LOG_LEVEL`: Logging level (debug/info/warn/error)
- `LOG_FORMAT`: Log format (human/json)
- `DEBUG`: Enable debug output (true/false)

### File Structure

```
claude-slack-app/
├── src/
│   ├── adapters/        # Platform-specific adapters
│   ├── config/          # Configuration and validation
│   ├── interfaces/      # TypeScript interfaces
│   ├── services/        # Business logic services
│   ├── utils/           # Utility functions
│   ├── BotManager.ts    # Central bot coordinator
│   ├── claudeCLIClient.ts # Claude CLI wrapper
│   └── index.ts         # Application entry point
├── config/              # Configuration files
├── docs/                # Documentation
├── scripts/             # Shell scripts
└── repositories/        # Cloned Git repositories
```

## 📖 Documentation

- [Slack Setup Guide](./docs/SLACK_SETUP.md)
- [Discord Setup Guide](./docs/DISCORD_SETUP.md)
- [Repository Feature](./docs/REPOSITORY_FEATURE.md)
- [Timeout Configuration](./docs/TIMEOUT_LIMITS.md)
- [Development Guide](./CLAUDE.md)

## 🔧 Troubleshooting

### Bot Not Responding
1. Verify environment variables are set correctly
2. Check Claude CLI is installed: `claude --version`
3. Review logs: `npm run dev` or check Docker logs
4. Ensure bot is invited to the channel/server
5. Check bot permissions in channel/server settings

### Connection Issues
- **Slack**: Verify app-level token has `connections:write` scope
- **Discord**: Check bot token and intents are configured
- Ensure only one instance is running

### Repository Features
- Verify Git is installed and accessible
- Check write permissions in `repositories/` directory
- Ensure repository URL is accessible

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests and linting
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built with [Bolt for JavaScript](https://slack.dev/bolt-js) (Slack)
- Powered by [discord.js](https://discord.js.org/) (Discord)
- AI assistance by [Claude](https://claude.ai/)