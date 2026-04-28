'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { defaultState, resolveStatePath, loadState, saveState } = require('../lib/state');

let tempDirectories = [];

const trackTempDirectory = (directoryPath) => {
  tempDirectories = tempDirectories.concat([directoryPath]);
  return directoryPath;
};

const createTempVaultPath = () => trackTempDirectory(fs.mkdtempSync(path.join(os.tmpdir(), 'state-test-')));

afterEach(() => {
  tempDirectories.forEach((directoryPath) => {
    if (fs.existsSync(directoryPath)) {
      fs.rmSync(directoryPath, { recursive: true, force: true });
    }
  });
  tempDirectories = [];
});

describe('defaultState', () => {
  it('returns object with ingested, last_compile, and last_lint defaults', () => {
    expect(defaultState()).toEqual({
      ingested: {},
      last_compile: null,
      last_lint: null
    });
  });

  it('returns different object instances across calls', () => {
    const first = defaultState();
    const second = defaultState();

    expect(first).not.toBe(second);
    expect(first.ingested).not.toBe(second.ingested);
  });
});

describe('loadState', () => {
  it('returns default state when file does not exist', () => {
    const vaultPath = createTempVaultPath();
    const subfolder = 'ai-knowledge';

    expect(loadState(vaultPath, subfolder)).toEqual(defaultState());
  });

  it('returns parsed state when file contains valid JSON', () => {
    const vaultPath = createTempVaultPath();
    const subfolder = 'ai-knowledge';
    const statePath = resolveStatePath(vaultPath, subfolder);
    const expected = {
      ingested: {
        '2026-04-26.md': {
          hash: '1234567890abcdef',
          compiled_at: '2026-04-26T14:30:00.000Z'
        }
      },
      last_compile: '2026-04-26T14:30:00.000Z',
      last_lint: null
    };

    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify(expected, null, 2), 'utf-8');

    expect(loadState(vaultPath, subfolder)).toEqual(expected);
  });

  it('returns default state when file contains invalid JSON', () => {
    const vaultPath = createTempVaultPath();
    const subfolder = 'ai-knowledge';
    const statePath = resolveStatePath(vaultPath, subfolder);

    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, '{invalid-json', 'utf-8');

    expect(loadState(vaultPath, subfolder)).toEqual(defaultState());
  });

  it('returns default state when state JSON is an array', () => {
    const vaultPath = createTempVaultPath();
    const subfolder = 'ai-knowledge';
    const statePath = resolveStatePath(vaultPath, subfolder);

    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, '[]', 'utf-8');

    expect(loadState(vaultPath, subfolder)).toEqual(defaultState());
  });

  it('normalizes invalid ingested value to empty object', () => {
    const vaultPath = createTempVaultPath();
    const subfolder = 'ai-knowledge';
    const statePath = resolveStatePath(vaultPath, subfolder);

    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        ingested: null,
        last_compile: '2026-04-26T14:30:00.000Z',
        last_lint: null
      }),
      'utf-8'
    );

    expect(loadState(vaultPath, subfolder)).toEqual({
      ingested: {},
      last_compile: '2026-04-26T14:30:00.000Z',
      last_lint: null
    });
  });

  it('rethrows non-SyntaxError parsing failures', () => {
    const vaultPath = createTempVaultPath();
    const subfolder = 'ai-knowledge';
    const statePath = resolveStatePath(vaultPath, subfolder);
    const originalParse = JSON.parse;

    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, '{"ingested":{}}', 'utf-8');
    JSON.parse = () => {
      throw new TypeError('state parse failed');
    };

    try {
      expect(() => loadState(vaultPath, subfolder)).toThrow('state parse failed');
    } finally {
      JSON.parse = originalParse;
    }
  });
});

describe('saveState', () => {
  it('creates state.json at correct path with formatted JSON', () => {
    const vaultPath = createTempVaultPath();
    const subfolder = 'ai-knowledge';
    const statePath = resolveStatePath(vaultPath, subfolder);
    const state = {
      ingested: {
        '2026-04-26.md': {
          hash: 'abcdef1234567890',
          compiled_at: '2026-04-26T14:30:00.000Z'
        }
      },
      last_compile: '2026-04-26T14:30:00.000Z',
      last_lint: null
    };

    saveState(vaultPath, subfolder, state);

    expect(fs.existsSync(statePath)).toBe(true);
    expect(fs.readFileSync(statePath, 'utf-8')).toBe(JSON.stringify(state, null, 2));
  });

  it('creates intermediate directories when they do not exist', () => {
    const vaultPath = createTempVaultPath();
    const subfolder = path.join('nested', 'knowledge', 'state');
    const statePath = resolveStatePath(vaultPath, subfolder);
    const stateDirectory = path.dirname(statePath);

    expect(fs.existsSync(stateDirectory)).toBe(false);

    saveState(vaultPath, subfolder, defaultState());

    expect(fs.existsSync(stateDirectory)).toBe(true);
    expect(fs.existsSync(statePath)).toBe(true);
  });

  it('throws when state is not an object', () => {
    expect(() => saveState('/vault', 'ai-knowledge', null)).toThrow('state must be an object');
  });
});

describe('resolveStatePath', () => {
  it('returns correct state path using path.join', () => {
    expect(resolveStatePath('/vault', 'ai-knowledge')).toBe(path.join('/vault', 'ai-knowledge', 'state.json'));
  });
});