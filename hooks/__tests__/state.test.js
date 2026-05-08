"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { UTF8_ENCODING } = require("../lib/shared/constants");
const { VAULT_META_DIR_NAME, VAULT_STATE_FILE_NAME } = require("../lib/vault/vault-paths");
const {
  TEST_DEFAULT_VAULT_PATH,
  TEST_DEFAULT_SUBFOLDER: DEFAULT_SUBFOLDER,
} = require("./helpers/test-constants");
const { createTempVaultFixture } = require("./helpers/fs-mock");
const {
  defaultState,
  resolveStatePath,
  loadState,
  saveState,
  updateStateCaptureMetrics,
  recordCaptureMetrics,
} = require("../lib/state/state");

const { createTempVaultPath, cleanupTempVaultPaths } = createTempVaultFixture("state-test-");
const JSON_INDENT_SPACES = 2;

afterEach(() => {
  cleanupTempVaultPaths();
});

describe("defaultState", () => {
  it("returns object with compile and capture metric defaults", () => {
    expect(defaultState()).toEqual({
      ingested: {},
      last_compile: null,
      last_lint: null,
      capture_metrics: {
        capture_count: 0,
        total_raw_chars: 0,
        total_stored_chars: 0,
        total_raw_tokens: 0,
        total_stored_tokens: 0,
        total_savings_chars: 0,
        total_savings_tokens: 0,
        total_savings_percent: 0,
        last_capture_at: null,
        last_capture: null,
      },
    });
  });

  it("returns different object instances across calls", () => {
    const first = defaultState();
    const second = defaultState();

    expect(first).not.toBe(second);
    expect(first.ingested).not.toBe(second.ingested);
  });
});

