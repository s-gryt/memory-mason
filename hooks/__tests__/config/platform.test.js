"use strict";

const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const {
  ENV_KEY_VAULT_PATH,
  ENV_KEY_SYNC,
  ENV_KEY_CAPTURE_MODE,
} = require("../../lib/config/constants");
const {
  detectPlatform,
  parseJsonInput,
  expandHomePath,
  parseMemoryMasonConfig,
  parseDotEnv,
  resolveVaultConfig,
} = require("../../lib/config/config");
const {
  TEST_DEFAULT_HOME_PATH,
  TEST_DEFAULT_REPO_PATH,
  TEST_DEFAULT_VAULT_FULL_PATH,
  TEST_DEFAULT_NOTES_PATH,
  TEST_CAPTURE_MODE_LITE: CAPTURE_MODE_LITE,
  TEST_CAPTURE_MODE_FULL: CAPTURE_MODE_FULL,
  TEST_DEFAULT_SUBFOLDER: DEFAULT_SUBFOLDER,
  TEST_PLATFORM_CLAUDE_CODE: PLATFORM_CLAUDE_CODE,
  TEST_PLATFORM_COPILOT_VSCODE: PLATFORM_COPILOT_VSCODE,
  TEST_PLATFORM_COPILOT_CLI: PLATFORM_COPILOT_CLI,
  TEST_PLATFORM_CODEX: PLATFORM_CODEX,
} = require("../helpers/test-constants");

const TEST_INVALID_STDIN_NUMBER = 123;

const loadConfigModuleWithInternals = () => {
  const configPath = require.resolve("../../lib/config/config");
  const configSource = fs.readFileSync(configPath, "utf-8");
  const configModule = new Module(configPath, module);
  configModule.filename = configPath;
  configModule.paths = Module._nodeModulePaths(path.dirname(configPath));
  configModule._compile(
    `${configSource}\nmodule.exports.__resolveEnvOverrides = resolveEnvOverrides;\n`,
    configPath,
  );
  return configModule.exports;
};

describe("detectPlatform", () => {
  it("returns copilot-vscode for hookEventName payloads", () => {
    expect(detectPlatform({ hookEventName: "session-start" })).toBe(PLATFORM_COPILOT_VSCODE);
  });

  it("returns codex for hook_event_name + turn_id payloads", () => {
    expect(detectPlatform({ hook_event_name: "session_start", turn_id: "turn-123" })).toBe(
      PLATFORM_CODEX,
    );
  });

  it("returns claude-code for hook_event_name without turn_id", () => {
    expect(detectPlatform({ hook_event_name: "session_start" })).toBe(PLATFORM_CLAUDE_CODE);
  });

  it("returns copilot-cli for timestamp-only payloads", () => {
    expect(detectPlatform({ timestamp: "2026-04-26T14:30:00.000Z" })).toBe(PLATFORM_COPILOT_CLI);
  });

  it("throws on null input", () => {
    expect(() => detectPlatform(null)).toThrow("input must be a non-empty object");
  });

  it("throws on array input", () => {
    expect(() => detectPlatform([])).toThrow("input must be a non-empty object");
  });

  it("throws on empty object", () => {
    expect(() => detectPlatform({})).toThrow("input must be a non-empty object");
  });

  it("throws on unrecognized payload shape", () => {
    expect(() => detectPlatform({ randomKey: "value" })).toThrow(
      "cannot detect platform from stdin shape:",
    );
  });
});

describe("parseJsonInput", () => {
  it("parses valid JSON object", () => {
    expect(parseJsonInput(`{"vaultPath":"/vault","subfolder":"${DEFAULT_SUBFOLDER}"}`)).toEqual({
      vaultPath: "/vault",
      subfolder: DEFAULT_SUBFOLDER,
    });
  });

  it("throws on empty string", () => {
    expect(() => parseJsonInput("")).toThrow("stdin must be a non-empty string");
  });

  it("throws on non-string input (number)", () => {
    expect(() => parseJsonInput(TEST_INVALID_STDIN_NUMBER)).toThrow(
      "stdin must be a non-empty string",
    );
  });

  it("throws on valid JSON that is not a plain object (array)", () => {
    expect(() => parseJsonInput("[1,2,3]")).toThrow("invalid JSON in stdin:");
  });

  it("throws on valid JSON that is null", () => {
    expect(() => parseJsonInput("null")).toThrow("invalid JSON in stdin:");
  });

  it("throws on completely invalid JSON", () => {
    expect(() => parseJsonInput("{not-json")).toThrow("invalid JSON in stdin:");
  });

  it("recovers JSON with unescaped single backslashes", () => {
    const raw = String.raw`{"vaultPath":"C:\Users\alice\vault","subfolder":"${DEFAULT_SUBFOLDER}"}`;

    expect(parseJsonInput(raw)).toEqual({
      vaultPath: "C:\\Users\\alice\\vault",
      subfolder: DEFAULT_SUBFOLDER,
    });
  });

  it("throws when escaped recovery produces an array instead of object", () => {
    const raw = String.raw`["C:\Users\alice"]`;

    expect(() => parseJsonInput(raw)).toThrow("invalid JSON in stdin:");
  });
});

