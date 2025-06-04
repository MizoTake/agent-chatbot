import dotenv from 'dotenv';
import http from 'http';
import { BotManager } from './BotManager';

dotenv.config();

(async () => {
  const port = process.env.PORT || 3000;
  
  // Create bot manager
  const botManager = new BotManager();
  
  // Add Slack bot if credentials are provided
  if (process.env.SLACK_BOT_TOKEN && process.env.SLACK_SIGNING_SECRET && process.env.SLACK_APP_TOKEN) {
    console.log('📱 Slack credentials found, adding Slack bot...');
    botManager.addSlackBot(
      process.env.SLACK_BOT_TOKEN,
      process.env.SLACK_SIGNING_SECRET,
      process.env.SLACK_APP_TOKEN
    );
  } else {
    console.log('⚠️  Slack credentials not found, skipping Slack bot');
  }
  
  // Add Discord bot if token is provided
  if (process.env.DISCORD_BOT_TOKEN) {
    console.log('🎮 Discord token found, adding Discord bot...');
    botManager.addDiscordBot(process.env.DISCORD_BOT_TOKEN);
  } else {
    console.log('⚠️  Discord token not found, skipping Discord bot');
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
    console.log(`🏥 Health check server running on port ${port}`);
  });
  
  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n⏹️  Shutting down gracefully...');
    await botManager.stopAll();
    healthServer.close();
    process.exit(0);
  });
})();