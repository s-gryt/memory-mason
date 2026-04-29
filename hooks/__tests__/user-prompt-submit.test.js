'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildDailyFilePath } = require('../lib/vault');
const { resolveCaptureStatePath } = require('../lib/capture-state');
const userPromptSubmit = require('../user-prompt-submit');
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

const today = () => {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
};

const yesterday = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const pad = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
};

const buildTranscript = (turnCount, firstUserContent = 'user turn') =>
  Array.from({ length: turnCount }, (_, index) => {
    const isUser = index % 2 === 0;
    const role = isUser ? 'user' : 'assistant';
    const content = isUser && index === 0 ? firstUserContent : role + ' turn ' + index;
    return JSON.stringify({ message: { role, content } });
  }).join('\n');

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

  return userPromptSubmit.run(stdinText, runtime);
};

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe('entrypoint config readers', () => {
  it('reads .env text for user-prompt-submit.js', () => {
    const cwd = createTempDir('memory-mason-cwd-');
    const envText = 'MEMORY_MASON_VAULT_PATH=/vault/path\nMEMORY_MASON_SUBFOLDER=notes';

    writeText(path.join(cwd, '.env'), envText);

    expect(userPromptSubmit.readDotEnvText(cwd)).toBe(envText);
    expect(userPromptSubmit.readDotEnvText(createTempDir('memory-mason-cwd-empty-'))).toBe('');
  });

  it('reads global config text for user-prompt-submit.js', () => {
    const homeDir = createTempDir('memory-mason-home-');
    const configText = JSON.stringify({ vaultPath: '/vault', subfolder: 'notes' });

    writeText(path.join(homeDir, '.memory-mason', 'config.json'), configText);

    expect(userPromptSubmit.readGlobalConfigText(homeDir)).toBe(configText);
    expect(userPromptSubmit.readGlobalConfigText(createTempDir('memory-mason-home-empty-'))).toBe('');
  });

  it('reads global .env text for user-prompt-submit.js', () => {
    const homeDir = createTempDir('memory-mason-home-');
    const envText = 'MEMORY_MASON_VAULT_PATH=~/vault\nMEMORY_MASON_SUBFOLDER=global-brain';

    writeText(path.join(homeDir, '.memory-mason', '.env'), envText);

    expect(userPromptSubmit.readGlobalDotEnvText(homeDir)).toBe(envText);
    expect(userPromptSubmit.readGlobalDotEnvText(createTempDir('memory-mason-home-empty-'))).toBe('');
  });
});

