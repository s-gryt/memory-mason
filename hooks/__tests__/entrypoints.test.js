'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildDailyFilePath, buildKnowledgeIndexPath } = require('../lib/vault');
const { resolveCaptureStatePath } = require('../lib/capture-state');
const sessionStart = require('../session-start');
const userPromptSubmit = require('../user-prompt-submit');
const postToolUse = require('../post-tool-use');
const preCompact = require('../pre-compact');
const sessionEnd = require('../session-end');
const installCopilotHooks = require('../install-copilot-hooks');
const uninstallCopilotHooks = require('../uninstall-copilot-hooks');

const hooksRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(hooksRoot, '..');
const tempDirs = [];
const scriptModules = {
  'session-start.js': sessionStart,
  'user-prompt-submit.js': userPromptSubmit,
  'post-tool-use.js': postToolUse,
  'pre-compact.js': preCompact,
  'session-end.js': sessionEnd,
  'install-copilot-hooks.js': installCopilotHooks,
  'uninstall-copilot-hooks.js': uninstallCopilotHooks
};

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

const runScript = (scriptName, options = {}) => {
  const scriptModule = scriptModules[scriptName];
  const stdinText =
    typeof options.stdinText === 'string'
      ? options.stdinText
      : typeof options.payload === 'undefined'
        ? ''
        : JSON.stringify(options.payload);
  const env = typeof options.env === 'object' && options.env !== null ? options.env : process.env;
  const homedir = typeof env.USERPROFILE === 'string' && env.USERPROFILE !== '' ? env.USERPROFILE : os.homedir();
  const runtime = {
    cwd: typeof options.cwd === 'string' ? options.cwd : hooksRoot,
    env,
    homedir
  };

  return scriptName === 'install-copilot-hooks.js' || scriptName === 'uninstall-copilot-hooks.js'
    ? scriptModule.run(runtime)
    : scriptModule.run(stdinText, runtime);
};

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

const today = () => new Date().toISOString().slice(0, 10);

const yesterday = () => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
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
});

describe('post-tool-use.js', () => {
  it('writes tool output for copilot vscode payloads', () => {
    const homeDir = createTempDir('memory-mason-home-');
    const vaultPath = createTempDir('memory-mason-vault-');

    const result = runScript('post-tool-use.js', {
      payload: {
        hookEventName: 'post-tool-use',
        cwd: hooksRoot,
        tool_name: 'Edit',
        tool_response: 'patched file'
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath })
    });

    expect(result.status).toBe(0);
    expect(fs.readFileSync(buildDailyFilePath(vaultPath, 'ai-knowledge', today()), 'utf-8')).toContain('patched file');
  });

  it('writes tool output for copilot cli payloads', () => {
    const homeDir = createTempDir('memory-mason-home-');
    const vaultPath = createTempDir('memory-mason-vault-');

    runScript('post-tool-use.js', {
      payload: {
        timestamp: '2026-04-27T10:00:00.000Z',
        cwd: hooksRoot,
        toolName: 'apply_patch',
        toolResult: { textResultForLlm: 'patch ok' }
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath })
    });

    expect(fs.readFileSync(buildDailyFilePath(vaultPath, 'ai-knowledge', today()), 'utf-8')).toContain('patch ok');
  });

  it('writes tool output for codex payloads', () => {
    const homeDir = createTempDir('memory-mason-home-');
    const vaultPath = createTempDir('memory-mason-vault-');

    runScript('post-tool-use.js', {
      payload: {
        hook_event_name: 'post_tool_use',
        turn_id: 'turn-1',
        cwd: hooksRoot,
        tool_name: 'Shell',
        tool_result: 'codex result'
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath })
    });

    expect(fs.readFileSync(buildDailyFilePath(vaultPath, 'ai-knowledge', today()), 'utf-8')).toContain('codex result');
  });

  it('skips noisy tools', () => {
    const homeDir = createTempDir('memory-mason-home-');
    const vaultPath = createTempDir('memory-mason-vault-');

    const result = runScript('post-tool-use.js', {
      payload: {
        hookEventName: 'post-tool-use',
        cwd: hooksRoot,
        tool_name: 'Read',
        tool_response: 'ignored'
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath })
    });

    expect(result.status).toBe(0);
    expect(fs.existsSync(buildDailyFilePath(vaultPath, 'ai-knowledge', today()))).toBe(false);
  });

  it('reports invalid payloads to stderr', () => {
    const result = runScript('post-tool-use.js', {
      payload: { cwd: hooksRoot },
      env: buildEnv(createTempDir('memory-mason-home-'))
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('cannot detect platform from stdin shape:');
  });
});

