import axios, { AxiosInstance } from 'axios';

interface ClaudeCodeRequest {
  prompt: string;
  files?: string[];
  mode?: 'chat' | 'code' | 'architect';
}

interface ClaudeCodeResponse {
  response: string;
  error?: string;
}

export class ClaudeCodeClient {
  private client: AxiosInstance;

  constructor(baseUrl: string = 'http://localhost:5173') {
    this.client = axios.create({
      baseURL: baseUrl,
      timeout: 300000, // 5 minute timeout for long operations
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  async sendPrompt(request: ClaudeCodeRequest): Promise<ClaudeCodeResponse> {
    try {
      const response = await this.client.post('/api/chat', {
        prompt: request.prompt,
        files: request.files || [],
        mode: request.mode || 'chat',
      });
      
      return {
        response: response.data.response || response.data,
      };
    } catch (error) {
      console.error('Error calling Claude Code:', error);
      
      if (axios.isAxiosError(error)) {
        return {
          response: '',
          error: error.response?.data?.error || error.message || 'Failed to connect to Claude Code',
        };
      }
      
      return {
        response: '',
        error: 'An unexpected error occurred',
      };
    }
  }

  async checkHealth(): Promise<boolean> {
    try {
      const response = await this.client.get('/health');
      return response.status === 200;
    } catch (error) {
      console.error('Claude Code health check failed:', error);
      return false;
    }
  }
}