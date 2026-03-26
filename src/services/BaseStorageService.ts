import * as fs from 'fs';
import * as path from 'path';

/**
 * JSON ファイルへの永続化を担う汎用ストレージ基底クラス。
 * サブクラスは型パラメータ T でデータ型を指定する。
 */
export abstract class BaseStorageService<T> {
  protected readonly storageFile: string;
  protected data: Map<string, T>;

  constructor(storageFile: string) {
    this.storageFile = path.resolve(process.cwd(), storageFile);
    this.data = new Map();
    this.loadData();
  }

  protected loadData(): void {
    try {
      if (fs.existsSync(this.storageFile)) {
        const fileContent = fs.readFileSync(this.storageFile, 'utf-8');
        const jsonData = JSON.parse(fileContent);
        this.data = new Map(Object.entries(jsonData));
      }
    } catch (error) {
      console.error(`Failed to load storage data from ${this.storageFile}:`, error);
      this.data = new Map();
    }
  }

  protected saveData(): void {
    try {
      const jsonData = Object.fromEntries(this.data);
      const tempFile = `${this.storageFile}.tmp`;
      fs.writeFileSync(tempFile, JSON.stringify(jsonData, null, 2));
      fs.renameSync(tempFile, this.storageFile);
    } catch (error) {
      console.error(`Failed to save storage data to ${this.storageFile}:`, error);
    }
  }
}
