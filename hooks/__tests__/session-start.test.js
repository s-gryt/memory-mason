'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildDailyFilePath, buildKnowledgeIndexPath } = require('../lib/vault');
const sessionStart = require('../session-start');
const hooksRoot = path.resolve(__dirname, '..');

const tempDirs = [];

const createTempDir = (prefix) => {
  const dirPath = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dirPath);
  return dirPath;
};

const buildEnv = (homeDir, overrides = {}) => ({
  ...process.env,
  PATH: '',
  Path: '',
  HOME: homeDir,
  USERPROFILE: homeDir,
  ...overrides
});

const writeText = (filePath, content) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
};

const buildTranscript = (turnCount, firstUserContent = 'user turn') =>
  Array.from({ length: turnCount }, (_, index) => {
    const isUser = index % 2 === 0;
    const role = isUser ? 'user' : 'assistant';
    const content = isUser && index === 0 ? firstUserContent : role + ' turn ' + index;
    return JSON.stringify({ message: { role, content } });
  }).join('\n');

const buildVsCodeTranscript = (turns) => {
  const entries = [
    {
      type: 'session.start',
      data: {
        sessionId: 'session-1',
        version: 1,
        producer: 'copilot-agent',
        copilotVersion: '0.0.0',
        vscodeVersion: '1.0.0',
        startTime: '2025-01-01T00:00:00.000Z',
        context: { cwd: hooksRoot }
      }
    }
  ].concat(
    turns.flatMap((turn, turnIndex) => {
      const userEntries = [
        {
          type: 'user.message',
          data: { content: turn.user, attachments: [] }
        }
      ];

      if (typeof turn.assistant !== 'string') {
        return userEntries;
      }

      return userEntries.concat([
        {
          type: 'assistant.turn_start',
          data: { turnId: turnIndex + '.0' }
        },
        {
          type: 'assistant.message',
          data: { messageId: 'message-' + turnIndex, content: turn.assistant, toolRequests: [] }
        },
        {
          type: 'assistant.turn_end',
          data: { turnId: turnIndex + '.0' }
        }
      ]);
    })
  );

  return entries
    .map((entry, index) =>
      JSON.stringify({
        ...entry,
        id: 'entry-' + index,
        timestamp: '2025-01-01T00:00:' + String(index).padStart(2, '0') + '.000Z',
        parentId: index === 0 ? null : 'entry-' + (index - 1)
      })
    )
    .join('\n');
};

const runScript = (_scriptName, options = {}) => {
  const stdinText =
    typeof options.stdinText === 'string'
      ? options.stdinText
      : typeof options.payload === 'undefined'
        ? ''
        : JSON.stringify(options.payload);
  const env = typeof options.env === 'object' && options.env !== null ? options.env : process.env;
  const homedir = typeof env.USERPROFILE === 'string' && env.USERPROFILE !== '' ? env.USERPROFILE : os.homedir();
  const extraRuntime = typeof options.runtime === 'object' && options.runtime !== null ? options.runtime : {};
  const runtime = {
    cwd: typeof options.cwd === 'string' ? options.cwd : hooksRoot,
    env,
    homedir,
    ...extraRuntime
  };

  return sessionStart.run(stdinText, runtime);
};

const today = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
};

const yesterday = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const pad = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
};

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe('entrypoint config readers', () => {
  it('reads .env text for session-start.js', () => {
    const cwd = createTempDir('memory-mason-cwd-');
    const envText = 'MEMORY_MASON_VAULT_PATH=/vault/path\nMEMORY_MASON_SUBFOLDER=notes';

    writeText(path.join(cwd, '.env'), envText);

    expect(sessionStart.readDotEnvText(cwd)).toBe(envText);
    expect(sessionStart.readDotEnvText(createTempDir('memory-mason-cwd-empty-'))).toBe('');
  });

  it('reads global config text for session-start.js', () => {
    const homeDir = createTempDir('memory-mason-home-');
    const configText = JSON.stringify({ vaultPath: '/vault', subfolder: 'notes' });

    writeText(path.join(homeDir, '.memory-mason', 'config.json'), configText);

    expect(sessionStart.readGlobalConfigText(homeDir)).toBe(configText);
    expect(sessionStart.readGlobalConfigText(createTempDir('memory-mason-home-empty-'))).toBe('');
  });

  it('reads global .env text for session-start.js', () => {
    const homeDir = createTempDir('memory-mason-home-');
    const envText = 'MEMORY_MASON_VAULT_PATH=~/vault\nMEMORY_MASON_SUBFOLDER=global-brain';

    writeText(path.join(homeDir, '.memory-mason', '.env'), envText);

    expect(sessionStart.readGlobalDotEnvText(homeDir)).toBe(envText);
    expect(sessionStart.readGlobalDotEnvText(createTempDir('memory-mason-home-empty-'))).toBe('');
  });
});

