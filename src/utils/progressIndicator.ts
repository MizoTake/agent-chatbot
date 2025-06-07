/**
 * 進捗表示のためのユーティリティ
 */

export interface ProgressUpdate {
  stage: string;
  progress?: number; // 0-100
  message?: string;
  estimatedTimeRemaining?: number; // 秒
}

export class ProgressIndicator {
  private static readonly PROGRESS_STAGES = {
    INITIALIZING: { emoji: '🔄', text: '初期化中' },
    CLONING: { emoji: '📥', text: 'リポジトリをクローン中' },
    PROCESSING: { emoji: '⚙️', text: '処理中' },
    ANALYZING: { emoji: '🔍', text: '分析中' },
    GENERATING: { emoji: '✨', text: '生成中' },
    FINALIZING: { emoji: '📝', text: '最終処理中' },
    COMPLETED: { emoji: '✅', text: '完了' },
    ERROR: { emoji: '❌', text: 'エラー' }
  };

  private static readonly LOADING_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  private static frameIndex = 0;

  /**
   * プログレスバーを生成
   */
  static createProgressBar(progress: number, width: number = 20): string {
    const filled = Math.floor((progress / 100) * width);
    const empty = width - filled;
    return `[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${progress}%`;
  }

  /**
   * アニメーションフレームを取得
   */
  static getLoadingFrame(): string {
    const frame = this.LOADING_FRAMES[this.frameIndex];
    this.frameIndex = (this.frameIndex + 1) % this.LOADING_FRAMES.length;
    return frame;
  }

  /**
   * 進捗メッセージをフォーマット
   */
  static formatProgress(update: ProgressUpdate): string {
    const stage = (this.PROGRESS_STAGES as any)[update.stage] || { emoji: '🔄', text: update.stage };
    let message = `${stage.emoji} ${stage.text}`;

    if (update.progress !== undefined) {
      message += `\n${this.createProgressBar(update.progress)}`;
    }

    if (update.message) {
      message += `\n${update.message}`;
    }

    if (update.estimatedTimeRemaining) {
      const time = this.formatTime(update.estimatedTimeRemaining);
      message += `\n⏱️ 推定残り時間: ${time}`;
    }

    return message;
  }

  /**
   * 時間をフォーマット
   */
  static formatTime(seconds: number): string {
    if (seconds < 60) {
      return `${seconds}秒`;
    } else if (seconds < 3600) {
      const minutes = Math.floor(seconds / 60);
      const secs = seconds % 60;
      return secs > 0 ? `${minutes}分${secs}秒` : `${minutes}分`;
    } else {
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      return minutes > 0 ? `${hours}時間${minutes}分` : `${hours}時間`;
    }
  }

  /**
   * ステップインジケーターを生成
   */
  static createStepIndicator(currentStep: number, totalSteps: number, steps: string[]): string {
    let indicator = `ステップ ${currentStep}/${totalSteps}\n\n`;
    
    steps.forEach((step, index) => {
      const stepNumber = index + 1;
      if (stepNumber < currentStep) {
        indicator += `✅ ${step}\n`;
      } else if (stepNumber === currentStep) {
        indicator += `${this.getLoadingFrame()} ${step} ←\n`;
      } else {
        indicator += `⏳ ${step}\n`;
      }
    });

    return indicator;
  }

  /**
   * タスクリストを生成
   */
  static createTaskList(tasks: Array<{ name: string; completed: boolean; inProgress?: boolean }>): string {
    return tasks.map(task => {
      if (task.completed) {
        return `✅ ${task.name}`;
      } else if (task.inProgress) {
        return `${this.getLoadingFrame()} ${task.name}`;
      } else {
        return `⬜ ${task.name}`;
      }
    }).join('\n');
  }

  /**
   * 処理時間の推定
   */
  static estimateTimeRemaining(processed: number, total: number, elapsedSeconds: number): number {
    if (processed === 0) return 0;
    const rate = processed / elapsedSeconds;
    const remaining = total - processed;
    return Math.ceil(remaining / rate);
  }

  /**
   * 詳細な進捗レポートを生成
   */
  static createDetailedReport(data: {
    title: string;
    currentOperation: string;
    progress?: number;
    subTasks?: Array<{ name: string; status: 'pending' | 'running' | 'completed' | 'failed' }>;
    metrics?: Record<string, string | number>;
    startTime?: Date;
  }): string {
    let report = `📊 **${data.title}**\n\n`;
    
    // 現在の操作
    report += `🔄 ${data.currentOperation}\n`;
    
    // プログレスバー
    if (data.progress !== undefined) {
      report += `\n${this.createProgressBar(data.progress)}\n`;
    }
    
    // サブタスク
    if (data.subTasks && data.subTasks.length > 0) {
      report += '\n**タスク:**\n';
      data.subTasks.forEach(task => {
        const icon = {
          pending: '⏳',
          running: this.getLoadingFrame(),
          completed: '✅',
          failed: '❌'
        }[task.status];
        report += `${icon} ${task.name}\n`;
      });
    }
    
    // メトリクス
    if (data.metrics && Object.keys(data.metrics).length > 0) {
      report += '\n**詳細:**\n';
      Object.entries(data.metrics).forEach(([key, value]) => {
        report += `• ${key}: ${value}\n`;
      });
    }
    
    // 経過時間
    if (data.startTime) {
      const elapsed = Math.floor((Date.now() - data.startTime.getTime()) / 1000);
      report += `\n⏱️ 経過時間: ${this.formatTime(elapsed)}`;
    }
    
    return report;
  }
}