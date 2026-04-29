'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { buildDailyFilePath } = require('../lib/vault');
const { buildCommandErrorResult, formatErrorMessage, writeIfPresent } = require('../lib/cli');

const hooksRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(hooksRoot, '..');
let tempDirs = [];

const createTempDir = (prefix) => {
  const dirPath = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs = tempDirs.concat(dirPath);
  return dirPath;
};

const writeText = (filePath, content) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
};

const buildEnv = (homeDir, overrides = {}) => ({
  ...process.env,
  HOME: homeDir,
  USERPROFILE: homeDir,
  ...overrides
});

const today = () => {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
};

const buildTranscript = (turnCount, firstUserContent = 'user turn') =>
  Array.from({ length: turnCount }, (_, index) => {
    const isUser = index % 2 === 0;
    const role = isUser ? 'user' : 'assistant';
    const content = isUser && index === 0 ? firstUserContent : role + ' turn ' + index;
    return JSON.stringify({ message: { role, content } });
  }).join('\n');

const runCli = (scriptName, options = {}) =>
  spawnSync(process.execPath, [path.join(hooksRoot, scriptName)].concat(options.args || []), {
    cwd: typeof options.cwd === 'string' ? options.cwd : hooksRoot,
    env: typeof options.env === 'object' && options.env !== null ? options.env : process.env,
    input: typeof options.input === 'string' ? options.input : '',
    encoding: 'utf-8'
  });

afterEach(() => {
  tempDirs.forEach((dirPath) => {
    fs.rmSync(dirPath, { recursive: true, force: true });
  });
  tempDirs = [];
});

describe('lib/cli.js', () => {
  it('formats Error and non-Error values', () => {
    expect(formatErrorMessage(new Error('boom'))).toBe('boom');
    expect(formatErrorMessage('plain')).toBe('plain');
  });

  it('builds command error result with trailing newline', () => {
    expect(buildCommandErrorResult('plain')).toEqual({
      status: 0,
      stdout: '',
      stderr: 'plain\n'
    });
  });

  it('writes only non-empty text', () => {
    const writes = [];
    writeIfPresent('', (text) => writes.push(text));
    writeIfPresent('ok', (text) => writes.push(text));
    expect(writes).toEqual(['ok']);
  });
});

describe('CLI direct execution', () => {
  it('executes session-start.js directly', () => {
    const homeDir = createTempDir('mm-home-');
    const vaultPath = createTempDir('mm-vault-');
    const result = runCli('session-start.js', {
      input: JSON.stringify({ cwd: hooksRoot }),
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath })
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"hookEventName":"SessionStart"');
  });

  it('executes user-prompt-submit.js directly', () => {
    const homeDir = createTempDir('mm-home-');
    const vaultPath = createTempDir('mm-vault-');
    const result = runCli('user-prompt-submit.js', {
      input: JSON.stringify({ hookEventName: 'user-prompt-submit', cwd: hooksRoot, prompt: 'cli prompt' }),
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath })
    });

    expect(result.status).toBe(0);
    expect(fs.readFileSync(buildDailyFilePath(vaultPath, 'ai-knowledge', today()), 'utf-8')).toContain('cli prompt');
  });

  it('executes post-tool-use.js directly', () => {
    const homeDir = createTempDir('mm-home-');
    const vaultPath = createTempDir('mm-vault-');
    const result = runCli('post-tool-use.js', {
      input: JSON.stringify({ hook_event_name: 'PostToolUse', cwd: hooksRoot, tool_name: 'Bash', tool_response: 'cli tool output' }),
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath })
    });

    expect(result.status).toBe(0);
    expect(fs.readFileSync(buildDailyFilePath(vaultPath, 'ai-knowledge', today()), 'utf-8')).toContain('cli tool output');
  });

  it('executes pre-compact.js directly', () => {
    const result = runCli('pre-compact.js', {
      input: '{bad-json',
      env: buildEnv(createTempDir('mm-home-'))
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('invalid JSON in stdin');
  });

  it('executes session-end.js directly', () => {
    const homeDir = createTempDir('mm-home-');
    const vaultPath = createTempDir('mm-vault-');
    const transcriptPath = path.join(createTempDir('mm-tr-'), 'session.jsonl');

    writeText(transcriptPath, buildTranscript(2));

    const result = runCli('session-end.js', {
      input: JSON.stringify({ hook_event_name: 'session_end', cwd: hooksRoot, transcript_path: transcriptPath, session_id: 'cli-session', source: 'stop' }),
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath })
    });

    expect(result.status).toBe(0);
    expect(fs.readFileSync(buildDailyFilePath(vaultPath, 'ai-knowledge', today()), 'utf-8')).toContain('cli-session / stop');
  });

  it('executes install-copilot-hooks.js directly', () => {
    const homeDir = createTempDir('mm-home-');
    const result = runCli('install-copilot-hooks.js', {
      cwd: repoRoot,
      env: buildEnv(homeDir)
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Installed Memory Mason Copilot hooks');
    expect(fs.existsSync(path.join(homeDir, '.copilot', 'hooks', 'session-start.json'))).toBe(true);
  });

  it('executes uninstall-copilot-hooks.js directly', () => {
    const homeDir = createTempDir('mm-home-');

    runCli('install-copilot-hooks.js', {
      cwd: repoRoot,
      env: buildEnv(homeDir)
    });

    const result = runCli('uninstall-copilot-hooks.js', {
      cwd: repoRoot,
      env: buildEnv(homeDir)
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Removed Memory Mason Copilot hooks');
    expect(fs.existsSync(path.join(homeDir, '.copilot', 'hooks', 'session-start.json'))).toBe(false);
  });
});