describe("expandHomePath", () => {
  it("expands ~/path to homedir/path", () => {
    expect(expandHomePath("~/notes", TEST_DEFAULT_HOME_PATH)).toBe("/home/tester/notes");
  });

  it("expands ~/ to homedir/", () => {
    expect(expandHomePath("~/", TEST_DEFAULT_HOME_PATH)).toBe("/home/tester/");
  });

  it("does not expand paths without leading tilde", () => {
    expect(expandHomePath("/tmp/file", TEST_DEFAULT_HOME_PATH)).toBe("/tmp/file");
  });

  it("does not expand ~word (no slash)", () => {
    expect(expandHomePath("~file", TEST_DEFAULT_HOME_PATH)).toBe("~file");
  });

  it("throws if inputPath is empty", () => {
    expect(() => expandHomePath("", TEST_DEFAULT_HOME_PATH)).toThrow(
      "inputPath must be a non-empty string",
    );
  });

  it("throws if homedir is empty", () => {
    expect(() => expandHomePath("~/notes", "")).toThrow("homedir must be a non-empty string");
  });
});

describe("parseMemoryMasonConfig", () => {
  it("parses a valid memory-mason config object", () => {
    expect(
      parseMemoryMasonConfig(`{"vaultPath":"~/vault","subfolder":"${DEFAULT_SUBFOLDER}"}`),
    ).toEqual({
      vaultPath: "~/vault",
      subfolder: DEFAULT_SUBFOLDER,
    });
  });

  it("throws on invalid config JSON", () => {
    expect(() => parseMemoryMasonConfig("{not-json")).toThrow("invalid memory-mason config JSON");
  });

  it("throws when sync is null", () => {
    expect(() =>
      parseMemoryMasonConfig(
        `{"vaultPath":"~/vault","subfolder":"${DEFAULT_SUBFOLDER}","sync":null}`,
      ),
    ).toThrow("config sync must be a boolean, got: null");
  });

  it("throws when sync is an array", () => {
    expect(() =>
      parseMemoryMasonConfig(
        `{"vaultPath":"~/vault","subfolder":"${DEFAULT_SUBFOLDER}","sync":[]}`,
      ),
    ).toThrow("config sync must be a boolean, got: array");
  });

  it("throws when config is not an object", () => {
    expect(() => parseMemoryMasonConfig("[]")).toThrow("memory-mason config must be an object");
  });

  it("throws when vaultPath is missing", () => {
    expect(() => parseMemoryMasonConfig(`{"subfolder":"${DEFAULT_SUBFOLDER}"}`)).toThrow(
      "vaultPath must be a non-empty string",
    );
  });
});

describe("parseDotEnv", () => {
  it("parses simple KEY=VALUE", () => {
    expect(parseDotEnv("MEMORY_MASON_VAULT_PATH=/vault/path")).toEqual({
      MEMORY_MASON_VAULT_PATH: "/vault/path",
    });
  });

  it("strips double quotes from values", () => {
    expect(parseDotEnv('MEMORY_MASON_SUBFOLDER="my-brain"')).toEqual({
      MEMORY_MASON_SUBFOLDER: "my-brain",
    });
  });

  it("strips single quotes from values", () => {
    expect(parseDotEnv("MEMORY_MASON_SUBFOLDER='my-brain'")).toEqual({
      MEMORY_MASON_SUBFOLDER: "my-brain",
    });
  });

  it("skips comment and empty lines", () => {
    expect(parseDotEnv("\n# comment\nMEMORY_MASON_SUBFOLDER=my-brain\n\n")).toEqual({
      MEMORY_MASON_SUBFOLDER: "my-brain",
    });
  });

  it("handles spaces around equals and quoted values with spaces", () => {
    expect(parseDotEnv('MEMORY_MASON_SUBFOLDER = "my brain"')).toEqual({
      MEMORY_MASON_SUBFOLDER: "my brain",
    });
  });

  it("strips inline comments and keeps hash symbols inside quotes", () => {
    expect(
      parseDotEnv(
        'MEMORY_MASON_SUBFOLDER=my-brain # comment\nMEMORY_MASON_VAULT_PATH="/tmp/#vault" # comment',
      ),
    ).toEqual({
      MEMORY_MASON_SUBFOLDER: "my-brain",
      MEMORY_MASON_VAULT_PATH: "/tmp/#vault",
    });
  });

  it("ignores malformed lines without key-value separator", () => {
    expect(parseDotEnv("NOT_A_PAIR\n=missingKey\nMEMORY_MASON_SUBFOLDER=ok")).toEqual({
      MEMORY_MASON_SUBFOLDER: "ok",
    });
  });

  it("returns empty object for empty string", () => {
    expect(parseDotEnv("")).toEqual({});
  });

  it("returns empty object for non-string input", () => {
    expect(parseDotEnv(null)).toEqual({});
  });

  it("keeps unterminated quoted values as-is", () => {
    expect(parseDotEnv('MEMORY_MASON_SUBFOLDER="unterminated')).toEqual({
      MEMORY_MASON_SUBFOLDER: '"unterminated',
    });
  });
});

describe("resolveEnvOverrides", () => {
  it("treats non-object env as empty env overrides", () => {
    const configModule = loadConfigModuleWithInternals();

    expect(configModule.__resolveEnvOverrides(null)).toEqual({
      syncFromEnv: null,
      captureModeFromEnv: null,
    });
  });
});

