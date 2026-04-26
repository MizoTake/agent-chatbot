const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function collectTestFiles(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectTestFiles(fullPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.test.js')) {
      files.push(fullPath);
    }
  }

  return files;
}

const distDirectory = path.resolve(__dirname, '..', 'dist');

if (!fs.existsSync(distDirectory)) {
  console.error('dist ディレクトリがありません。先に npm run build を実行してください。');
  process.exit(1);
}

const testFiles = collectTestFiles(distDirectory).sort();

if (testFiles.length === 0) {
  console.error('dist 配下に .test.js ファイルがありません。');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...testFiles], { stdio: 'inherit' });

if (result.error) {
  console.error(`テスト実行に失敗しました: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