describe('user-prompt-submit.js', () => {
  it('writes prompt into daily log', () => {
    const homeDir = createTempDir('memory-mason-home-');
    const vaultPath = createTempDir('memory-mason-vault-');

    const result = runScript('user-prompt-submit.js', {
      payload: { hookEventName: 'user-prompt-submit', cwd: hooksRoot, prompt: ' /mmq hooks ' },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath })
    });

    const dailyPath = buildDailyFilePath(vaultPath, 'ai-knowledge', today());
    expect(result.status).toBe(0);
    expect(fs.readFileSync(dailyPath, 'utf-8')).toContain('/mmq hooks');
  });

  it('writes rich slash-command metadata for Claude prompt expansion events', () => {
    const homeDir = createTempDir('memory-mason-home-');
    const vaultPath = createTempDir('memory-mason-vault-');

    const result = runScript('user-prompt-submit.js', {
      payload: {
        hook_event_name: 'UserPromptExpansion',
        cwd: hooksRoot,
        prompt: '/caveman analyze attachments',
        expansion_type: 'slash_command',
        command_name: 'caveman:caveman',
        command_args: 'analyze attachments',
        command_source: 'plugin'
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath })
    });

    const dailyPath = buildDailyFilePath(vaultPath, 'ai-knowledge', today());
    const dailyContent = fs.readFileSync(dailyPath, 'utf-8');

    expect(result.status).toBe(0);
    expect(dailyContent).toContain('UserPromptExpansion');
    expect(dailyContent).toContain('/caveman analyze attachments');
    expect(dailyContent).toContain('command: caveman:caveman');
    expect(dailyContent).toContain('source: plugin');
  });

  it('uses custom subfolder from memory-mason.json when env vault path is set', () => {
    const cwd = createTempDir('memory-mason-cwd-');
    const homeDir = createTempDir('memory-mason-home-');
    const vaultPath = createTempDir('memory-mason-vault-');

    writeText(path.join(cwd, 'memory-mason.json'), JSON.stringify({ vaultPath: '/ignored', subfolder: 'my-brain' }));

    const result = runScript('user-prompt-submit.js', {
      payload: { hookEventName: 'user-prompt-submit', cwd, prompt: 'remember this' },
      cwd,
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath })
    });

    expect(result.status).toBe(0);
    expect(fs.readFileSync(buildDailyFilePath(vaultPath, 'my-brain', today()), 'utf-8')).toContain('remember this');
    expect(fs.existsSync(buildDailyFilePath(vaultPath, 'ai-knowledge', today()))).toBe(false);
  });

  it('skips when prompt text is empty', () => {
    const homeDir = createTempDir('memory-mason-home-');
    const vaultPath = createTempDir('memory-mason-vault-');

    const result = runScript('user-prompt-submit.js', {
      payload: { hookEventName: 'user-prompt-submit', cwd: hooksRoot },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath })
    });

    expect(result.status).toBe(0);
    expect(fs.existsSync(buildDailyFilePath(vaultPath, 'ai-knowledge', today()))).toBe(false);
  });

  it('reports missing config when prompt exists but vault config does not', () => {
    const homeDir = createTempDir('memory-mason-home-');

    const result = runScript('user-prompt-submit.js', {
      payload: { hookEventName: 'user-prompt-submit', cwd: hooksRoot, prompt: '/mmc' },
      env: buildEnv(homeDir)
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('memory-mason.json not found and MEMORY_MASON_VAULT_PATH is not set');
  });

  it('does not backfill assistant turns on prompt submit after transcript grows', () => {
    const homeDir = createTempDir('memory-mason-home-');
    const vaultPath = createTempDir('memory-mason-vault-');
    const transcriptDir = createTempDir('memory-mason-transcript-');
    const transcriptPath = path.join(transcriptDir, 'session.jsonl');

    writeText(transcriptPath, buildTranscript(2));

    runScript('user-prompt-submit.js', {
      payload: {
        hookEventName: 'user-prompt-submit',
        cwd: hooksRoot,
        prompt: 'first user prompt',
        transcript_path: transcriptPath,
        session_id: 'session-anchor'
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath })
    });

    const dailyPathAfterFirst = buildDailyFilePath(vaultPath, 'ai-knowledge', today());
    const contentAfterFirst = fs.readFileSync(dailyPathAfterFirst, 'utf-8');
    expect(contentAfterFirst).not.toContain('AssistantReply');
    expect(contentAfterFirst).toContain('first user prompt');

    writeText(transcriptPath, buildTranscript(4));

    const result = runScript('user-prompt-submit.js', {
      payload: {
        hookEventName: 'user-prompt-submit',
        cwd: hooksRoot,
        prompt: 'second user prompt',
        transcript_path: transcriptPath,
        session_id: 'session-anchor'
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath })
    });

    const dailyContent = fs.readFileSync(dailyPathAfterFirst, 'utf-8');

    expect(result.status).toBe(0);
    expect(dailyContent).toContain('second user prompt');
    expect(dailyContent).not.toContain('AssistantReply');
    expect(dailyContent).not.toContain('assistant turn 3');
  });

  it('skips assistant dump on first call even when transcript has historical turns', () => {
    const homeDir = createTempDir('memory-mason-home-');
    const vaultPath = createTempDir('memory-mason-vault-');
    const transcriptDir = createTempDir('memory-mason-transcript-');
    const transcriptPath = path.join(transcriptDir, 'session.jsonl');

    writeText(transcriptPath, buildTranscript(10));

    const result = runScript('user-prompt-submit.js', {
      payload: {
        hookEventName: 'user-prompt-submit',
        cwd: hooksRoot,
        prompt: 'new prompt after long history',
        transcript_path: transcriptPath,
        session_id: 'session-noorphan'
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath })
    });

    const dailyContent = fs.readFileSync(buildDailyFilePath(vaultPath, 'ai-knowledge', today()), 'utf-8');

    expect(result.status).toBe(0);
    expect(dailyContent).not.toContain('AssistantReply');
    expect(dailyContent).toContain('new prompt after long history');
  });

  it('keeps first and second prompts adjacent without inserting assistant backfill', () => {
    const homeDir = createTempDir('memory-mason-home-');
    const vaultPath = createTempDir('memory-mason-vault-');
    const transcriptDir = createTempDir('memory-mason-transcript-');
    const transcriptPath = path.join(transcriptDir, 'session.jsonl');

    writeText(transcriptPath, buildTranscript(2));

    runScript('user-prompt-submit.js', {
      payload: {
        hookEventName: 'user-prompt-submit',
        cwd: hooksRoot,
        prompt: 'second prompt',
        transcript_path: transcriptPath,
        session_id: 'session-dedup'
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath })
    });

    writeText(transcriptPath, buildTranscript(4));

    runScript('user-prompt-submit.js', {
      payload: {
        hookEventName: 'user-prompt-submit',
        cwd: hooksRoot,
        prompt: 'third prompt',
        transcript_path: transcriptPath,
        session_id: 'session-dedup'
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath })
    });

    const dailyPath = buildDailyFilePath(vaultPath, 'ai-knowledge', today());
    const dailyContent = fs.readFileSync(dailyPath, 'utf-8');

    expect(dailyContent).toContain('second prompt');
    expect(dailyContent).toContain('third prompt');
    expect(dailyContent).not.toContain('AssistantReply');
    expect(dailyContent).not.toContain('assistant turn 3');
  });

  it('skips assistant capture when transcript_path is absent', () => {
    const homeDir = createTempDir('memory-mason-home-');
    const vaultPath = createTempDir('memory-mason-vault-');

    const result = runScript('user-prompt-submit.js', {
      payload: {
        hookEventName: 'user-prompt-submit',
        cwd: hooksRoot,
        prompt: 'no transcript here',
        session_id: 'session-xyz'
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath })
    });

    const dailyContent = fs.readFileSync(buildDailyFilePath(vaultPath, 'ai-knowledge', today()), 'utf-8');

    expect(result.status).toBe(0);
    expect(dailyContent).not.toContain('AssistantReply');
    expect(dailyContent).toContain('no transcript here');
  });

  it('skips assistant capture when session_id is absent', () => {
    const homeDir = createTempDir('memory-mason-home-');
    const vaultPath = createTempDir('memory-mason-vault-');
    const transcriptDir = createTempDir('memory-mason-transcript-');
    const transcriptPath = path.join(transcriptDir, 'session.jsonl');

    writeText(transcriptPath, buildTranscript(2));

    const result = runScript('user-prompt-submit.js', {
      payload: {
        hookEventName: 'user-prompt-submit',
        cwd: hooksRoot,
        prompt: 'no session id',
        transcript_path: transcriptPath
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath })
    });

    const dailyContent = fs.readFileSync(buildDailyFilePath(vaultPath, 'ai-knowledge', today()), 'utf-8');

    expect(result.status).toBe(0);
    expect(dailyContent).not.toContain('AssistantReply');
  });

  it('skips assistant capture when transcript file does not exist', () => {
    const homeDir = createTempDir('memory-mason-home-');
    const vaultPath = createTempDir('memory-mason-vault-');

    const result = runScript('user-prompt-submit.js', {
      payload: {
        hookEventName: 'user-prompt-submit',
        cwd: hooksRoot,
        prompt: 'missing transcript file',
        transcript_path: path.join(hooksRoot, 'does-not-exist.jsonl'),
        session_id: 'session-missing'
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath })
    });

    const dailyContent = fs.readFileSync(buildDailyFilePath(vaultPath, 'ai-knowledge', today()), 'utf-8');

    expect(result.status).toBe(0);
    expect(dailyContent).not.toContain('AssistantReply');
  });
});