describe('session-start.js', () => {
  it('reads memory-mason.json and returns KB context with today log', () => {
    const cwd = createTempDir('memory-mason-cwd-');
    const vaultPath = createTempDir('memory-mason-vault-');
    const configPath = path.join(cwd, 'memory-mason.json');
    const indexPath = buildKnowledgeIndexPath(vaultPath, 'ai-knowledge');
    const dailyPath = buildDailyFilePath(vaultPath, 'ai-knowledge', today());

    writeText(configPath, JSON.stringify({ vaultPath, subfolder: 'ai-knowledge' }));
    writeText(indexPath, '# Index\n\n[[Topic]]');
    writeText(dailyPath, '# Daily Log\n\nrecent line');

    const result = runScript('session-start.js', { payload: { cwd }, cwd, env: buildEnv(cwd) });
    const parsed = JSON.parse(result.stdout);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(parsed.hookSpecificOutput.hookEventName).toBe('SessionStart');
    expect(parsed.hookSpecificOutput.additionalContext).toContain('[[Topic]]');
    expect(parsed.hookSpecificOutput.additionalContext).toContain('recent line');
  });

  it('falls back to yesterday log when today log missing', () => {
    const homeDir = createTempDir('memory-mason-home-');
    const vaultPath = createTempDir('memory-mason-vault-');
    const dailyPath = buildDailyFilePath(vaultPath, 'ai-knowledge', yesterday());

    writeText(dailyPath, '# Daily Log\n\nyesterday line');

    const result = runScript('session-start.js', {
      payload: { cwd: hooksRoot },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath })
    });
    const parsed = JSON.parse(result.stdout);

    expect(result.status).toBe(0);
    expect(parsed.hookSpecificOutput.additionalContext).toContain('yesterday line');
  });

  it('uses empty placeholders when KB files are missing', () => {
    const homeDir = createTempDir('memory-mason-home-');
    const vaultPath = createTempDir('memory-mason-vault-');

    const result = runScript('session-start.js', {
      payload: { cwd: hooksRoot },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath })
    });
    const parsed = JSON.parse(result.stdout);

    expect(result.status).toBe(0);
    expect(parsed.hookSpecificOutput.additionalContext).toContain('(empty - no articles compiled yet)');
    expect(parsed.hookSpecificOutput.additionalContext).toContain('(no recent daily log)');
  });

  it('uses global config fallback when project config and env var are absent', () => {
    const cwd = createTempDir('memory-mason-cwd-');
    const homeDir = createTempDir('memory-mason-home-');
    const vaultPath = createTempDir('memory-mason-vault-');
    const dailyPath = buildDailyFilePath(vaultPath, 'global-brain', today());

    writeText(path.join(homeDir, '.memory-mason', 'config.json'), JSON.stringify({ vaultPath, subfolder: 'global-brain' }));
    writeText(dailyPath, '# Daily Log\n\nfrom global config');

    const result = runScript('session-start.js', { payload: { cwd }, cwd, env: buildEnv(homeDir) });
    const parsed = JSON.parse(result.stdout);

    expect(result.status).toBe(0);
    expect(parsed.hookSpecificOutput.additionalContext).toContain('from global config');
  });

  it('uses .env fallback when project config and env var are absent', () => {
    const cwd = createTempDir('memory-mason-cwd-');
    const homeDir = createTempDir('memory-mason-home-');
    const vaultPath = createTempDir('memory-mason-vault-');
    const dailyPath = buildDailyFilePath(vaultPath, 'dotenv-brain', today());

    writeText(path.join(cwd, '.env'), `MEMORY_MASON_VAULT_PATH=${vaultPath}\nMEMORY_MASON_SUBFOLDER=dotenv-brain`);
    writeText(dailyPath, '# Daily Log\n\nfrom dotenv config');

    const result = runScript('session-start.js', { payload: { cwd }, cwd, env: buildEnv(homeDir) });
    const parsed = JSON.parse(result.stdout);

    expect(result.status).toBe(0);
    expect(parsed.hookSpecificOutput.additionalContext).toContain('from dotenv config');
  });

  it('reports invalid stdin to stderr', () => {
    const homeDir = createTempDir('memory-mason-home-');
    const vaultPath = createTempDir('memory-mason-vault-');

    const result = runScript('session-start.js', {
      stdinText: '{not-json',
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath })
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('invalid JSON in stdin: {not-json');
  });
});

