import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadPromptFile,
  savePromptFile,
  promptFileExists,
  deletePromptFile,
  type PromptFileData,
} from './prompt-file.js';

describe('prompt-file', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(join(tmpdir(), 'prompt-file-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('loadPromptFile', () => {
    it('loads a basic prompt file', async () => {
      const promptPath = join(tempDir, 'test.toml');
      const tomlContent = `
variables = ["Audience", "Duration"]
systemPrompt = "You are a helpful assistant."
userPrompt = "Generate content for {{Audience}}."
`;
      await fs.writeFile(promptPath, tomlContent);

      const result = await loadPromptFile(promptPath);

      expect(result.variables).toEqual(['Audience', 'Duration']);
      expect(result.systemPrompt).toBe('You are a helpful assistant.');
      expect(result.userPrompt).toBe('Generate content for {{Audience}}.');
    });

    it('loads prompt file with config', async () => {
      const promptPath = join(tempDir, 'test.toml');
      const tomlContent = `
systemPrompt = "System prompt"
[config]
temperature = 0.7
max_tokens = 1000
`;
      await fs.writeFile(promptPath, tomlContent);

      const result = await loadPromptFile(promptPath);

      expect(result.systemPrompt).toBe('System prompt');
      expect(result.config).toEqual({ temperature: 0.7, max_tokens: 1000 });
    });

    it('loads prompt file with model and textFormat', async () => {
      const promptPath = join(tempDir, 'test.toml');
      const tomlContent = `
model = "gpt-4"
textFormat = "json_schema"
systemPrompt = "Generate JSON"
`;
      await fs.writeFile(promptPath, tomlContent);

      const result = await loadPromptFile(promptPath);

      expect(result.model).toBe('gpt-4');
      expect(result.textFormat).toBe('json_schema');
    });

    it('returns empty object for minimal file', async () => {
      const promptPath = join(tempDir, 'test.toml');
      await fs.writeFile(promptPath, '');

      const result = await loadPromptFile(promptPath);

      expect(result).toEqual({});
    });

    it('throws error for non-existent file', async () => {
      const promptPath = join(tempDir, 'nonexistent.toml');

      await expect(loadPromptFile(promptPath)).rejects.toThrow();
    });
  });

  describe('savePromptFile', () => {
    it('saves a basic prompt file', async () => {
      const promptPath = join(tempDir, 'output.toml');
      const data: PromptFileData = {
        variables: ['Topic', 'Style'],
        systemPrompt: 'You are creative.',
        userPrompt: 'Write about {{Topic}}.',
      };

      await savePromptFile(promptPath, data);

      const loaded = await loadPromptFile(promptPath);
      expect(loaded.variables).toEqual(['Topic', 'Style']);
      expect(loaded.systemPrompt).toBe('You are creative.');
      expect(loaded.userPrompt).toBe('Write about {{Topic}}.');
    });

    it('creates parent directories if needed', async () => {
      const promptPath = join(tempDir, 'nested', 'deep', 'output.toml');
      const data: PromptFileData = {
        systemPrompt: 'Test',
      };

      await savePromptFile(promptPath, data);

      expect(promptFileExists(promptPath)).toBe(true);
      const loaded = await loadPromptFile(promptPath);
      expect(loaded.systemPrompt).toBe('Test');
    });

    it('saves file with config section', async () => {
      const promptPath = join(tempDir, 'output.toml');
      const data: PromptFileData = {
        systemPrompt: 'Test',
        config: { temperature: 0.5 },
      };

      await savePromptFile(promptPath, data);

      const loaded = await loadPromptFile(promptPath);
      expect(loaded.config).toEqual({ temperature: 0.5 });
    });

    it('omits empty arrays and objects', async () => {
      const promptPath = join(tempDir, 'output.toml');
      const data: PromptFileData = {
        systemPrompt: 'Test',
        variables: [],
        config: {},
      };

      await savePromptFile(promptPath, data);

      const content = await fs.readFile(promptPath, 'utf8');
      // Should not contain variables or config sections
      expect(content).not.toContain('variables');
      expect(content).not.toContain('config');
    });

    it('preserves multi-line strings with triple quotes', async () => {
      const promptPath = join(tempDir, 'multiline.toml');
      const multiLinePrompt = `You are a helpful assistant.

Guidelines:
1. Be concise
2. Be accurate
3. Be friendly

Always respond in a professional manner.`;

      const data: PromptFileData = {
        systemPrompt: multiLinePrompt,
        userPrompt: 'Simple single line prompt',
      };

      await savePromptFile(promptPath, data);

      // Verify the file content uses triple quotes for multi-line
      const content = await fs.readFile(promptPath, 'utf8');
      expect(content).toContain('systemPrompt = """');
      expect(content).not.toContain('\\n'); // Should not have escaped newlines
      expect(content).toContain('Guidelines:'); // Actual newlines preserved

      // Single line prompt should use regular quotes
      expect(content).toContain('userPrompt = "Simple single line prompt"');

      // Verify data round-trips correctly
      const loaded = await loadPromptFile(promptPath);
      expect(loaded.systemPrompt).toBe(multiLinePrompt);
      expect(loaded.userPrompt).toBe('Simple single line prompt');
    });

    it('handles special characters in multi-line strings', async () => {
      const promptPath = join(tempDir, 'special.toml');
      const promptWithSpecialChars = `Line with "quotes" and backslash \\
Next line with tab:\ttab
And some unicode: 你好`;

      const data: PromptFileData = {
        systemPrompt: promptWithSpecialChars,
      };

      await savePromptFile(promptPath, data);

      // Verify data round-trips correctly
      const loaded = await loadPromptFile(promptPath);
      expect(loaded.systemPrompt).toBe(promptWithSpecialChars);
    });
  });

  describe('promptFileExists', () => {
    it('returns true for existing file', async () => {
      const promptPath = join(tempDir, 'exists.toml');
      await fs.writeFile(promptPath, 'systemPrompt = "test"');

      expect(promptFileExists(promptPath)).toBe(true);
    });

    it('returns false for non-existent file', () => {
      const promptPath = join(tempDir, 'nonexistent.toml');

      expect(promptFileExists(promptPath)).toBe(false);
    });
  });

  describe('deletePromptFile', () => {
    it('deletes existing file', async () => {
      const promptPath = join(tempDir, 'to-delete.toml');
      await fs.writeFile(promptPath, 'systemPrompt = "test"');
      expect(promptFileExists(promptPath)).toBe(true);

      await deletePromptFile(promptPath);

      expect(promptFileExists(promptPath)).toBe(false);
    });

    it('does nothing for non-existent file', async () => {
      const promptPath = join(tempDir, 'nonexistent.toml');

      // Should not throw
      await expect(deletePromptFile(promptPath)).resolves.toBeUndefined();
    });
  });
});
