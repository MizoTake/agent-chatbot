import * as fs from 'fs';
import * as path from 'path';
import { describe, it, before, after } from 'node:test';
import assert = require('node:assert');
import { GitService } from './GitService';

// Add delay between parallel tests to avoid race conditions
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('GitService', () => {
  const testReposDir = path.join(process.cwd(), 'test-repos');
  let gitService: GitService;

  before(() => {
    gitService = new GitService(testReposDir);
    if (fs.existsSync(testReposDir)) {
      fs.rmSync(testReposDir, { recursive: true, force: true });
    }
  });

  after(() => {
    if (fs.existsSync(testReposDir)) {
      fs.rmSync(testReposDir, { recursive: true, force: true });
    }
  });

  describe('createRepository', () => {
    it('should create a new repository from scratch', async () => {
      const testRepo = 'test-repo-' + Date.now();
      const testChannel = 'test-channel';
      const result = await gitService.createRepository(testRepo, testChannel);

      assert.ok(result.success, 'Repository creation should succeed');
      assert.ok(result.localPath, 'Local path should be provided');
      assert.ok(fs.existsSync(result.localPath), 'Directory should exist');
      assert.ok(fs.existsSync(path.join(result.localPath, '.git')), '.git directory should exist');
      
      // Verify initial commit exists (check for .gitkeep placeholder file)
      const gitKeepPath = path.join(result.localPath, '.gitkeep');
      assert.ok(fs.existsSync(gitKeepPath), '.gitkeep file should exist');

      // Clean up before next parallel test
      if (result.localPath && fs.existsSync(result.localPath)) {
        fs.rmSync(result.localPath, { recursive: true, force: true });
      }
    });

    it('should reject duplicate repository names', async () => {
      const testRepo = 'duplicate-test-' + Date.now();
      const testChannel = 'test-channel';

      // First creation should succeed
      const firstResult = await gitService.createRepository(testRepo, testChannel);
      assert.ok(firstResult.success, 'First creation should succeed');

      // Second creation with same name should fail
      const secondResult = await gitService.createRepository(testRepo, testChannel);
      assert.ok(!secondResult.success, 'Duplicate creation should fail');
      assert.ok(secondResult.error, 'Error message should be provided');
    });

    it('should reject invalid repository names with path traversal', async () => {
      const testRepo = '..\\..\\evil-repo';
      const testChannel = 'test-channel';

      const result = await gitService.createRepository(testRepo, testChannel);
      assert.ok(!result.success, 'Path traversal attempt should be rejected');
      assert.ok(result.error, 'Error message should be provided');
    });

    it('should reject invalid repository names with special characters', async () => {
      const testRepo = 'repo with spaces & special!@#chars';
      const testChannel = 'test-channel';

      const result = await gitService.createRepository(testRepo, testChannel);
      assert.ok(!result.success, 'Invalid characters should be rejected');
      assert.ok(result.error, 'Error message should be provided');

      // Clean up before next parallel test
      if (result.localPath && fs.existsSync(result.localPath)) {
        fs.rmSync(result.localPath, { recursive: true, force: true });
      }
    });

    it('should create repository in the correct directory structure', async () => {
      const testRepo = 'structure-test-' + Date.now();
      const testChannel = 'test-channel';
      const result = await gitService.createRepository(testRepo, testChannel);

      assert.ok(result.success, 'Repository creation should succeed');
      assert.ok(result.localPath, 'Local path should be provided');
      
      // Verify directory structure
      const parts = result.localPath.split(path.sep);
      assert.ok(parts.includes('test-repos'), 'Should be in test-repos directory');
      assert.ok(parts.includes('test-channel'), 'Should include channel ID');
      assert.ok(parts.some(part => part.includes(testRepo)), 'Should include repo name');
      
      // Verify initial commit exists
      const gitKeepPath = path.join(result.localPath, '.gitkeep');
      assert.ok(fs.existsSync(gitKeepPath), '.gitkeep file should exist');

      // Clean up before next parallel test
      if (result.localPath && fs.existsSync(result.localPath)) {
        fs.rmSync(result.localPath, { recursive: true, force: true });
      }
    });
  });
});
