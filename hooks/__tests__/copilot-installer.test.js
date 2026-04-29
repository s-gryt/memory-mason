'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const installCopilotHooks = require('../install-copilot-hooks');
const uninstallCopilotHooks = require('../uninstall-copilot-hooks');
const hooksRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(hooksRoot, '..');

const copilotHookDefinitions = [
  { fileName: 'session-start.json', eventName: 'SessionStart', scriptName: 'session-start.js', timeout: 10 },
  { fileName: 'user-prompt-submit.json', eventName: 'UserPromptSubmit', scriptName: 'user-prompt-submit.js', timeout: 5 },
  { fileName: 'post-tool-use.json', eventName: 'PostToolUse', scriptName: 'post-tool-use.js', timeout: 5 },
  { fileName: 'pre-compact.json', eventName: 'PreCompact', scriptName: 'pre-compact.js', timeout: 15 },
  { fileName: 'stop.json', eventName: 'Stop', scriptName: 'session-end.js', timeout: 15 }
];

let tempDirs = [];

const createTempDir = (prefix) => {
  const dirPath = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs = tempDirs.concat(dirPath);
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

const runScript = (scriptName, options = {}) => {
  const env = typeof options.env === 'object' && options.env !== null ? options.env : process.env;
  const homedir = typeof env.USERPROFILE === 'string' && env.USERPROFILE !== '' ? env.USERPROFILE : os.homedir();
  const extraRuntime = typeof options.runtime === 'object' && options.runtime !== null ? options.runtime : {};
  const runtime = {
    cwd: typeof options.cwd === 'string' ? options.cwd : hooksRoot,
    env,
    homedir,
    ...extraRuntime
  };

  if (scriptName === 'install-copilot-hooks.js') {
    return installCopilotHooks.run(runtime);
  }

  if (scriptName === 'uninstall-copilot-hooks.js') {
    return uninstallCopilotHooks.run(runtime);
  }

  throw new Error('unsupported script: ' + scriptName);
};

afterEach(() => {
  tempDirs.forEach((dirPath) => {
    fs.rmSync(dirPath, { recursive: true, force: true });
  });
  tempDirs = [];
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

describe('install-copilot-hooks.js parseArgs', () => {
  it('throws on unknown argument', () => {
    expect(() => installCopilotHooks.parseArgs(['--unknown'], '/cwd')).toThrow('unknown argument: --unknown');
  });

  it('throws when --workspace is last with no value', () => {
    expect(() => installCopilotHooks.parseArgs(['--workspace'], '/cwd')).toThrow('--workspace requires a workspace path');
  });

  it('throws when -w is last with no value', () => {
    expect(() => installCopilotHooks.parseArgs(['-w'], '/cwd')).toThrow('-w requires a workspace path');
  });

  it('throws when --workspace value is empty', () => {
    expect(() => installCopilotHooks.parseArgs(['--workspace', ''], '/cwd')).toThrow('--workspace requires a workspace path');
  });
});

describe('install-copilot-hooks.js readSourceHookFile', () => {
  it('returns null for non-string or empty sourceDir', () => {
    expect(installCopilotHooks.readSourceHookFile('session-start.json', null)).toBeNull();
    expect(installCopilotHooks.readSourceHookFile('session-start.json', '')).toBeNull();
  });

  it('returns null when source file does not exist', () => {
    expect(installCopilotHooks.readSourceHookFile('session-start.json', createTempDir('mm-empty-'))).toBeNull();
  });

  it('returns parsed JSON when source file exists', () => {
    const sourceDir = createTempDir('mm-src-');
    const content = { hooks: { SessionStart: [{ type: 'command', command: 'node x.js', timeout: 10 }] } };
    writeText(path.join(sourceDir, 'session-start.json'), JSON.stringify(content));
    expect(installCopilotHooks.readSourceHookFile('session-start.json', sourceDir)).toEqual(content);
  });
});

describe('install-copilot-hooks.js buildInlineHookFile', () => {
  it('throws for unknown hook file name', () => {
    expect(() => installCopilotHooks.buildInlineHookFile('unknown.json')).toThrow('missing inline hook definition for unknown.json');
  });
});

describe('install-copilot-hooks.js rewriteEntry', () => {
  it('returns null/non-object entries unchanged', () => {
    expect(installCopilotHooks.rewriteEntry(null, '/hooks', 'session-start.js')).toBeNull();
    expect(installCopilotHooks.rewriteEntry(42, '/hooks', 'session-start.js')).toBe(42);
    expect(installCopilotHooks.rewriteEntry('s', '/hooks', 'session-start.js')).toBe('s');
  });
});

describe('install-copilot-hooks.js rewriteHookFile', () => {
  it('throws for unknown hook file name with no script mapping', () => {
    expect(() => installCopilotHooks.rewriteHookFile('unknown.json', '/hooks')).toThrow('missing hook script mapping for unknown.json');
  });

  it('throws when hook document is an array', () => {
    const sourceDir = createTempDir('mm-src-');
    writeText(path.join(sourceDir, 'session-start.json'), JSON.stringify([1, 2]));
    expect(() => installCopilotHooks.rewriteHookFile('session-start.json', '/hooks', { sourceDir })).toThrow('invalid hook file shape for session-start.json');
  });

  it('throws when hooks property is not a plain object', () => {
    const sourceDir = createTempDir('mm-src-');
    writeText(path.join(sourceDir, 'session-start.json'), JSON.stringify({ hooks: [1] }));
    expect(() => installCopilotHooks.rewriteHookFile('session-start.json', '/hooks', { sourceDir })).toThrow('invalid hooks object for session-start.json');
  });

  it('throws when hooks property is null', () => {
    const sourceDir = createTempDir('mm-src-');
    writeText(path.join(sourceDir, 'session-start.json'), JSON.stringify({ hooks: null }));
    expect(() => installCopilotHooks.rewriteHookFile('session-start.json', '/hooks', { sourceDir })).toThrow('invalid hooks object for session-start.json');
  });
});

describe('install-copilot-hooks.js main', () => {
  it('calls exit with status 0 and writes stdout', () => {
    const homeDir = createTempDir('mm-home-');
    const writes = []; let exitCode = null;
    installCopilotHooks.main({
      cwd: repoRoot, env: buildEnv(homeDir), homedir: homeDir, argv: [],
      io: { stdout: (t) => writes.push(t), stderr: () => {}, exit: (c) => { exitCode = c; } }
    });
    expect(exitCode).toBe(0);
    expect(writes.join('')).toContain('Installed Memory Mason Copilot hooks');
  });
});

describe('uninstall-copilot-hooks.js parseArgs', () => {
  it('throws on unknown argument', () => {
    expect(() => uninstallCopilotHooks.parseArgs(['--unknown'], '/cwd')).toThrow('unknown argument: --unknown');
  });

  it('throws when --workspace has no value', () => {
    expect(() => uninstallCopilotHooks.parseArgs(['--workspace'], '/cwd')).toThrow('--workspace requires a workspace path');
  });

  it('throws when -w value is empty', () => {
    expect(() => uninstallCopilotHooks.parseArgs(['-w', ''], '/cwd')).toThrow('-w requires a workspace path');
  });
});

describe('uninstall-copilot-hooks.js resolveTargetDir', () => {
  it('falls back to homedir copilot hooks', () => {
    const homeDir = createTempDir('mm-home-');
    expect(uninstallCopilotHooks.resolveTargetDir({ homedir: homeDir })).toBe(path.join(homeDir, '.copilot', 'hooks'));
  });

  it('uses workspacePath when provided', () => {
    const ws = createTempDir('mm-ws-');
    expect(uninstallCopilotHooks.resolveTargetDir({ workspacePath: ws })).toBe(path.join(ws, '.github', 'hooks'));
  });
});

describe('uninstall-copilot-hooks.js main', () => {
  it('calls exit and writes stdout', () => {
    const homeDir = createTempDir('mm-home-');
    const targetDir = createTempDir('mm-target-');
    writeText(path.join(targetDir, 'session-start.json'), '{}');
    const writes = []; let exitCode = null;
    uninstallCopilotHooks.main({
      cwd: repoRoot, env: buildEnv(homeDir), homedir: homeDir, argv: [], targetDir,
      io: { stdout: (t) => writes.push(t), stderr: () => {}, exit: (c) => { exitCode = c; } }
    });
    expect(exitCode).toBe(0);
    expect(writes.join('')).toContain('Removed Memory Mason Copilot hooks');
  });
});

describe('install-copilot-hooks.js runtime fallback branches', () => {
  it('falls back to defaults when argv/cwd/homedir are invalid', () => {
    expect(() => installCopilotHooks.parseArgs(null, null)).not.toThrow();
  });

  it('resolves target dir with homedir fallback', () => {
    const homeDir = createTempDir('mm-home-');
    expect(installCopilotHooks.resolveTargetDir({ homedir: homeDir })).toBe(path.join(homeDir, '.copilot', 'hooks'));
  });

  it('resolves target dir falling back to os.homedir when homedir is invalid', () => {
    const result = installCopilotHooks.resolveTargetDir({ homedir: 42 });
    expect(result).toContain('.copilot');
  });

  it('rewriteEntry handles entry with non-PLACEHOLDER command', () => {
    const entry = { type: 'command', command: 'node hooks/session-start.js', timeout: 10 };
    const result = installCopilotHooks.rewriteEntry(entry, '/my/hooks', 'session-start.js');
    expect(result.command).toContain('/my/hooks');
  });

  it('rewriteEntry handles entry with hooks array', () => {
    const entry = { hooks: [{ type: 'command', command: 'PLACEHOLDER', timeout: 5 }] };
    const result = installCopilotHooks.rewriteEntry(entry, '/my/hooks', 'session-start.js');
    expect(result.hooks[0].command).toContain('/my/hooks');
  });

  it('rewriteEntry handles entry without command or hooks', () => {
    const entry = { type: 'filter', pattern: '*.js' };
    const result = installCopilotHooks.rewriteEntry(entry, '/my/hooks', 'session-start.js');
    expect(result.type).toBe('filter');
  });

  it('rewriteHookFile handles non-array event entries', () => {
    const sourceDir = createTempDir('mm-src-');
    writeText(path.join(sourceDir, 'session-start.json'), JSON.stringify({ hooks: { SessionStart: 'not-an-array' } }));
    const result = installCopilotHooks.rewriteHookFile('session-start.json', '/my/hooks', { sourceDir });
    const parsed = JSON.parse(result);
    expect(parsed.hooks.SessionStart).toBe('not-an-array');
  });
});

describe('uninstall-copilot-hooks.js runtime fallback branches', () => {
  it('falls back to defaults when argv and cwd are invalid', () => {
    const result = uninstallCopilotHooks.parseArgs(null, null);
    expect(result).toBeDefined();
  });

  it('resolves target dir falling back to os.homedir when homedir is invalid', () => {
    const result = uninstallCopilotHooks.resolveTargetDir({ homedir: 42 });
    expect(result).toContain('.copilot');
  });
});