describe("loadState", () => {
  it("returns default state when file does not exist", () => {
    const vaultPath = createTempVaultPath();
    const subfolder = DEFAULT_SUBFOLDER;

    expect(loadState(vaultPath, subfolder)).toEqual(defaultState());
  });

  it("returns parsed state when file contains valid JSON", () => {
    const vaultPath = createTempVaultPath();
    const subfolder = DEFAULT_SUBFOLDER;
    const statePath = resolveStatePath(vaultPath, subfolder);
    const expected = {
      ingested: {
        "2026-04-26.md": {
          hash: "1234567890abcdef",
          compiled_at: "2026-04-26T14:30:00.000Z",
        },
      },
      last_compile: "2026-04-26T14:30:00.000Z",
      last_lint: null,
      capture_metrics: {
        capture_count: 1,
        total_raw_chars: 10,
        total_stored_chars: 4,
        total_raw_tokens: 3,
        total_stored_tokens: 1,
        total_savings_chars: 6,
        total_savings_tokens: 2,
        total_savings_percent: 67,
        last_capture_at: "2026-04-26T14:30:00.000Z",
        last_capture: {
          source: "post-tool-use",
          captured_at: "2026-04-26T14:30:00.000Z",
          raw_chars: 10,
          stored_chars: 4,
          raw_tokens: 3,
          stored_tokens: 1,
          savings_chars: 6,
          savings_tokens: 2,
          savings_percent: 67,
        },
      },
    };

    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify(expected, null, JSON_INDENT_SPACES), UTF8_ENCODING);

    expect(loadState(vaultPath, subfolder)).toEqual(expected);
  });

  it("returns default state when file contains invalid JSON", () => {
    const vaultPath = createTempVaultPath();
    const subfolder = DEFAULT_SUBFOLDER;
    const statePath = resolveStatePath(vaultPath, subfolder);

    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, "{invalid-json", UTF8_ENCODING);

    expect(loadState(vaultPath, subfolder)).toEqual(defaultState());
  });

  it("returns default state when state JSON is an array", () => {
    const vaultPath = createTempVaultPath();
    const subfolder = DEFAULT_SUBFOLDER;
    const statePath = resolveStatePath(vaultPath, subfolder);

    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, "[]", UTF8_ENCODING);

    expect(loadState(vaultPath, subfolder)).toEqual(defaultState());
  });

  it("normalizes invalid ingested value to empty object", () => {
    const vaultPath = createTempVaultPath();
    const subfolder = DEFAULT_SUBFOLDER;
    const statePath = resolveStatePath(vaultPath, subfolder);

    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        ingested: null,
        last_compile: "2026-04-26T14:30:00.000Z",
        last_lint: null,
        capture_metrics: null,
      }),
      UTF8_ENCODING,
    );

    expect(loadState(vaultPath, subfolder)).toEqual({
      ingested: {},
      last_compile: "2026-04-26T14:30:00.000Z",
      last_lint: null,
      capture_metrics: defaultState().capture_metrics,
    });
  });

  it("normalizes invalid capture metrics values", () => {
    const vaultPath = createTempVaultPath();
    const subfolder = DEFAULT_SUBFOLDER;
    const statePath = resolveStatePath(vaultPath, subfolder);

    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        ingested: {},
        last_compile: null,
        last_lint: null,
        capture_metrics: {
          capture_count: 2,
          total_raw_chars: 8,
          total_stored_chars: 4,
          total_raw_tokens: 2,
          total_stored_tokens: 1,
          total_savings_chars: 999,
          total_savings_tokens: 999,
          total_savings_percent: 999,
          last_capture_at: 123,
          last_capture: { raw_chars: 4 },
        },
      }),
      UTF8_ENCODING,
    );

    expect(loadState(vaultPath, subfolder)).toEqual({
      ingested: {},
      last_compile: null,
      last_lint: null,
      capture_metrics: {
        capture_count: 2,
        total_raw_chars: 8,
        total_stored_chars: 4,
        total_raw_tokens: 2,
        total_stored_tokens: 1,
        total_savings_chars: 4,
        total_savings_tokens: 1,
        total_savings_percent: 50,
        last_capture_at: null,
        last_capture: null,
      },
    });
  });

  it("rethrows non-SyntaxError parsing failures", () => {
    const vaultPath = createTempVaultPath();
    const subfolder = DEFAULT_SUBFOLDER;
    const statePath = resolveStatePath(vaultPath, subfolder);
    const originalParse = JSON.parse;

    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, '{"ingested":{}}', UTF8_ENCODING);
    JSON.parse = () => {
      throw new TypeError("state parse failed");
    };

    try {
      expect(() => loadState(vaultPath, subfolder)).toThrow("state parse failed");
    } finally {
      JSON.parse = originalParse;
    }
  });
});

describe("saveState", () => {
  it("creates state.json at correct path with formatted JSON", () => {
    const vaultPath = createTempVaultPath();
    const subfolder = DEFAULT_SUBFOLDER;
    const statePath = resolveStatePath(vaultPath, subfolder);
    const state = {
      ingested: {
        "2026-04-26.md": {
          hash: "abcdef1234567890",
          compiled_at: "2026-04-26T14:30:00.000Z",
        },
      },
      last_compile: "2026-04-26T14:30:00.000Z",
      last_lint: null,
      capture_metrics: defaultState().capture_metrics,
    };

    saveState(vaultPath, subfolder, state);

    expect(fs.existsSync(statePath)).toBe(true);
    expect(fs.readFileSync(statePath, UTF8_ENCODING)).toBe(
      JSON.stringify(state, null, JSON_INDENT_SPACES),
    );
  });

  it("creates intermediate directories when they do not exist", () => {
    const vaultPath = createTempVaultPath();
    const subfolder = path.join("nested", "knowledge", "state");
    const statePath = resolveStatePath(vaultPath, subfolder);
    const stateDirectory = path.dirname(statePath);

    expect(fs.existsSync(stateDirectory)).toBe(false);

    saveState(vaultPath, subfolder, defaultState());

    expect(fs.existsSync(stateDirectory)).toBe(true);
    expect(fs.existsSync(statePath)).toBe(true);
  });

  it("throws when state is not an object", () => {
    expect(() => saveState(TEST_DEFAULT_VAULT_PATH, DEFAULT_SUBFOLDER, null)).toThrow(
      "state must be an object",
    );
  });
});