describe("resolveVaultConfig", () => {
  let originalMemoryMasonSyncIsSet = false;
  let originalMemoryMasonSync = "";
  let originalMemoryMasonCaptureModeIsSet = false;
  let originalMemoryMasonCaptureMode = "";

  const withMemoryMasonSync = (value, callback) => {
    const hadSync = Object.hasOwn(process.env, ENV_KEY_SYNC);
    const previousSync = process.env[ENV_KEY_SYNC];

    if (typeof value === "string") {
      process.env[ENV_KEY_SYNC] = value;
    } else {
      delete process.env[ENV_KEY_SYNC];
    }

    try {
      return callback();
    } finally {
      if (hadSync && typeof previousSync === "string") {
        process.env[ENV_KEY_SYNC] = previousSync;
      } else {
        delete process.env[ENV_KEY_SYNC];
      }
    }
  };

  const withMemoryMasonCaptureMode = (value, callback) => {
    const hadCaptureMode = Object.hasOwn(process.env, ENV_KEY_CAPTURE_MODE);
    const previousCaptureMode = process.env[ENV_KEY_CAPTURE_MODE];

    if (typeof value === "string") {
      process.env[ENV_KEY_CAPTURE_MODE] = value;
    } else {
      delete process.env[ENV_KEY_CAPTURE_MODE];
    }

    try {
      return callback();
    } finally {
      if (hadCaptureMode && typeof previousCaptureMode === "string") {
        process.env[ENV_KEY_CAPTURE_MODE] = previousCaptureMode;
      } else {
        delete process.env[ENV_KEY_CAPTURE_MODE];
      }
    }
  };

  const expectLiteVaultConfig = (result, vaultPath, subfolder, sync = true) => {
    expect(result).toEqual({
      vaultPath,
      subfolder,
      sync,
      captureMode: CAPTURE_MODE_LITE,
    });
  };

  const expectProjectJsonVaultNotesConfig = () => {
    expectLiteVaultConfig(
      resolveVaultConfig(
        TEST_DEFAULT_REPO_PATH,
        `{"vaultPath":"~/vault","subfolder":"${TEST_DEFAULT_NOTES_PATH}"}`,
        TEST_DEFAULT_HOME_PATH,
      ),
      TEST_DEFAULT_VAULT_FULL_PATH,
      TEST_DEFAULT_NOTES_PATH,
    );
  };

  const expectDotEnvVaultDefaultSubfolderConfig = () => {
    expectLiteVaultConfig(
      resolveVaultConfig(TEST_DEFAULT_REPO_PATH, "", TEST_DEFAULT_HOME_PATH, {
        dotEnvText: "MEMORY_MASON_VAULT_PATH=~/vault",
      }),
      TEST_DEFAULT_VAULT_FULL_PATH,
      DEFAULT_SUBFOLDER,
    );
  };

  const expectGlobalDotEnvVaultConfig = () => {
    expectLiteVaultConfig(
      resolveVaultConfig(TEST_DEFAULT_REPO_PATH, "", TEST_DEFAULT_HOME_PATH, {
        globalDotEnvText:
          "MEMORY_MASON_VAULT_PATH=~/global-env-vault\nMEMORY_MASON_SUBFOLDER=global-env-brain",
      }),
      "/home/tester/global-env-vault",
      "global-env-brain",
    );
  };

  beforeEach(() => {
    originalMemoryMasonSyncIsSet = Object.hasOwn(process.env, ENV_KEY_SYNC);
    originalMemoryMasonSync =
      typeof process.env[ENV_KEY_SYNC] === "string" ? process.env[ENV_KEY_SYNC] : "";
    originalMemoryMasonCaptureModeIsSet = Object.hasOwn(process.env, ENV_KEY_CAPTURE_MODE);
    originalMemoryMasonCaptureMode =
      typeof process.env[ENV_KEY_CAPTURE_MODE] === "string"
        ? process.env[ENV_KEY_CAPTURE_MODE]
        : "";
    delete process.env[ENV_KEY_SYNC];
    delete process.env[ENV_KEY_CAPTURE_MODE];
  });

  afterEach(() => {
    if (originalMemoryMasonSyncIsSet) {
      process.env[ENV_KEY_SYNC] = originalMemoryMasonSync;
    } else {
      delete process.env[ENV_KEY_SYNC];
    }

    if (originalMemoryMasonCaptureModeIsSet) {
      process.env[ENV_KEY_CAPTURE_MODE] = originalMemoryMasonCaptureMode;
    } else {
      delete process.env[ENV_KEY_CAPTURE_MODE];
    }
  });

  it("uses project .env vault path and ignores memory-mason.json vault path", () => {
    expect(
      resolveVaultConfig(
        TEST_DEFAULT_REPO_PATH,
        '{"vaultPath":"~/ignored","subfolder":"my-brain"}',
        TEST_DEFAULT_HOME_PATH,
        { dotEnvText: "MEMORY_MASON_VAULT_PATH=~/vault\nMEMORY_MASON_SUBFOLDER=from-dotenv" },
      ),
    ).toEqual({
      vaultPath: TEST_DEFAULT_VAULT_FULL_PATH,
      subfolder: "from-dotenv",
      sync: true,
      captureMode: CAPTURE_MODE_LITE,
    });
  });

  it("uses project .env vault path when memory-mason.json is invalid", () => {
    expect(
      resolveVaultConfig(TEST_DEFAULT_REPO_PATH, "{not-json", TEST_DEFAULT_HOME_PATH, {
        dotEnvText: "MEMORY_MASON_VAULT_PATH=~/vault\nMEMORY_MASON_SUBFOLDER=from-env-file",
      }),
    ).toEqual({
      vaultPath: TEST_DEFAULT_VAULT_FULL_PATH,
      subfolder: "from-env-file",
      sync: true,
      captureMode: CAPTURE_MODE_LITE,
    });
  });

  it("uses memory-mason.json when project .env is absent", () => {
    expectProjectJsonVaultNotesConfig();
  });

  it("uses project .env vault path with default subfolder when subfolder key is missing", () => {
    expectDotEnvVaultDefaultSubfolderConfig();
  });

  it("prefers project .env over memory-mason.json when both provide vault config", () => {
    expect(
      resolveVaultConfig(
        TEST_DEFAULT_REPO_PATH,
        '{"vaultPath":"~/json-vault","subfolder":"from-config"}',
        TEST_DEFAULT_HOME_PATH,
        {
          dotEnvText: "MEMORY_MASON_VAULT_PATH=~/env-vault\nMEMORY_MASON_SUBFOLDER=from-dotenv",
        },
      ),
    ).toEqual({
      vaultPath: "/home/tester/env-vault",
      subfolder: "from-dotenv",
      sync: true,
      captureMode: CAPTURE_MODE_LITE,
    });
  });

  it("uses global .env when project .env and memory-mason.json are absent", () => {
    expectGlobalDotEnvVaultConfig();
  });

  it("uses memory-mason.json when provided and env path is absent", () => {
    expectProjectJsonVaultNotesConfig();
  });

  it("uses .env config when env path and memory-mason.json are absent", () => {
    expect(
      resolveVaultConfig(TEST_DEFAULT_REPO_PATH, "", TEST_DEFAULT_HOME_PATH, {
        dotEnvText: "MEMORY_MASON_VAULT_PATH=~/vault\nMEMORY_MASON_SUBFOLDER=notes",
      }),
    ).toEqual({
      vaultPath: TEST_DEFAULT_VAULT_FULL_PATH,
      subfolder: TEST_DEFAULT_NOTES_PATH,
      sync: true,
      captureMode: CAPTURE_MODE_LITE,
    });
  });

  it("uses .env vault path with default subfolder when subfolder key is missing", () => {
    expectDotEnvVaultDefaultSubfolderConfig();
  });

  it("uses global config when env, memory-mason.json, and .env are absent", () => {
    expect(
      resolveVaultConfig(TEST_DEFAULT_REPO_PATH, "", TEST_DEFAULT_HOME_PATH, {
        globalConfigText: '{"vaultPath":"~/global-vault","subfolder":"global-brain"}',
      }),
    ).toEqual({
      vaultPath: "/home/tester/global-vault",
      subfolder: "global-brain",
      sync: true,
      captureMode: CAPTURE_MODE_LITE,
    });
  });

  it("uses sync value from global config when provided", () => {
    expect(
      resolveVaultConfig(TEST_DEFAULT_REPO_PATH, "", TEST_DEFAULT_HOME_PATH, {
        globalConfigText: '{"vaultPath":"~/global-vault","subfolder":"global-brain","sync":false}',
      }),
    ).toEqual({
      vaultPath: "/home/tester/global-vault",
      subfolder: "global-brain",
      sync: false,
      captureMode: CAPTURE_MODE_LITE,
    });
  });

  it("ignores non-object config JSON when project .env provides vault path", () => {
    expect(
      resolveVaultConfig(TEST_DEFAULT_REPO_PATH, "[]", TEST_DEFAULT_HOME_PATH, {
        dotEnvText: "MEMORY_MASON_VAULT_PATH=~/vault",
      }),
    ).toEqual({
      vaultPath: TEST_DEFAULT_VAULT_FULL_PATH,
      subfolder: DEFAULT_SUBFOLDER,
      sync: true,
      captureMode: CAPTURE_MODE_LITE,
    });
  });

  it("uses global config when .env is present but missing vault path", () => {
    expect(
      resolveVaultConfig(TEST_DEFAULT_REPO_PATH, "", TEST_DEFAULT_HOME_PATH, {
        dotEnvText: "MEMORY_MASON_SUBFOLDER=dotenv-only-subfolder",
        globalConfigText: '{"vaultPath":"~/global-vault","subfolder":"global-brain"}',
      }),
    ).toEqual({
      vaultPath: "/home/tester/global-vault",
      subfolder: "global-brain",
      sync: true,
      captureMode: CAPTURE_MODE_LITE,
    });
  });

  it("uses global .env when env var, project config, project .env, and global JSON are absent", () => {
    expectGlobalDotEnvVaultConfig();
  });

  it("uses default subfolder when global .env has vault path but no subfolder", () => {
    expect(
      resolveVaultConfig(TEST_DEFAULT_REPO_PATH, "", TEST_DEFAULT_HOME_PATH, {
        globalDotEnvText: "MEMORY_MASON_VAULT_PATH=~/global-env-vault",
      }),
    ).toEqual({
      vaultPath: "/home/tester/global-env-vault",
      subfolder: DEFAULT_SUBFOLDER,
      sync: true,
      captureMode: CAPTURE_MODE_LITE,
    });
  });

  it("prefers global .env over global JSON", () => {
    expect(
      resolveVaultConfig(TEST_DEFAULT_REPO_PATH, "", TEST_DEFAULT_HOME_PATH, {
        globalConfigText: '{"vaultPath":"~/global-json-vault","subfolder":"json-brain"}',
        globalDotEnvText:
          "MEMORY_MASON_VAULT_PATH=~/global-env-vault\nMEMORY_MASON_SUBFOLDER=env-brain",
      }),
    ).toEqual({
      vaultPath: "/home/tester/global-env-vault",
      subfolder: "env-brain",
      sync: true,
      captureMode: CAPTURE_MODE_LITE,
    });
  });

  describe("sync field resolution", () => {
    it("defaults sync to true when not specified in env or config", () => {
      withMemoryMasonSync(null, () => {
        expect(
          resolveVaultConfig(TEST_DEFAULT_REPO_PATH, "", TEST_DEFAULT_HOME_PATH, {
            dotEnvText: "MEMORY_MASON_VAULT_PATH=~/vault",
          }),
        ).toEqual({
          vaultPath: TEST_DEFAULT_VAULT_FULL_PATH,
          subfolder: DEFAULT_SUBFOLDER,
          sync: true,
          captureMode: CAPTURE_MODE_LITE,
        });
      });
    });

    it("sets sync=false when MEMORY_MASON_SYNC=false", () => {
      withMemoryMasonSync("false", () => {
        expect(
          resolveVaultConfig(TEST_DEFAULT_REPO_PATH, "", TEST_DEFAULT_HOME_PATH, {
            dotEnvText: "MEMORY_MASON_VAULT_PATH=~/vault",
          }),
        ).toEqual({
          vaultPath: TEST_DEFAULT_VAULT_FULL_PATH,
          subfolder: DEFAULT_SUBFOLDER,
          sync: false,
          captureMode: CAPTURE_MODE_LITE,
        });
      });
    });

    it("sets sync=true when MEMORY_MASON_SYNC=true", () => {
      withMemoryMasonSync("true", () => {
        expect(
          resolveVaultConfig(TEST_DEFAULT_REPO_PATH, "", TEST_DEFAULT_HOME_PATH, {
            dotEnvText: "MEMORY_MASON_VAULT_PATH=~/vault",
          }),
        ).toEqual({
          vaultPath: TEST_DEFAULT_VAULT_FULL_PATH,
          subfolder: DEFAULT_SUBFOLDER,
          sync: true,
          captureMode: CAPTURE_MODE_LITE,
        });
      });
    });

    it("MEMORY_MASON_SYNC=false overrides config sync=true", () => {
      withMemoryMasonSync("false", () => {
        expect(
          resolveVaultConfig(
            TEST_DEFAULT_REPO_PATH,
            '{"vaultPath":"~/ignored","subfolder":"my-brain","sync":true}',
            TEST_DEFAULT_HOME_PATH,
            { dotEnvText: "MEMORY_MASON_VAULT_PATH=~/vault" },
          ),
        ).toEqual({
          vaultPath: TEST_DEFAULT_VAULT_FULL_PATH,
          subfolder: DEFAULT_SUBFOLDER,
          sync: false,
          captureMode: CAPTURE_MODE_LITE,
        });
      });
    });

    it("MEMORY_MASON_SYNC=true overrides config sync=false", () => {
      withMemoryMasonSync("true", () => {
        expect(
          resolveVaultConfig(
            TEST_DEFAULT_REPO_PATH,
            '{"vaultPath":"~/ignored","subfolder":"my-brain","sync":false}',
            TEST_DEFAULT_HOME_PATH,
            { dotEnvText: "MEMORY_MASON_VAULT_PATH=~/vault" },
          ),
        ).toEqual({
          vaultPath: TEST_DEFAULT_VAULT_FULL_PATH,
          subfolder: DEFAULT_SUBFOLDER,
          sync: true,
          captureMode: CAPTURE_MODE_LITE,
        });
      });
    });

    it("throws on invalid MEMORY_MASON_SYNC value", () => {
      withMemoryMasonSync("invalid", () => {
        expect(() =>
          resolveVaultConfig(TEST_DEFAULT_REPO_PATH, "", TEST_DEFAULT_HOME_PATH, {
            dotEnvText: "MEMORY_MASON_VAULT_PATH=~/vault",
          }),
        ).toThrow("MEMORY_MASON_SYNC must be 'true' or 'false', got: invalid");
      });
    });

    it("sets sync=false from config JSON sync:false", () => {
      withMemoryMasonSync(null, () => {
        expect(
          resolveVaultConfig(
            TEST_DEFAULT_REPO_PATH,
            `{"vaultPath":"~/vault","subfolder":"${TEST_DEFAULT_NOTES_PATH}","sync":false}`,
            TEST_DEFAULT_HOME_PATH,
          ),
        ).toEqual({
          vaultPath: TEST_DEFAULT_VAULT_FULL_PATH,
          subfolder: TEST_DEFAULT_NOTES_PATH,
          sync: false,
          captureMode: CAPTURE_MODE_LITE,
        });
      });
    });

    it("sets sync=true from config JSON sync:true", () => {
      withMemoryMasonSync(null, () => {
        expect(
          resolveVaultConfig(
            TEST_DEFAULT_REPO_PATH,
            `{"vaultPath":"~/vault","subfolder":"${TEST_DEFAULT_NOTES_PATH}","sync":true}`,
            TEST_DEFAULT_HOME_PATH,
          ),
        ).toEqual({
          vaultPath: TEST_DEFAULT_VAULT_FULL_PATH,
          subfolder: TEST_DEFAULT_NOTES_PATH,
          sync: true,
          captureMode: CAPTURE_MODE_LITE,
        });
      });
    });

    it('throws on non-boolean config sync field (e.g. string "false")', () => {
      withMemoryMasonSync(null, () => {
        expect(() =>
          resolveVaultConfig(
            TEST_DEFAULT_REPO_PATH,
            `{"vaultPath":"~/vault","subfolder":"${TEST_DEFAULT_NOTES_PATH}","sync":"false"}`,
            TEST_DEFAULT_HOME_PATH,
          ),
        ).toThrow("config sync must be a boolean, got: string");
      });
    });

    it("sets sync=false from process env while vaultPath comes from project .env", () => {
      withMemoryMasonSync("false", () => {
        expect(
          resolveVaultConfig(
            TEST_DEFAULT_REPO_PATH,
            '{"vaultPath":"~/config-vault","subfolder":"config-subfolder","sync":true}',
            TEST_DEFAULT_HOME_PATH,
            { dotEnvText: "MEMORY_MASON_VAULT_PATH=~/env-vault" },
          ),
        ).toEqual({
          vaultPath: "/home/tester/env-vault",
          subfolder: DEFAULT_SUBFOLDER,
          sync: false,
          captureMode: CAPTURE_MODE_LITE,
        });
      });
    });

    it("project .env vault path wins over memory-mason.json vault path", () => {
      withMemoryMasonSync(null, () => {
        expect(
          resolveVaultConfig(
            TEST_DEFAULT_REPO_PATH,
            '{"vaultPath":"~/json-vault","subfolder":"json-sub"}',
            TEST_DEFAULT_HOME_PATH,
            { dotEnvText: "MEMORY_MASON_VAULT_PATH=~/env-vault\nMEMORY_MASON_SUBFOLDER=env-sub" },
          ),
        ).toEqual({
          vaultPath: "/home/tester/env-vault",
          subfolder: "env-sub",
          sync: true,
          captureMode: CAPTURE_MODE_LITE,
        });
      });
    });

    it("sets sync=false from project .env MEMORY_MASON_SYNC", () => {
      withMemoryMasonSync(null, () => {
        expect(
          resolveVaultConfig(TEST_DEFAULT_REPO_PATH, "", TEST_DEFAULT_HOME_PATH, {
            dotEnvText: "MEMORY_MASON_VAULT_PATH=~/vault\nMEMORY_MASON_SYNC=false",
          }),
        ).toEqual({
          vaultPath: TEST_DEFAULT_VAULT_FULL_PATH,
          subfolder: DEFAULT_SUBFOLDER,
          sync: false,
          captureMode: CAPTURE_MODE_LITE,
        });
      });
    });

    it("project .env MEMORY_MASON_SYNC overrides JSON sync:true", () => {
      withMemoryMasonSync(null, () => {
        expect(
          resolveVaultConfig(
            TEST_DEFAULT_REPO_PATH,
            `{"vaultPath":"~/vault","subfolder":"${TEST_DEFAULT_NOTES_PATH}","sync":true}`,
            TEST_DEFAULT_HOME_PATH,
            { dotEnvText: "MEMORY_MASON_SYNC=false" },
          ),
        ).toEqual({
          vaultPath: TEST_DEFAULT_VAULT_FULL_PATH,
          subfolder: TEST_DEFAULT_NOTES_PATH,
          sync: false,
          captureMode: CAPTURE_MODE_LITE,
        });
      });
    });

    it("sets sync=false from global .env MEMORY_MASON_SYNC", () => {
      withMemoryMasonSync(null, () => {
        expect(
          resolveVaultConfig(TEST_DEFAULT_REPO_PATH, "", TEST_DEFAULT_HOME_PATH, {
            globalDotEnvText: "MEMORY_MASON_VAULT_PATH=~/global-vault\nMEMORY_MASON_SYNC=false",
          }),
        ).toEqual({
          vaultPath: "/home/tester/global-vault",
          subfolder: DEFAULT_SUBFOLDER,
          sync: false,
          captureMode: CAPTURE_MODE_LITE,
        });
      });
    });

    it("project .env MEMORY_MASON_SYNC overrides global .env MEMORY_MASON_SYNC", () => {
      withMemoryMasonSync(null, () => {
        expect(
          resolveVaultConfig(TEST_DEFAULT_REPO_PATH, "", TEST_DEFAULT_HOME_PATH, {
            globalDotEnvText: "MEMORY_MASON_VAULT_PATH=~/global-vault\nMEMORY_MASON_SYNC=false",
            dotEnvText: "MEMORY_MASON_SYNC=true",
          }),
        ).toEqual({
          vaultPath: "/home/tester/global-vault",
          subfolder: DEFAULT_SUBFOLDER,
          sync: true,
          captureMode: CAPTURE_MODE_LITE,
        });
      });
    });

    it("process env MEMORY_MASON_SYNC overrides project .env MEMORY_MASON_SYNC", () => {
      withMemoryMasonSync("false", () => {
        expect(
          resolveVaultConfig(TEST_DEFAULT_REPO_PATH, "", TEST_DEFAULT_HOME_PATH, {
            dotEnvText: "MEMORY_MASON_VAULT_PATH=~/vault\nMEMORY_MASON_SYNC=true",
          }),
        ).toEqual({
          vaultPath: TEST_DEFAULT_VAULT_FULL_PATH,
          subfolder: DEFAULT_SUBFOLDER,
          sync: false,
          captureMode: CAPTURE_MODE_LITE,
        });
      });
    });
  });

  describe("captureMode resolution", () => {
    it("defaults to lite", () => {
      expect(
        resolveVaultConfig(TEST_DEFAULT_REPO_PATH, "", TEST_DEFAULT_HOME_PATH, {
          dotEnvText: "MEMORY_MASON_VAULT_PATH=~/vault",
        }),
      ).toEqual({
        vaultPath: TEST_DEFAULT_VAULT_FULL_PATH,
        subfolder: DEFAULT_SUBFOLDER,
        sync: true,
        captureMode: CAPTURE_MODE_LITE,
      });
    });

    it("resolves lite from project JSON", () => {
      expect(
        resolveVaultConfig(
          TEST_DEFAULT_REPO_PATH,
          `{"vaultPath":"~/vault","subfolder":"${TEST_DEFAULT_NOTES_PATH}","captureMode":"${CAPTURE_MODE_LITE}"}`,
          TEST_DEFAULT_HOME_PATH,
        ),
      ).toEqual({
        vaultPath: TEST_DEFAULT_VAULT_FULL_PATH,
        subfolder: TEST_DEFAULT_NOTES_PATH,
        sync: true,
        captureMode: CAPTURE_MODE_LITE,
      });
    });

    it("resolves full from project JSON", () => {
      expect(
        resolveVaultConfig(
          TEST_DEFAULT_REPO_PATH,
          `{"vaultPath":"~/vault","subfolder":"${TEST_DEFAULT_NOTES_PATH}","captureMode":"${CAPTURE_MODE_FULL}"}`,
          TEST_DEFAULT_HOME_PATH,
        ),
      ).toEqual({
        vaultPath: TEST_DEFAULT_VAULT_FULL_PATH,
        subfolder: TEST_DEFAULT_NOTES_PATH,
        sync: true,
        captureMode: CAPTURE_MODE_FULL,
      });
    });

    it("env MEMORY_MASON_CAPTURE_MODE=full overrides project JSON lite", () => {
      withMemoryMasonCaptureMode(CAPTURE_MODE_FULL, () => {
        expect(
          resolveVaultConfig(
            TEST_DEFAULT_REPO_PATH,
            `{"vaultPath":"~/vault","subfolder":"${TEST_DEFAULT_NOTES_PATH}","captureMode":"${CAPTURE_MODE_LITE}"}`,
            TEST_DEFAULT_HOME_PATH,
          ),
        ).toEqual({
          vaultPath: TEST_DEFAULT_VAULT_FULL_PATH,
          subfolder: TEST_DEFAULT_NOTES_PATH,
          sync: true,
          captureMode: CAPTURE_MODE_FULL,
        });
      });
    });

    it("env MEMORY_MASON_CAPTURE_MODE=lite overrides project JSON full", () => {
      withMemoryMasonCaptureMode(CAPTURE_MODE_LITE, () => {
        expect(
          resolveVaultConfig(
            TEST_DEFAULT_REPO_PATH,
            `{"vaultPath":"~/vault","subfolder":"${TEST_DEFAULT_NOTES_PATH}","captureMode":"${CAPTURE_MODE_FULL}"}`,
            TEST_DEFAULT_HOME_PATH,
          ),
        ).toEqual({
          vaultPath: TEST_DEFAULT_VAULT_FULL_PATH,
          subfolder: TEST_DEFAULT_NOTES_PATH,
          sync: true,
          captureMode: CAPTURE_MODE_LITE,
        });
      });
    });

    it("throws on invalid env value", () => {
      withMemoryMasonCaptureMode("verbose", () => {
        expect(() =>
          resolveVaultConfig(TEST_DEFAULT_REPO_PATH, "", TEST_DEFAULT_HOME_PATH, {
            dotEnvText: "MEMORY_MASON_VAULT_PATH=~/vault",
          }),
        ).toThrow("MEMORY_MASON_CAPTURE_MODE must be 'lite' or 'full', got: verbose");
      });
    });

    it("throws on invalid project JSON captureMode string", () => {
      expect(() =>
        resolveVaultConfig(
          TEST_DEFAULT_REPO_PATH,
          `{"vaultPath":"~/vault","subfolder":"${TEST_DEFAULT_NOTES_PATH}","captureMode":"verbose"}`,
          TEST_DEFAULT_HOME_PATH,
        ),
      ).toThrow("config captureMode must be 'lite' or 'full', got: verbose");
    });

    it("throws on invalid project JSON captureMode type", () => {
      expect(() =>
        resolveVaultConfig(
          TEST_DEFAULT_REPO_PATH,
          `{"vaultPath":"~/vault","subfolder":"${TEST_DEFAULT_NOTES_PATH}","captureMode":1}`,
          TEST_DEFAULT_HOME_PATH,
        ),
      ).toThrow("config captureMode must be 'lite' or 'full', got: number");
    });

    it("resolves captureMode from project .env", () => {
      expect(
        resolveVaultConfig(TEST_DEFAULT_REPO_PATH, "", TEST_DEFAULT_HOME_PATH, {
          dotEnvText:
            "MEMORY_MASON_VAULT_PATH=~/vault\nMEMORY_MASON_SUBFOLDER=notes\nMEMORY_MASON_CAPTURE_MODE=full",
        }),
      ).toEqual({
        vaultPath: TEST_DEFAULT_VAULT_FULL_PATH,
        subfolder: TEST_DEFAULT_NOTES_PATH,
        sync: true,
        captureMode: CAPTURE_MODE_FULL,
      });
    });

    it("resolves captureMode from global .env", () => {
      expect(
        resolveVaultConfig(TEST_DEFAULT_REPO_PATH, "", TEST_DEFAULT_HOME_PATH, {
          globalDotEnvText:
            "MEMORY_MASON_VAULT_PATH=~/global-vault\nMEMORY_MASON_SUBFOLDER=global-brain\nMEMORY_MASON_CAPTURE_MODE=full",
        }),
      ).toEqual({
        vaultPath: "/home/tester/global-vault",
        subfolder: "global-brain",
        sync: true,
        captureMode: CAPTURE_MODE_FULL,
      });
    });

    it("resolves captureMode from global config", () => {
      expect(
        resolveVaultConfig(TEST_DEFAULT_REPO_PATH, "", TEST_DEFAULT_HOME_PATH, {
          globalConfigText: `{"vaultPath":"~/global-vault","subfolder":"global-brain","captureMode":"${CAPTURE_MODE_FULL}"}`,
        }),
      ).toEqual({
        vaultPath: "/home/tester/global-vault",
        subfolder: "global-brain",
        sync: true,
        captureMode: CAPTURE_MODE_FULL,
      });
    });

    it("project .env captureMode overrides global config captureMode", () => {
      expect(
        resolveVaultConfig(TEST_DEFAULT_REPO_PATH, "", TEST_DEFAULT_HOME_PATH, {
          dotEnvText:
            "MEMORY_MASON_VAULT_PATH=~/vault\nMEMORY_MASON_SUBFOLDER=notes\nMEMORY_MASON_CAPTURE_MODE=lite",
          globalConfigText: `{"vaultPath":"~/global-vault","subfolder":"global-brain","captureMode":"${CAPTURE_MODE_FULL}"}`,
        }),
      ).toEqual({
        vaultPath: TEST_DEFAULT_VAULT_FULL_PATH,
        subfolder: TEST_DEFAULT_NOTES_PATH,
        sync: true,
        captureMode: CAPTURE_MODE_LITE,
      });
    });

    it("throws on invalid project .env captureMode", () => {
      expect(() =>
        resolveVaultConfig(TEST_DEFAULT_REPO_PATH, "", TEST_DEFAULT_HOME_PATH, {
          dotEnvText:
            "MEMORY_MASON_VAULT_PATH=~/vault\nMEMORY_MASON_SUBFOLDER=notes\nMEMORY_MASON_CAPTURE_MODE=verbose",
        }),
      ).toThrow("MEMORY_MASON_CAPTURE_MODE must be 'lite' or 'full', got: verbose");
    });

    it("env captureMode overrides project .env captureMode", () => {
      withMemoryMasonCaptureMode(CAPTURE_MODE_FULL, () => {
        expect(
          resolveVaultConfig(TEST_DEFAULT_REPO_PATH, "", TEST_DEFAULT_HOME_PATH, {
            dotEnvText:
              "MEMORY_MASON_VAULT_PATH=~/vault\nMEMORY_MASON_SUBFOLDER=notes\nMEMORY_MASON_CAPTURE_MODE=lite",
          }),
        ).toEqual({
          vaultPath: TEST_DEFAULT_VAULT_FULL_PATH,
          subfolder: TEST_DEFAULT_NOTES_PATH,
          sync: true,
          captureMode: CAPTURE_MODE_FULL,
        });
      });
    });
  });

  it("fails fast when neither config source is provided", () => {
    expect(() => resolveVaultConfig(TEST_DEFAULT_REPO_PATH, "", TEST_DEFAULT_HOME_PATH)).toThrow(
      "Memory Mason config not found. Checked project .env, project memory-mason.json, ~/.memory-mason/.env, and ~/.memory-mason/config.json.",
    );
  });

  it("fails when MEMORY_MASON_VAULT_PATH exists only in process env", () => {
    const hadVaultPath = Object.hasOwn(process.env, ENV_KEY_VAULT_PATH);
    const previousVaultPath = process.env[ENV_KEY_VAULT_PATH];
    process.env[ENV_KEY_VAULT_PATH] = "~/process-only-vault";

    try {
      expect(() => resolveVaultConfig(TEST_DEFAULT_REPO_PATH, "", TEST_DEFAULT_HOME_PATH)).toThrow(
        "Memory Mason config not found. Checked project .env, project memory-mason.json, ~/.memory-mason/.env, and ~/.memory-mason/config.json.",
      );
    } finally {
      if (hadVaultPath && typeof previousVaultPath === "string") {
        process.env[ENV_KEY_VAULT_PATH] = previousVaultPath;
      } else {
        delete process.env[ENV_KEY_VAULT_PATH];
      }
    }
  });

  it("throws when cwd is empty and no config source exists", () => {
    expect(() => resolveVaultConfig("", "", TEST_DEFAULT_HOME_PATH)).toThrow(
      "cwd must be a non-empty string",
    );
  });

  it("treats non-string env and config inputs as absent", () => {
    expect(() =>
      resolveVaultConfig(TEST_DEFAULT_REPO_PATH, null, TEST_DEFAULT_HOME_PATH, null),
    ).toThrow(
      "Memory Mason config not found. Checked project .env, project memory-mason.json, ~/.memory-mason/.env, and ~/.memory-mason/config.json.",
    );
  });
});
