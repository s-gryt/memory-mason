'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildDailyFilePath, buildDailyHeader } = require('../lib/vault');
const { tryObsidianCli, appendToDaily } = require('../lib/writer');

const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path') || 'PATH';

const createTempDir = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

const loadWriterWithSpawn = (spawnImpl) => {
  const childProcess = require('child_process');
  const originalSpawnSync = childProcess.spawnSync;

  childProcess.spawnSync = spawnImpl;
  delete require.cache[require.resolve('../lib/writer')];

  try {
    return require('../lib/writer');
  } finally {
    childProcess.spawnSync = originalSpawnSync;
  }
};

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
  it('falls back to fs when obsidian CLI is unavailable', () => {
    const vaultPath = createTempDir('memory-mason-vault-');
    const subfolder = 'ai-knowledge';
    const today = '2026-04-26';
    const content = '\n**[12:00:00] Write**\nhello\n';
    const originalPath = process.env[pathKey];
    process.env[pathKey] = '';

    try {
      appendToDaily(vaultPath, subfolder, today, content);
      const dailyPath = buildDailyFilePath(vaultPath, subfolder, today);
      expect(fs.existsSync(dailyPath)).toBe(true);
      expect(fs.readFileSync(dailyPath, 'utf-8')).toBe(buildDailyHeader(today) + content);
    } finally {
      process.env[pathKey] = originalPath;
      fs.rmSync(vaultPath, { recursive: true, force: true });
    }
  });

  it('throws when content is not a string', () => {
    expect(() => appendToDaily('/tmp/vault', 'ai-knowledge', '2026-04-26', null)).toThrow(
      'content must be a string'
    );
  });

  it('falls back to fs when obsidian CLI reports success but no file is created', () => {
    const vaultPath = createTempDir('memory-mason-vault-');
    const subfolder = 'ai-knowledge';
    const today = '2026-04-26';
    const content = '\n**[12:00:00] Write**\nhello\n';
    const shimDir = createTempDir('memory-mason-obsidian-noop-');
    const shimPath =
      process.platform === 'win32' ? path.join(shimDir, 'obsidian.cmd') : path.join(shimDir, 'obsidian');
    const shimContent = process.platform === 'win32' ? '@echo off\r\nexit /b 0\r\n' : '#!/usr/bin/env sh\nexit 0\n';
    fs.writeFileSync(shimPath, shimContent, 'utf-8');

    if (process.platform !== 'win32') {
      fs.chmodSync(shimPath, 0o755);
    }

    const originalPath = process.env[pathKey];
    process.env[pathKey] = shimDir + path.delimiter + (typeof originalPath === 'string' ? originalPath : '');

    try {
      appendToDaily(vaultPath, subfolder, today, content);
      const dailyPath = buildDailyFilePath(vaultPath, subfolder, today);
      expect(fs.existsSync(dailyPath)).toBe(true);
      expect(fs.readFileSync(dailyPath, 'utf-8')).toBe(buildDailyHeader(today) + content);
    } finally {
      process.env[pathKey] = originalPath;
      fs.rmSync(vaultPath, { recursive: true, force: true });
      fs.rmSync(shimDir, { recursive: true, force: true });
    }
  });

  it('keeps CLI-created file when obsidian create succeeds', () => {
    const vaultPath = createTempDir('memory-mason-vault-');
    const subfolder = 'ai-knowledge';
    const today = '2026-04-26';
    const content = '\n**[12:00:00] Write**\nhello\n';
    const { appendToDaily: appendToDailyWithMock } = loadWriterWithSpawn((command, args, options) => {
      const action = args.find((arg) => arg === 'create' || arg === 'append');
      const relativePath = args.find((arg) => arg.startsWith('path=')).slice(5);
      const payload = args.find((arg) => arg.startsWith('content=')).slice(8);
      const targetPath = path.join(options.cwd, relativePath);

      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      if (action === 'create') {
        fs.writeFileSync(targetPath, 'CLI\n' + payload, 'utf-8');
      }

      return { status: 0, error: null };
    });

    try {
      appendToDailyWithMock(vaultPath, subfolder, today, content);
      const dailyPath = buildDailyFilePath(vaultPath, subfolder, today);
      expect(fs.readFileSync(dailyPath, 'utf-8')).toBe('CLI\n' + buildDailyHeader(today) + content);
    } finally {
      fs.rmSync(vaultPath, { recursive: true, force: true });
    }
  });

  it('keeps CLI-appended file when obsidian append succeeds', () => {
    const vaultPath = createTempDir('memory-mason-vault-');
    const subfolder = 'ai-knowledge';
    const today = '2026-04-26';
    const content = '\n**[12:00:00] Write**\nhello\n';
    const dailyPath = buildDailyFilePath(vaultPath, subfolder, today);
    const { appendToDaily: appendToDailyWithMock } = loadWriterWithSpawn((command, args, options) => {
      const action = args.find((arg) => arg === 'create' || arg === 'append');
      const relativePath = args.find((arg) => arg.startsWith('path=')).slice(5);
      const payload = args.find((arg) => arg.startsWith('content=')).slice(8);
      const targetPath = path.join(options.cwd, relativePath);

      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      if (action === 'append') {
        fs.appendFileSync(targetPath, payload + '\ncli-append\n', 'utf-8');
      }

      return { status: 0, error: null };
    });

    fs.mkdirSync(path.dirname(dailyPath), { recursive: true });
    fs.writeFileSync(dailyPath, buildDailyHeader(today) + 'before\n', 'utf-8');

    try {
      appendToDailyWithMock(vaultPath, subfolder, today, content);
      const updated = fs.readFileSync(dailyPath, 'utf-8');
      expect(updated.includes('cli-append')).toBe(true);
      expect(updated.split(content).length - 1).toBe(1);
    } finally {
      fs.rmSync(vaultPath, { recursive: true, force: true });
    }
  });
});