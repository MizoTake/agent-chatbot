import dotenv from 'dotenv';
import http from 'http';
import { BotManager } from './BotManager';
import { ConfigValidator } from './config/validator';
import { logger } from './utils/logger';

dotenv.config();

(async () => {
  // 環境変数の検証
  const validation = ConfigValidator.validateEnvironment();
  
  if (!validation.valid) {
    logger.fatal('Configuration validation failed', null, {
      errors: validation.errors
    });
    process.exit(1);
  }
  
  const config = validation.sanitized;
  const port = config.PORT || '3000';
  
  // Create bot manager
  const botManager = new BotManager();
  
  // Add Slack bot if credentials are provided
  if (config.SLACK_BOT_TOKEN && config.SLACK_SIGNING_SECRET && config.SLACK_APP_TOKEN) {
    logger.info('Slack credentials validated, adding Slack bot');
    botManager.addSlackBot(
      config.SLACK_BOT_TOKEN,
      config.SLACK_SIGNING_SECRET,
      config.SLACK_APP_TOKEN
    );
  }
  
  // Add Discord bot if token is provided
  if (config.DISCORD_BOT_TOKEN) {
    logger.info('Discord token validated, adding Discord bot');
    botManager.addDiscordBot(config.DISCORD_BOT_TOKEN);
  }
  
  // Start all bots
  await botManager.startAll();
  
  // Simple health check server for Docker
  const healthServer = http.createServer((req, res) => {
    if (req.url === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'healthy' }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  
  healthServer.listen(port, () => {
    logger.info('Health check server started', { port });
  });
  
  // Graceful shutdown
  // グレースフルシャットダウンの改善
  let isShuttingDown = false;
  
  const shutdown = async (signal: string) => {
    if (isShuttingDown) {
      logger.warn('Shutdown already in progress', { signal });
      return;
    }
    
    isShuttingDown = true;
    logger.info('Received shutdown signal, shutting down gracefully', { signal });
    
    try {
      // タイムアウトを設定してシャットダウン
      const shutdownTimeout = setTimeout(() => {
        logger.error('Graceful shutdown timeout, forcing exit');
        process.exit(1);
      }, 30000); // 30秒のタイムアウト
      
      await botManager.stopAll();
      
      await new Promise<void>((resolve) => {
        healthServer.close((err) => {
          if (err) {
            logger.error('Error closing health server', err);
          }
          resolve();
        });
      });
      
      clearTimeout(shutdownTimeout);
      logger.info('Shutdown complete');
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown', error);
      process.exit(1);
    }
  };
  
  // 複数のシグナルに対応
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGUSR2', () => shutdown('SIGUSR2')); // nodemon用
  
  // 未処理のエラーをキャッチ
  process.on('uncaughtException', (error) => {
    logger.fatal('Uncaught exception', error);
    shutdown('uncaughtException');
  });
  
  process.on('unhandledRejection', (reason, promise) => {
    logger.fatal('Unhandled rejection', reason as any, { promise });
    shutdown('unhandledRejection');
  });
})();