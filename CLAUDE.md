# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

メッセージのやり取りは日本語で行ってください。

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

This is a Discord bot application that connects local agent CLIs (Claude/Codex/vibe-local) with Git repository integration. The architecture consists of:

### Core Components

1. **Main Application (`src/index.ts`)**
   - Validates Discord credentials and initializes the Discord bot
   - Includes a health check HTTP server on the configured port
   - Handles graceful shutdown for the running bot

2. **Bot Manager (`src/BotManager.ts`)**
   - Wires together runtime services and the Discord adapter
   - Manages bot lifecycle (start/stop)

3. **Platform Adapter**
   - **DiscordAdapter (`src/adapters/DiscordAdapter.ts`)**: Implements Discord-specific features using discord.js
   - Implements the common `BotAdapter` interface
   - Supports `/agent-repo` command for repository management

4. **Tool CLI Client (`src/toolCLIClient.ts`)**
   - Abstraction layer for communicating with CLI tools (Claude/Codex/vibe-local)
   - Executes tool commands via shell with optional working directory support
   - Supports per-channel/default tool selection (`/agent-tool`)
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
  - **Discord**: Requires one token:
    - `DISCORD_BOT_TOKEN`: Bot authentication token

- **Agent CLI Connection**: 
  - Executes configured CLI commands directly via shell
  - Supports working directory context for repository-aware operations
  - Commands are executed with proper escaping and timeout handling

### Error Handling Pattern

All user-facing operations follow this pattern:
1. Health check selected CLI availability
2. Validate user input
3. Send initial acknowledgment to user
4. Process request with appropriate error messaging
5. Format response with Discord-compatible text or blocks

### Repository Integration

The bot supports Git repository integration per channel:
- **Clone**: `/agent-repo <git-url>` - Clones repository and links to channel
- **Status**: `/agent-repo status` - Shows current repository information
- **Delete**: `/agent-repo delete` - Removes channel-repository association
- **Reset**: `/agent-repo reset` - Removes all channel-repository associations

When a repository is linked to a channel:
- All `/agent` commands execute in the repository's directory
- The selected tool has full context of the repository's code
- Multiple channels can have different repositories
- Repository data persists across bot restarts

### Data Storage

- **Channel mappings**: Stored in `channel-repos.json`
- **Cloned repositories**: Stored in `repositories/` directory
- **Naming convention**: `<channel-id>-<repo-name>-<timestamp>`
