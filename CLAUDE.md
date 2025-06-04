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

# Docker operations
./start-docker.sh              # Start with Docker Compose
docker-compose up -d           # Start in detached mode
docker-compose logs -f         # View logs
docker-compose down            # Stop containers
```

## Architecture Overview

This is a multi-platform bot application that connects Slack and Discord to a local Claude Code instance. The architecture consists of:

### Core Components

1. **Main Application (`src/index.ts`)**
   - Detects available platform credentials and initializes appropriate bots
   - Manages multiple bot instances through BotManager
   - Includes a health check HTTP server on the configured port for Docker monitoring
   - Handles graceful shutdown for all active bots

2. **Bot Manager (`src/BotManager.ts`)**
   - Central coordinator for all bot instances
   - Handles common message processing logic
   - Routes commands and messages to Claude Code Client
   - Manages bot lifecycle (start/stop)

3. **Platform Adapters**
   - **SlackAdapter (`src/adapters/SlackAdapter.ts`)**: Implements Slack-specific features using Bolt framework
   - **DiscordAdapter (`src/adapters/DiscordAdapter.ts`)**: Implements Discord-specific features using discord.js
   - Both implement the common `BotAdapter` interface for consistency

4. **Claude Code Client (`src/claudeCodeClient.ts`)**
   - Abstraction layer for communicating with Claude Code API
   - Handles three modes: 'chat', 'code', and 'architect'
   - Manages request/response formatting and error handling
   - Default 5-minute timeout for long operations
   - Health check endpoint verification

### Key Integration Points

- **Platform Authentication**:
  - **Slack**: Requires three tokens configured via environment variables:
    - `SLACK_BOT_TOKEN`: OAuth token for bot operations
    - `SLACK_SIGNING_SECRET`: Request verification
    - `SLACK_APP_TOKEN`: Socket Mode connection
  - **Discord**: Requires one token:
    - `DISCORD_BOT_TOKEN`: Bot authentication token

- **Claude Code Connection**: 
  - Connects to Claude Code server (default: `http://localhost:5173`)
  - Docker deployments should use `http://host.docker.internal:5173`
  - All requests go through `/api/chat` endpoint

### Docker Deployment

The application is containerized with:
- Multi-stage build for optimization
- Non-root user execution for security
- Health check support via HTTP endpoint
- Host network access for local Claude Code connection

### Error Handling Pattern

All user-facing operations follow this pattern:
1. Health check Claude Code server availability
2. Validate user input
3. Send initial acknowledgment to user
4. Process request with appropriate error messaging
5. Format response with Slack blocks for rich formatting