describe("resolveStatePath", () => {
  it("returns correct state path using path.join", () => {
    expect(resolveStatePath(TEST_DEFAULT_VAULT_PATH, DEFAULT_SUBFOLDER)).toBe(
      path.join(
        TEST_DEFAULT_VAULT_PATH,
        DEFAULT_SUBFOLDER,
        VAULT_META_DIR_NAME,
        VAULT_STATE_FILE_NAME,
      ),
    );
  });
});

describe("updateStateCaptureMetrics", () => {
  it("returns a new state with accumulated capture metrics", () => {
    expect(
      updateStateCaptureMetrics(
        defaultState(),
        "post-tool-use",
        "2026-05-07T10:00:00",
        "12345678",
        "1234",
      ),
    ).toEqual({
      ingested: {},
      last_compile: null,
      last_lint: null,
      capture_metrics: {
        capture_count: 1,
        total_raw_chars: 8,
        total_stored_chars: 4,
        total_raw_tokens: 2,
        total_stored_tokens: 1,
        total_savings_chars: 4,
        total_savings_tokens: 1,
        total_savings_percent: 50,
        last_capture_at: "2026-05-07T10:00:00",
        last_capture: {
          source: "post-tool-use",
          captured_at: "2026-05-07T10:00:00",
          raw_chars: 8,
          stored_chars: 4,
          raw_tokens: 2,
          stored_tokens: 1,
          savings_chars: 4,
          savings_tokens: 1,
          savings_percent: 50,
        },
      },
    });
  });

  it("throws when state is not an object", () => {
    expect(() =>
      updateStateCaptureMetrics(null, "post-tool-use", "2026-05-07T10:00:00", "1234", "12"),
    ).toThrow("state must be an object");
  });
});

describe("recordCaptureMetrics", () => {
  it("loads, updates, and saves capture metrics to state.json", () => {
    const vaultPath = createTempVaultPath();
    const subfolder = DEFAULT_SUBFOLDER;

    expect(
      recordCaptureMetrics(
        vaultPath,
        subfolder,
        "post-tool-use",
        "2026-05-07T10:00:00",
        "12345678",
        "1234",
      ),
    ).toEqual({
      ingested: {},
      last_compile: null,
      last_lint: null,
      capture_metrics: {
        capture_count: 1,
        total_raw_chars: 8,
        total_stored_chars: 4,
        total_raw_tokens: 2,
        total_stored_tokens: 1,
        total_savings_chars: 4,
        total_savings_tokens: 1,
        total_savings_percent: 50,
        last_capture_at: "2026-05-07T10:00:00",
        last_capture: {
          source: "post-tool-use",
          captured_at: "2026-05-07T10:00:00",
          raw_chars: 8,
          stored_chars: 4,
          raw_tokens: 2,
          stored_tokens: 1,
          savings_chars: 4,
          savings_tokens: 1,
          savings_percent: 50,
        },
      },
    });

    expect(loadState(vaultPath, subfolder)).toEqual({
      ingested: {},
      last_compile: null,
      last_lint: null,
      capture_metrics: {
        capture_count: 1,
        total_raw_chars: 8,
        total_stored_chars: 4,
        total_raw_tokens: 2,
        total_stored_tokens: 1,
        total_savings_chars: 4,
        total_savings_tokens: 1,
        total_savings_percent: 50,
        last_capture_at: "2026-05-07T10:00:00",
        last_capture: {
          source: "post-tool-use",
          captured_at: "2026-05-07T10:00:00",
          raw_chars: 8,
          stored_chars: 4,
          raw_tokens: 2,
          stored_tokens: 1,
          savings_chars: 4,
          savings_tokens: 1,
          savings_percent: 50,
        },
      },
    });
  });
});
