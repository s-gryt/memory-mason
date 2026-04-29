'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  defaultCaptureState,
  resolveCaptureStatePath,
  loadCaptureState,
  saveCaptureState,
  buildCaptureRecord,
  isDuplicateCapture,
  getTranscriptTurnCount,
  setTranscriptTurnCount
} = require('../lib/capture-state');

let tempDirectories = [];

const trackTempDirectory = (directoryPath) => {
  tempDirectories = tempDirectories.concat([directoryPath]);
  return directoryPath;
};

const createTempVaultPath = () => trackTempDirectory(fs.mkdtempSync(path.join(os.tmpdir(), 'capture-state-test-')));

afterEach(() => {
  tempDirectories.forEach((directoryPath) => {
    if (fs.existsSync(directoryPath)) {
      fs.rmSync(directoryPath, { recursive: true, force: true });
    }
  });
  tempDirectories = [];
});

describe('defaultCaptureState', () => {
  it('returns object with null lastCapture', () => {
    expect(defaultCaptureState()).toEqual({
      lastCapture: null
    });
  });

  it('returns a new object on each call', () => {
    const first = defaultCaptureState();
    const second = defaultCaptureState();

    expect(first).not.toBe(second);
  });
});

describe('capture state file I/O', () => {
  it('returns default state when capture state file does not exist', () => {
    const vaultPath = createTempVaultPath();
    expect(loadCaptureState(vaultPath, 'ai-knowledge')).toEqual(defaultCaptureState());
  });

  it('saves and loads capture state', () => {
    const vaultPath = createTempVaultPath();
    const state = {
      lastCapture: buildCaptureRecord('session-1', 'pre-compact', 'hello', 1714230000000)
    };

    saveCaptureState(vaultPath, 'ai-knowledge', state);

    expect(loadCaptureState(vaultPath, 'ai-knowledge')).toEqual(state);
  });

  it('returns default state when capture state file contains invalid JSON', () => {
    const vaultPath = createTempVaultPath();
    const statePath = resolveCaptureStatePath(vaultPath, 'ai-knowledge');
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, '{invalid-json', 'utf-8');

    expect(loadCaptureState(vaultPath, 'ai-knowledge')).toEqual(defaultCaptureState());
  });

  it('returns default state when capture state JSON is an array', () => {
    const vaultPath = createTempVaultPath();
    const statePath = resolveCaptureStatePath(vaultPath, 'ai-knowledge');
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, '[]', 'utf-8');

    expect(loadCaptureState(vaultPath, 'ai-knowledge')).toEqual(defaultCaptureState());
  });

  it('sanitizes invalid lastCapture records when loading state', () => {
    const vaultPath = createTempVaultPath();
    const statePath = resolveCaptureStatePath(vaultPath, 'ai-knowledge');
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        lastCapture: {
          sessionId: 'session-1',
          source: '',
          contentHash: 'abc',
          timestampMs: 1714230000000
        }
      }),
      'utf-8'
    );

    expect(loadCaptureState(vaultPath, 'ai-knowledge')).toEqual(defaultCaptureState());
  });

  it('throws when saveCaptureState receives non-object state', () => {
    expect(() => saveCaptureState('/vault', 'ai-knowledge', null)).toThrow('state must be an object');
  });

  it('rethrows non-SyntaxError parsing failures', () => {
    const vaultPath = createTempVaultPath();
    const statePath = resolveCaptureStatePath(vaultPath, 'ai-knowledge');
    const originalParse = JSON.parse;
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, '{"lastCapture":null}', 'utf-8');
    JSON.parse = () => {
      throw new TypeError('parse failed');
    };

    try {
      expect(() => loadCaptureState(vaultPath, 'ai-knowledge')).toThrow('parse failed');
    } finally {
      JSON.parse = originalParse;
    }
  });
});

describe('buildCaptureRecord', () => {
  it('builds hashed capture record metadata', () => {
    const record = buildCaptureRecord('session-1', 'pre-compact', 'hello', 1714230000000);

    expect(record.sessionId).toBe('session-1');
    expect(record.source).toBe('pre-compact');
    expect(record.contentHash).toHaveLength(16);
    expect(record.timestampMs).toBe(1714230000000);
  });

  it('throws when timestamp is not a positive integer', () => {
    expect(() => buildCaptureRecord('session-1', 'pre-compact', 'hello', 0)).toThrow(
      'timestampMs must be a positive integer'
    );
  });

  it('throws when content is not a string', () => {
    expect(() => buildCaptureRecord('session-1', 'pre-compact', null, 1714230000000)).toThrow(
      'content must be a string'
    );
  });
});

describe('isDuplicateCapture', () => {
  it('returns true for same session and same content hash within 60 seconds', () => {
    const firstCapture = buildCaptureRecord('session-1', 'pre-compact', 'same content', 1714230000000);
    const secondCapture = buildCaptureRecord('session-1', 'session-end', 'same content', 1714230005000);

    expect(isDuplicateCapture(firstCapture, secondCapture, 60000)).toBe(true);
  });

  it('returns false when content differs', () => {
    const firstCapture = buildCaptureRecord('session-1', 'pre-compact', 'first content', 1714230000000);
    const secondCapture = buildCaptureRecord('session-1', 'session-end', 'second content', 1714230005000);

    expect(isDuplicateCapture(firstCapture, secondCapture, 60000)).toBe(false);
  });

  it('returns false when time window is exceeded', () => {
    const firstCapture = buildCaptureRecord('session-1', 'pre-compact', 'same content', 1714230000000);
    const secondCapture = buildCaptureRecord('session-1', 'session-end', 'same content', 1714230065001);

    expect(isDuplicateCapture(firstCapture, secondCapture, 60000)).toBe(false);
  });

  it('returns false when session differs', () => {
    const firstCapture = buildCaptureRecord('session-1', 'pre-compact', 'same content', 1714230000000);
    const secondCapture = buildCaptureRecord('session-2', 'session-end', 'same content', 1714230005000);

    expect(isDuplicateCapture(firstCapture, secondCapture, 60000)).toBe(false);
  });

  it('returns false when previous capture is invalid', () => {
    const secondCapture = buildCaptureRecord('session-2', 'session-end', 'same content', 1714230005000);

    expect(isDuplicateCapture({ bad: true }, secondCapture, 60000)).toBe(false);
  });

  it('throws when next capture is invalid', () => {
    expect(() => isDuplicateCapture(null, null, 60000)).toThrow('nextCapture must be a valid capture record');
  });
});

describe('capture-state.js helpers', () => {
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
    const vaultPath = createTempVaultPath();
    const statePath = resolveCaptureStatePath(vaultPath, 'ai-knowledge');

    fs.mkdirSync(path.dirname(statePath), { recursive: true });

    fs.writeFileSync(
      statePath,
      JSON.stringify({
        lastCapture: null,
        transcriptTurnCounts: {
          'session-1': 3,
          'session-2': -1,
          'session-3': 1.5,
          'session-4': '4'
        }
      }),
      'utf-8'
    );

    expect(loadCaptureState(vaultPath, 'ai-knowledge')).toEqual({
      lastCapture: null,
      transcriptTurnCounts: {
        'session-1': 3
      }
    });
  });
});