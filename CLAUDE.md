# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Development Commands

```bash
# Install dependencies
npm install

# Development mode with hot reload
npm run dev

# Build TypeScript to JavaScript
npm run build

# Run production build
npm start

# TypeScript type checking
npx tsc --noEmit

# Start/stop scripts
./scripts/start.sh             # Start in background
./scripts/stop.sh              # Stop the bot
./scripts/restart.sh           # Restart the bot
```

## Architecture Overview

This is a multi-platform bot application that connects Slack and Discord to a local Claude Code instance with Git repository integration. The architecture consists of:

### Core Components

1. **Main Application (`src/index.ts`)**
   - Detects available platform credentials and initializes appropriate bots
   - Manages multiple bot instances through BotManager
   - Includes a health check HTTP server on the configured port
   - Handles graceful shutdown for all active bots

2. **Bot Manager (`src/BotManager.ts`)**
   - Central coordinator for all bot instances
   - Handles common message processing logic
   - Routes commands and messages to Claude Code Client
   - Manages bot lifecycle (start/stop)
   - Integrates with Storage and Git services for repository management
   - Handles repository-aware command execution

3. **Platform Adapters**
   - **SlackAdapter (`src/adapters/SlackAdapter.ts`)**: Implements Slack-specific features using Bolt framework
   - **DiscordAdapter (`src/adapters/DiscordAdapter.ts`)**: Implements Discord-specific features using discord.js
   - Both implement the common `BotAdapter` interface for consistency
   - Support for `/claude-repo` command for repository management

4. **Claude Code Client (`src/claudeCodeClient.ts`)**
   - Abstraction layer for communicating with Claude Code CLI
   - Executes Claude commands via shell with optional working directory support
   - Default 60-second timeout for operations
   - Supports repository context by setting working directory

5. **Storage Service (`src/services/StorageService.ts`)**
   - Manages channel-to-repository mappings
   - Persists data in JSON format (`channel-repos.json`)
   - Provides CRUD operations for channel repository associations

6. **Git Service (`src/services/GitService.ts`)**
   - Handles Git repository operations (clone, pull, status)
   - Manages local repository storage in `repositories/` directory
   - Provides repository health checks and status information

### Key Integration Points

- **Platform Authentication**:
  - **Slack**: Requires three tokens configured via environment variables:
    - `SLACK_BOT_TOKEN`: OAuth token for bot operations
    - `SLACK_SIGNING_SECRET`: Request verification
    - `SLACK_APP_TOKEN`: Socket Mode connection
  - **Discord**: Requires one token:
    - `DISCORD_BOT_TOKEN`: Bot authentication token

- **Claude Code Connection**: 
  - Executes Claude CLI commands directly via shell
  - Supports working directory context for repository-aware operations
  - Commands are executed with proper escaping and timeout handling

### Error Handling Pattern

All user-facing operations follow this pattern:
1. Health check Claude Code CLI availability
2. Validate user input
3. Send initial acknowledgment to user
4. Process request with appropriate error messaging
5. Format response with Slack blocks for rich formatting

### Repository Integration

The bot supports Git repository integration per channel:
- **Clone**: `/claude-repo <git-url>` - Clones repository and links to channel
- **Status**: `/claude-repo status` - Shows current repository information
- **Delete**: `/claude-repo delete` - Removes channel-repository association
- **Reset**: `/claude-repo reset` - Removes all channel-repository associations

When a repository is linked to a channel:
- All Claude commands execute in the repository's directory
- Claude has full context of the repository's code
- Multiple channels can have different repositories
- Repository data persists across bot restarts

### Data Storage

- **Channel mappings**: Stored in `channel-repos.json`
- **Cloned repositories**: Stored in `repositories/` directory
- **Naming convention**: `<channel-id>-<repo-name>-<timestamp>`