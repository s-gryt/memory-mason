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
const entrypointConfigReaderModules = [
  { scriptName: 'session-start.js', scriptModule: sessionStart },
  { scriptName: 'user-prompt-submit.js', scriptModule: userPromptSubmit },
  { scriptName: 'post-tool-use.js', scriptModule: postToolUse },
  { scriptName: 'pre-compact.js', scriptModule: preCompact },
  { scriptName: 'session-end.js', scriptModule: sessionEnd }
];
const copilotHookDefinitions = [
  { fileName: 'session-start.json', eventName: 'SessionStart', scriptName: 'session-start.js', timeout: 10 },
  { fileName: 'user-prompt-submit.json', eventName: 'UserPromptSubmit', scriptName: 'user-prompt-submit.js', timeout: 5 },
  { fileName: 'post-tool-use.json', eventName: 'PostToolUse', scriptName: 'post-tool-use.js', timeout: 5 },
  { fileName: 'pre-compact.json', eventName: 'PreCompact', scriptName: 'pre-compact.js', timeout: 15 },
  { fileName: 'stop.json', eventName: 'Stop', scriptName: 'session-end.js', timeout: 15 }
];

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
  const extraRuntime = typeof options.runtime === 'object' && options.runtime !== null ? options.runtime : {};
  const runtime = {
    cwd: typeof options.cwd === 'string' ? options.cwd : hooksRoot,
    env,
    homedir,
    ...extraRuntime
  };

  return scriptName === 'install-copilot-hooks.js' || scriptName === 'uninstall-copilot-hooks.js'
    ? scriptModule.run(runtime)
    : scriptModule.run(stdinText, runtime);
};

const writeText = (filePath, content) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
};