describe('pre-compact.js', () => {
  it('skips when invoked by another Memory Mason command', () => {
    const homeDir = createTempDir('memory-mason-home-');
    const vaultPath = createTempDir('memory-mason-vault-');
    const transcriptPath = path.join(createTempDir('memory-mason-transcript-'), 'session.jsonl');

    writeText(transcriptPath, buildTranscript(6));

    const result = runScript('pre-compact.js', {
      payload: { cwd: hooksRoot, transcript_path: transcriptPath, session_id: 'session-1' },
      env: buildEnv(homeDir, {
        MEMORY_MASON_VAULT_PATH: vaultPath,
        MEMORY_MASON_INVOKED_BY: 'mmc'
      })
    });

    expect(result.status).toBe(0);
    expect(fs.existsSync(buildDailyFilePath(vaultPath, 'ai-knowledge', today()))).toBe(false);
  });

  it('skips when transcript file missing', () => {
    const homeDir = createTempDir('memory-mason-home-');
    const vaultPath = createTempDir('memory-mason-vault-');

    const result = runScript('pre-compact.js', {
      payload: { cwd: hooksRoot, transcript_path: path.join(hooksRoot, 'missing.jsonl'), session_id: 'session-1' },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath })
    });

    expect(result.status).toBe(0);
    expect(fs.existsSync(buildDailyFilePath(vaultPath, 'ai-knowledge', today()))).toBe(false);
  });

  it('skips when transcript excerpt too small', () => {
    const homeDir = createTempDir('memory-mason-home-');
    const vaultPath = createTempDir('memory-mason-vault-');
    const transcriptPath = path.join(createTempDir('memory-mason-transcript-'), 'session.jsonl');

    writeText(transcriptPath, buildTranscript(4));

    runScript('pre-compact.js', {
      payload: { cwd: hooksRoot, transcript_path: transcriptPath, session_id: 'session-1' },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath })
    });

    expect(fs.existsSync(buildDailyFilePath(vaultPath, 'ai-knowledge', today()))).toBe(false);
  });

  it('writes excerpt and capture state for valid transcript', () => {
    const homeDir = createTempDir('memory-mason-home-');
    const vaultPath = createTempDir('memory-mason-vault-');
    const transcriptPath = path.join(createTempDir('memory-mason-transcript-'), 'session.jsonl');

    writeText(transcriptPath, buildTranscript(6));

    const result = runScript('pre-compact.js', {
      payload: { cwd: hooksRoot, transcript_path: transcriptPath, session_id: 'session-1' },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath })
    });

    const dailyPath = buildDailyFilePath(vaultPath, 'ai-knowledge', today());
    const statePath = resolveCaptureStatePath(vaultPath, 'ai-knowledge');
    expect(result.status).toBe(0);
    expect(fs.readFileSync(dailyPath, 'utf-8')).toContain('session-1 / pre-compact');
    expect(fs.readFileSync(dailyPath, 'utf-8')).toContain('**User:** user turn');
    expect(JSON.parse(fs.readFileSync(statePath, 'utf-8')).lastCapture.source).toBe('pre-compact');
  });

  it('skips duplicate capture within duplicate window', () => {
    const homeDir = createTempDir('memory-mason-home-');
    const vaultPath = createTempDir('memory-mason-vault-');
    const transcriptPath = path.join(createTempDir('memory-mason-transcript-'), 'session.jsonl');

    writeText(transcriptPath, buildTranscript(6));

    runScript('pre-compact.js', {
      payload: { cwd: hooksRoot, transcript_path: transcriptPath, session_id: 'session-1' },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath })
    });
    const dailyPath = buildDailyFilePath(vaultPath, 'ai-knowledge', today());
    const firstContent = fs.readFileSync(dailyPath, 'utf-8');

    runScript('pre-compact.js', {
      payload: { cwd: hooksRoot, transcript_path: transcriptPath, session_id: 'session-1' },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath })
    });

    expect(fs.readFileSync(dailyPath, 'utf-8')).toBe(firstContent);
  });

  it('reports invalid stdin to stderr', () => {
    const result = runScript('pre-compact.js', {
      stdinText: '{bad',
      env: buildEnv(createTempDir('memory-mason-home-'))
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('invalid JSON in stdin: {bad');
  });
});

