import { App } from '@slack/bolt';
import dotenv from 'dotenv';
import { ClaudeCodeClient } from './claudeCodeClient';
import http from 'http';

dotenv.config();

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
});

const claudeClient = new ClaudeCodeClient(process.env.CLAUDE_CODE_URL || 'http://localhost:5173');

app.command('/claude', async ({ command, ack, respond }) => {
  await ack();

  try {
    const isHealthy = await claudeClient.checkHealth();
    
    if (!isHealthy) {
      await respond({
        text: '❌ Claude Code server is not reachable. Please check if it\'s running.',
      });
      return;
    }

    if (!command.text) {
      await respond({
        text: '📝 Please provide a prompt. Usage: `/claude <your prompt>`',
      });
      return;
    }

    await respond({
      text: '🤔 Thinking...',
    });

    const result = await claudeClient.sendPrompt({
      prompt: command.text,
      mode: 'chat',
    });

    if (result.error) {
      await respond({
        text: `❌ Error: ${result.error}`,
      });
    } else {
      await respond({
        text: result.response,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Claude says:*\n${result.response}`,
            },
          },
        ],
      });
    }
  } catch (error) {
    console.error('Error handling /claude command:', error);
    await respond({
      text: '❌ An unexpected error occurred.',
    });
  }
});

app.command('/claude-code', async ({ command, ack, respond }) => {
  await ack();

  try {
    const isHealthy = await claudeClient.checkHealth();
    
    if (!isHealthy) {
      await respond({
        text: '❌ Claude Code server is not reachable. Please check if it\'s running.',
      });
      return;
    }

    if (!command.text) {
      await respond({
        text: '📝 Please provide a code-related prompt. Usage: `/claude-code <your coding task>`',
      });
      return;
    }

    await respond({
      text: '💻 Working on your code...',
    });

    const result = await claudeClient.sendPrompt({
      prompt: command.text,
      mode: 'code',
    });

    if (result.error) {
      await respond({
        text: `❌ Error: ${result.error}`,
      });
    } else {
      await respond({
        text: result.response,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Code Response:*\n\`\`\`${result.response}\`\`\``,
            },
          },
        ],
      });
    }
  } catch (error) {
    console.error('Error handling /claude-code command:', error);
    await respond({
      text: '❌ An unexpected error occurred.',
    });
  }
});

app.event('app_mention', async ({ event, client }) => {
  try {
    const isHealthy = await claudeClient.checkHealth();
    
    if (!isHealthy) {
      await client.chat.postMessage({
        channel: event.channel,
        text: '❌ Claude Code server is not reachable. Please check if it\'s running.',
      });
      return;
    }

    const mentionText = event.text.replace(/<@[A-Z0-9]+>/g, '').trim();
    
    if (!mentionText) {
      await client.chat.postMessage({
        channel: event.channel,
        text: '👋 Hi! How can I help you? Just mention me with your question.',
      });
      return;
    }

    await client.chat.postMessage({
      channel: event.channel,
      text: '🤔 Let me think about that...',
    });

    const result = await claudeClient.sendPrompt({
      prompt: mentionText,
      mode: 'chat',
    });

    if (result.error) {
      await client.chat.postMessage({
        channel: event.channel,
        text: `❌ Error: ${result.error}`,
      });
    } else {
      await client.chat.postMessage({
        channel: event.channel,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: result.response,
            },
          },
        ],
        text: result.response,
      });
    }
  } catch (error) {
    console.error('Error handling app mention:', error);
    await client.chat.postMessage({
      channel: event.channel,
      text: '❌ An unexpected error occurred.',
    });
  }
});

app.message(async ({ message, client }) => {
  if (message.subtype) return;
  
  const directMessage = message.channel_type === 'im';
  
  if (directMessage && message.text) {
    try {
      const isHealthy = await claudeClient.checkHealth();
      
      if (!isHealthy) {
        await client.chat.postMessage({
          channel: message.channel,
          text: '❌ Claude Code server is not reachable. Please check if it\'s running.',
        });
        return;
      }

      const result = await claudeClient.sendPrompt({
        prompt: message.text,
        mode: 'chat',
      });

      if (result.error) {
        await client.chat.postMessage({
          channel: message.channel,
          text: `❌ Error: ${result.error}`,
        });
      } else {
        await client.chat.postMessage({
          channel: message.channel,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: result.response,
              },
            },
          ],
          text: result.response,
        });
      }
    } catch (error) {
      console.error('Error handling direct message:', error);
      await client.chat.postMessage({
        channel: message.channel,
        text: '❌ An unexpected error occurred.',
      });
    }
  }
});

(async () => {
  const port = process.env.PORT || 3000;
  await app.start();
  console.log(`⚡️ Claude Slack app is running!`);
  
  const isHealthy = await claudeClient.checkHealth();
  console.log(`🔌 Claude Code server status: ${isHealthy ? '✅ Connected' : '❌ Not reachable'}`);
  
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
})();