describe('user-prompt-submit.js readStdin', () => {
  it('returns valid JSON string from mocked fd 0', () => {
    const payload = JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: 'hello' });
    const buf = Buffer.from(payload);
    let rc = 0;
    expect(userPromptSubmit.readStdin({ readSync(fd, chunk) { if (rc === 0) { rc++; buf.copy(chunk); return buf.length; } return 0; } })).toBe(payload);
  });

  it('returns empty string on immediate EOF', () => {
    expect(userPromptSubmit.readStdin({ readSync: () => 0 })).toBe('');
  });
});

describe('user-prompt-submit.js main', () => {
  it('calls exit with status 0 after writing prompt', () => {
    const homeDir = createTempDir('mm-home-');
    const vaultPath = createTempDir('mm-vault-');
    const cwd = createTempDir('mm-cwd-');
    const payload = JSON.stringify({ hook_event_name: 'UserPromptSubmit', cwd, prompt: 'main test' });
    const buf = Buffer.from(payload);
    let rc = 0;
    const writes = []; const errors = []; let exitCode = null;
    userPromptSubmit.main({
      io: { stdout: (t) => writes.push(t), stderr: (t) => errors.push(t), exit: (c) => { exitCode = c; } },
      fs: { readSync(fd, chunk) { if (rc === 0) { rc++; buf.copy(chunk); return buf.length; } return 0; } },
      cwd, env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }), homedir: homeDir
    });
    expect(exitCode).toBe(0);
    expect(errors).toHaveLength(0);
  });

  it('writes stderr when config is missing', () => {
    const homeDir = createTempDir('mm-home-');
    const payload = JSON.stringify({ hook_event_name: 'UserPromptSubmit', cwd: createTempDir('mm-nocfg-'), prompt: 'test' });
    const buf = Buffer.from(payload);
    let rc = 0;
    const errors = []; let exitCode = null;
    userPromptSubmit.main({
      io: { stdout: () => {}, stderr: (t) => errors.push(t), exit: (c) => { exitCode = c; } },
      fs: { readSync(fd, chunk) { if (rc === 0) { rc++; buf.copy(chunk); return buf.length; } return 0; } },
      cwd: createTempDir('mm-fb-'), env: buildEnv(homeDir), homedir: homeDir
    });
    expect(exitCode).toBe(0);
    expect(errors.join('')).toContain('memory-mason.json not found');
  });

  it('falls back to process stdout/stderr when io functions are missing', () => {
    const homeDir = createTempDir('mm-home-');
    const vaultPath = createTempDir('mm-vault-');
    const payload = JSON.stringify({ hook_event_name: 'UserPromptSubmit', cwd: homeDir });
    const buf = Buffer.from(payload);
    let rc = 0;
    const result = userPromptSubmit.main({
      io: { exit: () => {} },
      fs: { readSync(fd, chunk) { if (rc === 0) { rc++; buf.copy(chunk); return buf.length; } return 0; } },
      cwd: homeDir, env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }), homedir: homeDir
    });
    expect(result.status).toBe(0);
  });
});

describe('user-prompt-submit.js runtime fallback branches', () => {
  it('falls back to process defaults when runtime properties are invalid', () => {
    const result = userPromptSubmit.run(
      JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: 'test' }),
      { env: null, cwd: 123, homedir: 42 }
    );
    expect(result.status).toBe(0);
  });

  it('uses fallbackCwd when input has no cwd', () => {
    const homeDir = createTempDir('mm-home-');
    const vaultPath = createTempDir('mm-vault-');
    const result = userPromptSubmit.run(
      JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: 'test' }),
      { env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }), cwd: createTempDir('mm-fb-'), homedir: homeDir }
    );
    expect(result.status).toBe(0);
  });
});