describe('session-end.js', () => {
  it('skips when invoked by another Memory Mason command', () => {
    const homeDir = createTempDir('memory-mason-home-');
    const vaultPath = createTempDir('memory-mason-vault-');
    const transcriptPath = path.join(createTempDir('memory-mason-transcript-'), 'session.jsonl');

    writeText(transcriptPath, buildTranscript(2));

    const result = runScript('session-end.js', {
      payload: { hook_event_name: 'session_end', cwd: hooksRoot, transcript_path: transcriptPath },
      env: buildEnv(homeDir, {
        MEMORY_MASON_VAULT_PATH: vaultPath,
        MEMORY_MASON_INVOKED_BY: 'mmq'
      })
    });

    expect(result.status).toBe(0);
    expect(fs.existsSync(buildDailyFilePath(vaultPath, 'ai-knowledge', today()))).toBe(false);
  });

  it('writes transcript from explicit transcript path', () => {
    const homeDir = createTempDir('memory-mason-home-');
    const vaultPath = createTempDir('memory-mason-vault-');
    const transcriptPath = path.join(createTempDir('memory-mason-transcript-'), 'session.jsonl');

    writeText(transcriptPath, buildTranscript(2));

    const result = runScript('session-end.js', {
      payload: {
        hook_event_name: 'session_end',
        cwd: hooksRoot,
        transcript_path: transcriptPath,
        session_id: 'session-1',
        source: 'stop'
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath })
    });

    const dailyPath = buildDailyFilePath(vaultPath, 'ai-knowledge', today());
    expect(result.status).toBe(0);
    expect(fs.readFileSync(dailyPath, 'utf-8')).toContain('session-1 / stop');
  });

  it('falls back to codex session files when transcript path missing', () => {
    const homeDir = createTempDir('memory-mason-home-');
    const vaultPath = createTempDir('memory-mason-vault-');
    const codexFile = path.join(homeDir, '.codex', 'sessions', 'session-2', 'session-2-log.jsonl');

    writeText(codexFile, buildTranscript(2));

    runScript('session-end.js', {
      payload: {
        hook_event_name: 'session_end',
        turn_id: 'turn-1',
        cwd: hooksRoot,
        session_id: 'session-2'
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath })
    });

    expect(fs.readFileSync(buildDailyFilePath(vaultPath, 'ai-knowledge', today()), 'utf-8')).toContain(
      'session-2 / codex'
    );
  });

  it('falls back to Copilot CLI session-state content', () => {
    const homeDir = createTempDir('memory-mason-home-');
    const vaultPath = createTempDir('memory-mason-vault-');
    const sessionDir = path.join(homeDir, '.copilot', 'session-state', 'session-a');
    const cwd = createTempDir('memory-mason-cwd-');
    const transcriptPath = path.join(sessionDir, 'state.jsonl');

    writeText(transcriptPath, buildTranscript(2, cwd));

    runScript('session-end.js', {
      payload: {
        timestamp: '2026-04-27T10:00:00.000Z',
        cwd
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath })
    });

    expect(fs.readFileSync(buildDailyFilePath(vaultPath, 'ai-knowledge', today()), 'utf-8')).toContain(
      'unknown / copilot-cli'
    );
  });

  it('skips when Copilot CLI session-state is missing', () => {
    const homeDir = createTempDir('memory-mason-home-');
    const vaultPath = createTempDir('memory-mason-vault-');

    const result = runScript('session-end.js', {
      payload: {
        timestamp: '2026-04-27T10:00:00.000Z',
        cwd: hooksRoot
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath })
    });

    expect(result.status).toBe(0);
    expect(fs.existsSync(buildDailyFilePath(vaultPath, 'ai-knowledge', today()))).toBe(false);
  });

  it('skips duplicate transcript capture within duplicate window', () => {
    const homeDir = createTempDir('memory-mason-home-');
    const vaultPath = createTempDir('memory-mason-vault-');
    const transcriptPath = path.join(createTempDir('memory-mason-transcript-'), 'session.jsonl');

    writeText(transcriptPath, buildTranscript(2));

    runScript('session-end.js', {
      payload: {
        hook_event_name: 'session_end',
        cwd: hooksRoot,
        transcript_path: transcriptPath,
        session_id: 'session-3'
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath })
    });

    const dailyPath = buildDailyFilePath(vaultPath, 'ai-knowledge', today());
    const firstContent = fs.readFileSync(dailyPath, 'utf-8');

    runScript('session-end.js', {
      payload: {
        hook_event_name: 'session_end',
        cwd: hooksRoot,
        transcript_path: transcriptPath,
        session_id: 'session-3'
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath })
    });

    expect(fs.readFileSync(dailyPath, 'utf-8')).toBe(firstContent);
  });

  it('reports invalid stdin to stderr', () => {
    const result = runScript('session-end.js', {
      stdinText: '{bad',
      env: buildEnv(createTempDir('memory-mason-home-'))
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('invalid JSON in stdin: {bad');
  });
});

describe('Copilot hook installer scripts', () => {
  it('installs user-level Copilot hook files with absolute commands', () => {
    const homeDir = createTempDir('memory-mason-home-');
    const result = runScript('install-copilot-hooks.js', {
      stdinText: '',
      cwd: repoRoot,
      env: buildEnv(homeDir)
    });

    const installedPath = path.join(homeDir, '.copilot', 'hooks', 'session-start.json');
    const installed = JSON.parse(fs.readFileSync(installedPath, 'utf-8'));
    const command = installed.hooks.SessionStart[0].command;

    expect(result.status).toBe(0);
    expect(command).toBe(`node "${path.join(repoRoot, 'hooks', 'session-start.js').replace(/\\/g, '/')}"`);
  });

  it('uninstalls user-level Copilot hook files', () => {
    const homeDir = createTempDir('memory-mason-home-');

    runScript('install-copilot-hooks.js', {
      stdinText: '',
      cwd: repoRoot,
      env: buildEnv(homeDir)
    });

    const result = runScript('uninstall-copilot-hooks.js', {
      stdinText: '',
      cwd: repoRoot,
      env: buildEnv(homeDir)
    });

    expect(result.status).toBe(0);
    expect(fs.existsSync(path.join(homeDir, '.copilot', 'hooks', 'session-start.json'))).toBe(false);
    expect(fs.existsSync(path.join(homeDir, '.copilot', 'hooks', 'stop.json'))).toBe(false);
  });
});