describe('session-start.js readStdin', () => {
  it('returns valid JSON string from mocked fd 0', () => {
    const payload = JSON.stringify({ cwd: '/tmp', hookEventName: 'SessionStart' });
    const payloadBuffer = Buffer.from(payload, 'utf-8');
    let callCount = 0;
    const mockFs = {
      readSync(fd, chunk) {
        if (callCount === 0) { callCount++; payloadBuffer.copy(chunk, 0, 0, payloadBuffer.length); return payloadBuffer.length; }
        return 0;
      }
    };
    expect(sessionStart.readStdin(mockFs)).toBe(payload);
  });

  it('returns empty string when fd 0 yields zero bytes immediately', () => {
    expect(sessionStart.readStdin({ readSync: () => 0 })).toBe('');
  });

  it('concatenates multiple chunks before EOF', () => {
    const part1 = Buffer.from('{"cwd":');
    const part2 = Buffer.from('"/tmp"}');
    let callCount = 0;
    const mockFs = {
      readSync(fd, chunk) {
        if (callCount === 0) { callCount++; part1.copy(chunk); return part1.length; }
        if (callCount === 1) { callCount++; part2.copy(chunk); return part2.length; }
        return 0;
      }
    };
    expect(sessionStart.readStdin(mockFs)).toBe('{"cwd":"/tmp"}');
  });
});

describe('session-start.js main', () => {
  it('writes stdout and calls exit with status 0 on success', () => {
    const homeDir = createTempDir('mm-home-');
    const vaultPath = createTempDir('mm-vault-');
    const cwd = createTempDir('mm-cwd-');
    writeText(path.join(cwd, 'memory-mason.json'), JSON.stringify({ vaultPath, subfolder: 'ai-knowledge' }));
    const payload = JSON.stringify({ cwd });
    const buf = Buffer.from(payload);
    let rc = 0;
    const writes = []; const errors = []; let exitCode = null;
    sessionStart.main({
      io: { stdout: (t) => writes.push(t), stderr: (t) => errors.push(t), exit: (c) => { exitCode = c; } },
      fs: { readSync(fd, chunk) { if (rc === 0) { rc++; buf.copy(chunk); return buf.length; } return 0; } },
      cwd, env: buildEnv(homeDir), homedir: homeDir
    });
    expect(exitCode).toBe(0);
    expect(writes.length).toBeGreaterThan(0);
    expect(errors).toHaveLength(0);
  });

  it('writes stderr when config is missing and still exits 0', () => {
    const homeDir = createTempDir('mm-home-');
    const payload = JSON.stringify({ cwd: createTempDir('mm-nocfg-') });
    const buf = Buffer.from(payload);
    let rc = 0;
    const writes = []; const errors = []; let exitCode = null;
    sessionStart.main({
      io: { stdout: (t) => writes.push(t), stderr: (t) => errors.push(t), exit: (c) => { exitCode = c; } },
      fs: { readSync(fd, chunk) { if (rc === 0) { rc++; buf.copy(chunk); return buf.length; } return 0; } },
      cwd: createTempDir('mm-fb-'), env: buildEnv(homeDir), homedir: homeDir
    });
    expect(exitCode).toBe(0);
    expect(errors.join('')).toContain('memory-mason.json not found');
  });

  it('uses io fallback functions when stdout/stderr not provided', () => {
    const homeDir = createTempDir('mm-home-');
    const vaultPath = createTempDir('mm-vault-');
    const payload = JSON.stringify({ cwd: homeDir });
    const buf = Buffer.from(payload);
    let rc = 0;
    let exitCode = null;
    const result = sessionStart.main({
      io: { exit: (c) => { exitCode = c; } },
      fs: { readSync(fd, chunk) { if (rc === 0) { rc++; buf.copy(chunk); return buf.length; } return 0; } },
      cwd: homeDir, env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }), homedir: homeDir
    });
    expect(result.status).toBe(0);
    expect(exitCode).toBe(0);
  });
});

describe('session-start.js runtime fallback branches', () => {
  it('falls back to process defaults when runtime properties are invalid', () => {
    const result = sessionStart.run(JSON.stringify({ cwd: createTempDir('mm-cwd-') }), { env: null, cwd: 123, homedir: 42 });
    expect(result.status).toBe(0);
  });

  it('uses fallbackCwd when input has no cwd', () => {
    const homeDir = createTempDir('mm-home-');
    const vaultPath = createTempDir('mm-vault-');
    const result = sessionStart.run(JSON.stringify({}), {
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
      cwd: createTempDir('mm-fb-cwd-'), homedir: homeDir
    });
    expect(result.status).toBe(0);
  });

  it('handles non-Error throw via String coercion', () => {
    const result = sessionStart.run('not-json-at-all', {});
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('invalid JSON');
  });
});
