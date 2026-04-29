'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildDailyFilePath, buildDailyHeader } = require('../lib/vault');
const { tryObsidianCli, appendToDaily } = require('../lib/writer');

const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path') || 'PATH';

const createTempDir = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

afterEach(() => {
  delete require.cache[require.resolve('../lib/writer')];
});

describe('tryObsidianCli', () => {
  it('returns false when obsidian command is not available', () => {
    const originalPath = process.env[pathKey];
    process.env[pathKey] = '';

    try {
      expect(tryObsidianCli(['--version'])).toBe(false);
    } finally {
      process.env[pathKey] = originalPath;
    }
  });

  it('returns true when obsidian shim runs node --version successfully', () => {
    const tempDir = createTempDir('memory-mason-obsidian-');
    const shimPath =
      process.platform === 'win32' ? path.join(tempDir, 'obsidian.cmd') : path.join(tempDir, 'obsidian');
    const shimContent = process.platform === 'win32' ? '@echo off\r\nnode %*\r\n' : '#!/usr/bin/env sh\nnode "$@"\n';
    fs.writeFileSync(shimPath, shimContent, 'utf-8');

    if (process.platform !== 'win32') {
      fs.chmodSync(shimPath, 0o755);
    }

    const originalPath = process.env[pathKey];
    process.env[pathKey] = tempDir + path.delimiter + (typeof originalPath === 'string' ? originalPath : '');

    try {
      expect(tryObsidianCli(['--version'])).toBe(true);
    } finally {
      process.env[pathKey] = originalPath;
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe('appendToDaily', () => {
  it('creates daily file with header when file does not exist', () => {
    const vaultPath = createTempDir('memory-mason-vault-');
    const subfolder = 'ai-knowledge';
    const today = '2026-04-26';
    const content = '\n**[12:00:00] Write**\nhello\n';

    try {
      appendToDaily(vaultPath, subfolder, today, content);
      const dailyPath = buildDailyFilePath(vaultPath, subfolder, today);
      expect(fs.existsSync(dailyPath)).toBe(true);
      expect(fs.readFileSync(dailyPath, 'utf-8')).toBe(buildDailyHeader(today) + content);
    } finally {
      fs.rmSync(vaultPath, { recursive: true, force: true });
    }
  });

  it('throws when content is not a string', () => {
    expect(() => appendToDaily('/tmp/vault', 'ai-knowledge', '2026-04-26', null)).toThrow(
      'content must be a string'
    );
  });

  it('appends to existing daily file without duplicating header', () => {
    const vaultPath = createTempDir('memory-mason-vault-');
    const subfolder = 'ai-knowledge';
    const today = '2026-04-26';
    const dailyPath = buildDailyFilePath(vaultPath, subfolder, today);
    const existingContent = buildDailyHeader(today) + '\n**[11:00:00] Edit**\nfirst\n';

    fs.mkdirSync(path.dirname(dailyPath), { recursive: true });
    fs.writeFileSync(dailyPath, existingContent, 'utf-8');

    try {
      const newContent = '\n**[12:00:00] Write**\nsecond\n';
      appendToDaily(vaultPath, subfolder, today, newContent);

      const updated = fs.readFileSync(dailyPath, 'utf-8');
      expect(updated).toBe(existingContent + newContent);
      expect(updated.split('# Daily Log').length - 1).toBe(1);
    } finally {
      fs.rmSync(vaultPath, { recursive: true, force: true });
    }
  });

  it('does not corrupt content containing special JSON characters', () => {
    const vaultPath = createTempDir('memory-mason-vault-');
    const subfolder = 'ai-knowledge';
    const today = '2026-04-26';
    const sqlContent = '\n**[12:00:00] AssistantReply**\nSELECT * FROM foo WHERE id IN (\'a\', \'b\'] AND x = "y";\n';

    try {
      appendToDaily(vaultPath, subfolder, today, sqlContent);

      const dailyPath = buildDailyFilePath(vaultPath, subfolder, today);
      expect(fs.readFileSync(dailyPath, 'utf-8')).toContain('SELECT * FROM foo');
    } finally {
      fs.rmSync(vaultPath, { recursive: true, force: true });
    }
  });
});