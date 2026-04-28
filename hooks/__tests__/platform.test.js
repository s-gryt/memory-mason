'use strict';

const { detectPlatform, parseJsonInput, expandHomePath, parseMemoryMasonConfig, resolveVaultConfig } = require('../lib/config');

describe('detectPlatform', () => {
  it('returns copilot-vscode for hookEventName payloads', () => {
    expect(detectPlatform({ hookEventName: 'session-start' })).toBe('copilot-vscode');
  });

  it('returns codex for hook_event_name + turn_id payloads', () => {
    expect(detectPlatform({ hook_event_name: 'session_start', turn_id: 'turn-123' })).toBe('codex');
  });

  it('returns claude-code for hook_event_name without turn_id', () => {
    expect(detectPlatform({ hook_event_name: 'session_start' })).toBe('claude-code');
  });

  it('returns copilot-cli for timestamp-only payloads', () => {
    expect(detectPlatform({ timestamp: '2026-04-26T14:30:00.000Z' })).toBe('copilot-cli');
  });

  it('throws on null input', () => {
    expect(() => detectPlatform(null)).toThrow('input must be a non-empty object');
  });

  it('throws on array input', () => {
    expect(() => detectPlatform([])).toThrow('input must be a non-empty object');
  });

  it('throws on empty object', () => {
    expect(() => detectPlatform({})).toThrow('input must be a non-empty object');
  });

  it('throws on unrecognized payload shape', () => {
    expect(() => detectPlatform({ randomKey: 'value' })).toThrow('cannot detect platform from stdin shape:');
  });
});

describe('parseJsonInput', () => {
  it('parses valid JSON object', () => {
    expect(parseJsonInput('{"vaultPath":"/vault","subfolder":"ai-knowledge"}')).toEqual({
      vaultPath: '/vault',
      subfolder: 'ai-knowledge'
    });
  });

  it('throws on empty string', () => {
    expect(() => parseJsonInput('')).toThrow('stdin must be a non-empty string');
  });

  it('throws on non-string input (number)', () => {
    expect(() => parseJsonInput(123)).toThrow('stdin must be a non-empty string');
  });

  it('throws on valid JSON that is not a plain object (array)', () => {
    expect(() => parseJsonInput('[1,2,3]')).toThrow('invalid JSON in stdin:');
  });

  it('throws on valid JSON that is null', () => {
    expect(() => parseJsonInput('null')).toThrow('invalid JSON in stdin:');
  });

  it('throws on completely invalid JSON', () => {
    expect(() => parseJsonInput('{not-json')).toThrow('invalid JSON in stdin:');
  });

  it('recovers JSON with unescaped single backslashes', () => {
    const raw = String.raw`{"vaultPath":"C:\Users\alice\vault","subfolder":"ai-knowledge"}`;

    expect(parseJsonInput(raw)).toEqual({
      vaultPath: 'C:\\Users\\alice\\vault',
      subfolder: 'ai-knowledge'
    });
  });

  it('throws when escaped recovery produces an array instead of object', () => {
    const raw = String.raw`["C:\Users\alice"]`;

    expect(() => parseJsonInput(raw)).toThrow('invalid JSON in stdin:');
  });
});

describe('expandHomePath', () => {
  it('expands ~/path to homedir/path', () => {
    expect(expandHomePath('~/notes', '/home/tester')).toBe('/home/tester/notes');
  });

  it('expands ~/ to homedir/', () => {
    expect(expandHomePath('~/', '/home/tester')).toBe('/home/tester/');
  });

  it('does not expand paths without leading tilde', () => {
    expect(expandHomePath('/tmp/file', '/home/tester')).toBe('/tmp/file');
  });

  it('does not expand ~word (no slash)', () => {
    expect(expandHomePath('~file', '/home/tester')).toBe('~file');
  });

  it('throws if inputPath is empty', () => {
    expect(() => expandHomePath('', '/home/tester')).toThrow('inputPath must be a non-empty string');
  });

  it('throws if homedir is empty', () => {
    expect(() => expandHomePath('~/notes', '')).toThrow('homedir must be a non-empty string');
  });
});

describe('parseMemoryMasonConfig', () => {
  it('parses a valid memory-mason config object', () => {
    expect(parseMemoryMasonConfig('{"vaultPath":"~/vault","subfolder":"ai-knowledge"}')).toEqual({
      vaultPath: '~/vault',
      subfolder: 'ai-knowledge'
    });
  });

  it('throws on invalid config JSON', () => {
    expect(() => parseMemoryMasonConfig('{not-json')).toThrow('invalid memory-mason config JSON');
  });

  it('throws when config is not an object', () => {
    expect(() => parseMemoryMasonConfig('[]')).toThrow('memory-mason config must be an object');
  });

  it('throws when vaultPath is missing', () => {
    expect(() => parseMemoryMasonConfig('{"subfolder":"ai-knowledge"}')).toThrow(
      'vaultPath must be a non-empty string'
    );
  });
});

describe('resolveVaultConfig', () => {
  it('uses MEMORY_MASON_VAULT_PATH when provided', () => {
    expect(resolveVaultConfig('/repo', '~/vault', '', '/home/tester')).toEqual({
      vaultPath: '/home/tester/vault',
      subfolder: 'ai-knowledge'
    });
  });

  it('uses memory-mason.json when provided', () => {
    expect(
      resolveVaultConfig('/repo', '', '{"vaultPath":"~/vault","subfolder":"notes"}', '/home/tester')
    ).toEqual({
      vaultPath: '/home/tester/vault',
      subfolder: 'notes'
    });
  });

  it('fails fast when neither config source is provided', () => {
    expect(() => resolveVaultConfig('/repo', '', '', '/home/tester')).toThrow(
      'memory-mason.json not found and MEMORY_MASON_VAULT_PATH is not set'
    );
  });

  it('throws when cwd is empty and no config source exists', () => {
    expect(() => resolveVaultConfig('', '', '', '/home/tester')).toThrow('cwd must be a non-empty string');
  });

  it('treats non-string env and config inputs as absent', () => {
    expect(() => resolveVaultConfig('/repo', null, null, '/home/tester')).toThrow(
      'memory-mason.json not found and MEMORY_MASON_VAULT_PATH is not set'
    );
  });
});