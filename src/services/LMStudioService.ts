import { createLogger } from '../utils/logger';

const logger = createLogger('LMStudioService');

export class LMStudioService {
  async fetchModels(baseUrl: string): Promise<string[]> {
    try {
      const url = `${baseUrl.replace(/\/+$/, '')}/v1/models`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (!response.ok) {
        return [];
      }
      const body = await response.json() as { data?: Array<{ id: string }> };
      return (body.data || []).map(model => model.id).filter(Boolean);
    } catch {
      return [];
    }
  }

  async warmupModel(baseUrl: string, model: string): Promise<boolean> {
    try {
      const url = `${baseUrl.replace(/\/+$/, '')}/v1/chat/completions`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 1
        }),
        signal: controller.signal
      });
      clearTimeout(timeout);
      if (!response.ok) {
        logger.warn('LMStudio warmup request failed', { status: response.status });
        return false;
      }
      await response.json().catch(() => {});
      logger.info('LMStudio model warmed up', { model });
      return true;
    } catch (error) {
      logger.warn('LMStudio warmup failed', { error: error instanceof Error ? error.message : String(error) });
      return false;
    }
  }
}