const assertInstalledCopilotHook = (hooksDirectory, hookRoot, definition) => {
  const installedPath = path.join(hooksDirectory, definition.fileName);
  const installed = JSON.parse(fs.readFileSync(installedPath, 'utf-8'));
  const entries = installed.hooks[definition.eventName];

  expect(Array.isArray(entries)).toBe(true);
  expect(entries).toHaveLength(1);
  expect(entries[0].type).toBe('command');
  expect(entries[0].timeout).toBe(definition.timeout);
  expect(entries[0].command).toBe(`node "${path.join(hookRoot, definition.scriptName).replace(/\\/g, '/')}"`);
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

describe('entrypoint config readers', () => {
  entrypointConfigReaderModules.forEach(({ scriptName, scriptModule }) => {
    it(`reads .env text for ${scriptName}`, () => {
      const cwd = createTempDir('memory-mason-cwd-');
      const envText = 'MEMORY_MASON_VAULT_PATH=/vault/path\nMEMORY_MASON_SUBFOLDER=notes';

      writeText(path.join(cwd, '.env'), envText);

      expect(scriptModule.readDotEnvText(cwd)).toBe(envText);
      expect(scriptModule.readDotEnvText(createTempDir('memory-mason-cwd-empty-'))).toBe('');
    });

    it(`reads global config text for ${scriptName}`, () => {
      const homeDir = createTempDir('memory-mason-home-');
      const configText = JSON.stringify({ vaultPath: '/vault', subfolder: 'notes' });

      writeText(path.join(homeDir, '.memory-mason', 'config.json'), configText);

      expect(scriptModule.readGlobalConfigText(homeDir)).toBe(configText);
      expect(scriptModule.readGlobalConfigText(createTempDir('memory-mason-home-empty-'))).toBe('');
    });
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

  it('writes structured tool output for claude payloads', () => {
    const homeDir = createTempDir('memory-mason-home-');
    const vaultPath = createTempDir('memory-mason-vault-');

    const result = runScript('post-tool-use.js', {
      payload: {
        hook_event_name: 'PostToolUse',
        cwd: hooksRoot,
        tool_name: 'Bash',
        tool_response: {
          stdout: 'grep hit 1\ngrep hit 2',
          stderr: '',
          interrupted: false,
          isImage: false
        }
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath })
    });

    expect(result.status).toBe(0);
    expect(fs.readFileSync(buildDailyFilePath(vaultPath, 'ai-knowledge', today()), 'utf-8')).toContain('grep hit 1');
    expect(fs.readFileSync(buildDailyFilePath(vaultPath, 'ai-knowledge', today()), 'utf-8')).toContain('stdout');
  });

  it('writes text blocks for structured claude tool outputs', () => {
    const homeDir = createTempDir('memory-mason-home-');
    const vaultPath = createTempDir('memory-mason-vault-');

    const result = runScript('post-tool-use.js', {
      payload: {
        hook_event_name: 'PostToolUse',
        cwd: hooksRoot,
        tool_name: 'mcp__plugin_claude-mem_mcp-search__search',
        tool_response: [
          { type: 'text', text: 'match 1' },
          { type: 'text', text: 'match 2' }
        ]
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath })
    });

    expect(result.status).toBe(0);
    expect(fs.readFileSync(buildDailyFilePath(vaultPath, 'ai-knowledge', today()), 'utf-8')).toContain('match 1');
    expect(fs.readFileSync(buildDailyFilePath(vaultPath, 'ai-knowledge', today()), 'utf-8')).toContain('match 2');
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

  it('writes full transcript without turn or character truncation', () => {
    const homeDir = createTempDir('memory-mason-home-');
    const vaultPath = createTempDir('memory-mason-vault-');
    const transcriptPath = path.join(createTempDir('memory-mason-transcript-'), 'session.jsonl');
    const longFirstTurn = 'first-user-turn-' + 'x'.repeat(17000);

    writeText(transcriptPath, buildTranscript(40, longFirstTurn));

    const result = runScript('pre-compact.js', {
      payload: { cwd: hooksRoot, transcript_path: transcriptPath, session_id: 'session-full-pre-compact' },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath })
    });

    const dailyPath = buildDailyFilePath(vaultPath, 'ai-knowledge', today());
    const dailyContent = fs.readFileSync(dailyPath, 'utf-8');

    expect(result.status).toBe(0);
    expect(dailyContent).toContain(longFirstTurn);
    expect(dailyContent).toContain('assistant turn 39');
    expect(dailyContent).not.toContain('...(truncated)');
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

  it('captures assistant replies on Stop and skips duplicates for unchanged transcript', () => {
    const homeDir = createTempDir('memory-mason-home-');
    const vaultPath = createTempDir('memory-mason-vault-');
    const transcriptPath = path.join(createTempDir('memory-mason-transcript-'), 'session.jsonl');

    writeText(transcriptPath, buildTranscript(1, 'first prompt turn'));

    runScript('user-prompt-submit.js', {
      payload: {
        hookEventName: 'user-prompt-submit',
        cwd: hooksRoot,
        prompt: 'first prompt',
        transcript_path: transcriptPath,
        session_id: 'session-stop-order'
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath })
    });

    const dailyPath = buildDailyFilePath(vaultPath, 'ai-knowledge', today());
    const afterFirstPrompt = fs.readFileSync(dailyPath, 'utf-8');
    expect(afterFirstPrompt).toContain('first prompt');
    expect(afterFirstPrompt).not.toContain('AssistantReply');

    writeText(transcriptPath, buildTranscript(2, 'first prompt turn'));

    runScript('session-end.js', {
      payload: {
        hookEventName: 'Stop',
        cwd: hooksRoot,
        transcript_path: transcriptPath,
        session_id: 'session-stop-order'
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath })
    });

    const afterFirstStop = fs.readFileSync(dailyPath, 'utf-8');
    expect(afterFirstStop).toContain('AssistantReply');
    expect(afterFirstStop).toContain('assistant turn 1');
    expect(afterFirstStop.indexOf('first prompt')).toBeLessThan(afterFirstStop.indexOf('assistant turn 1'));

    writeText(transcriptPath, buildTranscript(3, 'first prompt turn'));

    runScript('user-prompt-submit.js', {
      payload: {
        hookEventName: 'user-prompt-submit',
        cwd: hooksRoot,
        prompt: 'second prompt',
        transcript_path: transcriptPath,
        session_id: 'session-stop-order'
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath })
    });

    const afterSecondPrompt = fs.readFileSync(dailyPath, 'utf-8');
    expect(afterSecondPrompt).toContain('second prompt');
    expect(afterSecondPrompt.split('assistant turn 1').length - 1).toBe(1);
    expect(afterSecondPrompt).not.toContain('assistant turn 3');

    writeText(transcriptPath, buildTranscript(4, 'first prompt turn'));

    runScript('session-end.js', {
      payload: {
        hook_event_name: 'stop',
        cwd: hooksRoot,
        transcript_path: transcriptPath,
        session_id: 'session-stop-order'
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath })
    });

    const afterSecondStop = fs.readFileSync(dailyPath, 'utf-8');
    expect(afterSecondStop).toContain('assistant turn 3');
    expect(afterSecondStop.indexOf('second prompt')).toBeLessThan(afterSecondStop.indexOf('assistant turn 3'));

    runScript('session-end.js', {
      payload: {
        hook_event_name: 'stop',
        cwd: hooksRoot,
        transcript_path: transcriptPath,
        session_id: 'session-stop-order'
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath })
    });

    const afterDuplicateStop = fs.readFileSync(dailyPath, 'utf-8');
    expect(afterDuplicateStop).toBe(afterSecondStop);
    expect(afterDuplicateStop.split('assistant turn 3').length - 1).toBe(1);
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

  it('writes full transcript from explicit path without truncation', () => {
    const homeDir = createTempDir('memory-mason-home-');
    const vaultPath = createTempDir('memory-mason-vault-');
    const transcriptPath = path.join(createTempDir('memory-mason-transcript-'), 'session.jsonl');
    const longFirstTurn = 'session-end-first-user-' + 'y'.repeat(17000);

    writeText(transcriptPath, buildTranscript(40, longFirstTurn));

    const result = runScript('session-end.js', {
      payload: {
        hook_event_name: 'session_end',
        cwd: hooksRoot,
        transcript_path: transcriptPath,
        session_id: 'session-full-session-end',
        source: 'stop'
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath })
    });

    const dailyPath = buildDailyFilePath(vaultPath, 'ai-knowledge', today());
    const dailyContent = fs.readFileSync(dailyPath, 'utf-8');

    expect(result.status).toBe(0);
    expect(dailyContent).toContain(longFirstTurn);
    expect(dailyContent).toContain('assistant turn 39');
    expect(dailyContent).not.toContain('...(truncated)');
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
  it('installs user-level Copilot hook files with absolute commands and hook metadata', () => {
    const homeDir = createTempDir('memory-mason-home-');
    const result = runScript('install-copilot-hooks.js', {
      stdinText: '',
      cwd: repoRoot,
      env: buildEnv(homeDir)
    });

    const hooksDirectory = path.join(homeDir, '.copilot', 'hooks');
    const hookRoot = path.join(repoRoot, 'hooks');

    expect(result.status).toBe(0);
    copilotHookDefinitions.forEach((definition) => {
      assertInstalledCopilotHook(hooksDirectory, hookRoot, definition);
    });
  });

  it('installs workspace-level Copilot hook files with absolute commands and hook metadata', () => {
    const homeDir = createTempDir('memory-mason-home-');
    const workspaceDir = createTempDir('memory-mason-workspace-');
    const writes = [];
    const result = installCopilotHooks.main({
      cwd: repoRoot,
      env: buildEnv(homeDir),
      homedir: homeDir,
      argv: ['--workspace', workspaceDir],
      io: {
        stdout: (text) => writes.push(text),
        stderr: () => {},
        exit: () => {}
      }
    });

    const hooksDirectory = path.join(workspaceDir, '.github', 'hooks');
    const hookRoot = path.join(repoRoot, 'hooks');

    expect(result.status).toBe(0);
    expect(writes.join('')).toContain(path.join(workspaceDir, '.github', 'hooks'));
    copilotHookDefinitions.forEach((definition) => {
      assertInstalledCopilotHook(hooksDirectory, hookRoot, definition);
    });
  });

  it('falls back to inline definitions when source hook files are not available', () => {
    const homeDir = createTempDir('memory-mason-home-');
    const targetDir = createTempDir('memory-mason-copilot-target-');
    const missingSourceDir = path.join(createTempDir('memory-mason-missing-source-'), '.github', 'hooks');

    const result = runScript('install-copilot-hooks.js', {
      cwd: repoRoot,
      env: buildEnv(homeDir),
      runtime: {
        targetDir,
        sourceDir: missingSourceDir
      }
    });

    const hookRoot = path.join(repoRoot, 'hooks');

    expect(result.status).toBe(0);
    copilotHookDefinitions.forEach((definition) => {
      assertInstalledCopilotHook(targetDir, hookRoot, definition);
    });
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

  it('uninstalls workspace-level Copilot hook files', () => {
    const homeDir = createTempDir('memory-mason-home-');
    const workspaceDir = createTempDir('memory-mason-workspace-');

    installCopilotHooks.main({
      cwd: repoRoot,
      env: buildEnv(homeDir),
      homedir: homeDir,
      argv: ['--workspace', workspaceDir],
      io: {
        stdout: () => {},
        stderr: () => {},
        exit: () => {}
      }
    });

    const result = uninstallCopilotHooks.main({
      cwd: repoRoot,
      env: buildEnv(homeDir),
      homedir: homeDir,
      argv: ['--workspace', workspaceDir],
      io: {
        stdout: () => {},
        stderr: () => {},
        exit: () => {}
      }
    });

    expect(result.status).toBe(0);
    expect(fs.existsSync(path.join(workspaceDir, '.github', 'hooks', 'session-start.json'))).toBe(false);
    expect(fs.existsSync(path.join(workspaceDir, '.github', 'hooks', 'stop.json'))).toBe(false);
  });
});

describe('capture-state.js helpers', () => {
  const {
    getTranscriptTurnCount,
    setTranscriptTurnCount,
    defaultCaptureState,
    loadCaptureState
  } = require('../lib/capture-state');

  it('getTranscriptTurnCount returns 0 when sessionId not found', () => {
    const state = defaultCaptureState();
    expect(getTranscriptTurnCount(state, 'unknown-session')).toBe(0);
  });

  it('getTranscriptTurnCount returns stored count', () => {
    const state = { lastCapture: null, transcriptTurnCounts: { 'session-1': 5 } };
    expect(getTranscriptTurnCount(state, 'session-1')).toBe(5);
  });

  it('getTranscriptTurnCount returns 0 for invalid/empty sessionId', () => {
    const state = defaultCaptureState();
    expect(getTranscriptTurnCount(state, '')).toBe(0);
    expect(getTranscriptTurnCount(null, 'session-1')).toBe(0);
  });

  it('setTranscriptTurnCount stores count for sessionId', () => {
    const state = defaultCaptureState();
    const next = setTranscriptTurnCount(state, 'session-1', 4);
    expect(next.transcriptTurnCounts['session-1']).toBe(4);
    expect(next.lastCapture).toBe(null);
  });

  it('setTranscriptTurnCount preserves other session counts', () => {
    const state = { lastCapture: null, transcriptTurnCounts: { 'session-1': 2 } };
    const next = setTranscriptTurnCount(state, 'session-2', 6);
    expect(next.transcriptTurnCounts['session-1']).toBe(2);
    expect(next.transcriptTurnCounts['session-2']).toBe(6);
  });

  it('setTranscriptTurnCount throws on empty sessionId', () => {
    expect(() => setTranscriptTurnCount(defaultCaptureState(), '', 1)).toThrow('sessionId must be a non-empty string');
    expect(() => setTranscriptTurnCount(defaultCaptureState(), 123, 1)).toThrow('sessionId must be a non-empty string');
  });

  it('setTranscriptTurnCount throws on invalid count', () => {
    expect(() => setTranscriptTurnCount(defaultCaptureState(), 'session-1', -1)).toThrow('count must be a non-negative integer');
    expect(() => setTranscriptTurnCount(defaultCaptureState(), 'session-1', 1.5)).toThrow('count must be a non-negative integer');
  });

  it('setTranscriptTurnCount falls back to default state for non-object state', () => {
    expect(setTranscriptTurnCount(null, 'session-1', 2)).toEqual({
      lastCapture: null,
      transcriptTurnCounts: {
        'session-1': 2
      }
    });
  });

  it('loadCaptureState sanitizes transcriptTurnCounts and keeps only non-negative integers', () => {
    const vaultPath = createTempDir('memory-mason-vault-');
    const statePath = resolveCaptureStatePath(vaultPath, 'ai-knowledge');

    writeText(
      statePath,
      JSON.stringify({
        lastCapture: null,
        transcriptTurnCounts: {
          'session-1': 3,
          'session-2': -1,
          'session-3': 1.5,
          'session-4': '4'
        }
      })
    );

    expect(loadCaptureState(vaultPath, 'ai-knowledge')).toEqual({
      lastCapture: null,
      transcriptTurnCounts: {
        'session-1': 3
      }
    });
  });
});

describe('vault.js buildAssistantReplyEntry', () => {
  const { buildAssistantReplyEntry } = require('../lib/vault');

  it('builds a labeled AssistantReply entry', () => {
    const entry = buildAssistantReplyEntry('SELECT * FROM foo;', '14:22:31');
    expect(entry).toContain('AssistantReply');
    expect(entry).toContain('14:22:31');
    expect(entry).toContain('SELECT * FROM foo;');
  });

  it('preserves full content exceeding 5000 chars', () => {
    const longContent = 'x'.repeat(6000);
    const entry = buildAssistantReplyEntry(longContent, '09:00:00');
    expect(entry).toContain(longContent);
    expect(entry).not.toContain('...(truncated)');
  });

  it('throws on invalid timestamp', () => {
    expect(() => buildAssistantReplyEntry('hello', 'bad')).toThrow('timestamp must be in HH:MM:SS format');
    expect(() => buildAssistantReplyEntry('hello', '')).toThrow();
  });

  it('throws on non-string content', () => {
    expect(() => buildAssistantReplyEntry(null, '12:00:00')).toThrow('content must be a string');
    expect(() => buildAssistantReplyEntry(42, '12:00:00')).toThrow('content must be a string');
  });
});