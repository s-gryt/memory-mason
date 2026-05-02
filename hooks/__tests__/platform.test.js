"use strict";

const {
  detectPlatform,
  parseJsonInput,
  expandHomePath,
  parseMemoryMasonConfig,
  parseDotEnv,
  resolveVaultConfig,
} = require("../lib/config");

describe("detectPlatform", () => {
  it("returns copilot-vscode for hookEventName payloads", () => {
    expect(detectPlatform({ hookEventName: "session-start" })).toBe("copilot-vscode");
  });

  it("returns codex for hook_event_name + turn_id payloads", () => {
    expect(detectPlatform({ hook_event_name: "session_start", turn_id: "turn-123" })).toBe("codex");
  });

  it("returns claude-code for hook_event_name without turn_id", () => {
    expect(detectPlatform({ hook_event_name: "session_start" })).toBe("claude-code");
  });

  it("returns copilot-cli for timestamp-only payloads", () => {
    expect(detectPlatform({ timestamp: "2026-04-26T14:30:00.000Z" })).toBe("copilot-cli");
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
    expect(parseJsonInput('{"vaultPath":"/vault","subfolder":"ai-knowledge"}')).toEqual({
      vaultPath: "/vault",
      subfolder: "ai-knowledge",
    });
  });

  it("throws on empty string", () => {
    expect(() => parseJsonInput("")).toThrow("stdin must be a non-empty string");
  });

  it("throws on non-string input (number)", () => {
    expect(() => parseJsonInput(123)).toThrow("stdin must be a non-empty string");
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
    const raw = String.raw`{"vaultPath":"C:\Users\alice\vault","subfolder":"ai-knowledge"}`;

    expect(parseJsonInput(raw)).toEqual({
      vaultPath: "C:\\Users\\alice\\vault",
      subfolder: "ai-knowledge",
    });
  });

  it("throws when escaped recovery produces an array instead of object", () => {
    const raw = String.raw`["C:\Users\alice"]`;

    expect(() => parseJsonInput(raw)).toThrow("invalid JSON in stdin:");
  });
});

describe("expandHomePath", () => {
  it("expands ~/path to homedir/path", () => {
    expect(expandHomePath("~/notes", "/home/tester")).toBe("/home/tester/notes");
  });

  it("expands ~/ to homedir/", () => {
    expect(expandHomePath("~/", "/home/tester")).toBe("/home/tester/");
  });

  it("does not expand paths without leading tilde", () => {
    expect(expandHomePath("/tmp/file", "/home/tester")).toBe("/tmp/file");
  });

  it("does not expand ~word (no slash)", () => {
    expect(expandHomePath("~file", "/home/tester")).toBe("~file");
  });

  it("throws if inputPath is empty", () => {
    expect(() => expandHomePath("", "/home/tester")).toThrow(
      "inputPath must be a non-empty string",
    );
  });

  it("throws if homedir is empty", () => {
    expect(() => expandHomePath("~/notes", "")).toThrow("homedir must be a non-empty string");
  });
});

describe("parseMemoryMasonConfig", () => {
  it("parses a valid memory-mason config object", () => {
    expect(parseMemoryMasonConfig('{"vaultPath":"~/vault","subfolder":"ai-knowledge"}')).toEqual({
      vaultPath: "~/vault",
      subfolder: "ai-knowledge",
    });
  });

  it("throws on invalid config JSON", () => {
    expect(() => parseMemoryMasonConfig("{not-json")).toThrow("invalid memory-mason config JSON");
  });

  it("throws when sync is null", () => {
    expect(() =>
      parseMemoryMasonConfig('{"vaultPath":"~/vault","subfolder":"ai-knowledge","sync":null}'),
    ).toThrow("config sync must be a boolean, got: null");
  });

  it("throws when sync is an array", () => {
    expect(() =>
      parseMemoryMasonConfig('{"vaultPath":"~/vault","subfolder":"ai-knowledge","sync":[]}'),
    ).toThrow("config sync must be a boolean, got: array");
  });

  it("throws when config is not an object", () => {
    expect(() => parseMemoryMasonConfig("[]")).toThrow("memory-mason config must be an object");
  });

  it("throws when vaultPath is missing", () => {
    expect(() => parseMemoryMasonConfig('{"subfolder":"ai-knowledge"}')).toThrow(
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

describe("resolveVaultConfig", () => {
  let originalMemoryMasonSyncIsSet = false;
  let originalMemoryMasonSync = "";

  const withMemoryMasonSync = (value, callback) => {
    const hadSync = Object.hasOwn(process.env, "MEMORY_MASON_SYNC");
    const previousSync = process.env.MEMORY_MASON_SYNC;

    if (typeof value === "string") {
      process.env.MEMORY_MASON_SYNC = value;
    } else {
      delete process.env.MEMORY_MASON_SYNC;
    }

    try {
      return callback();
    } finally {
      if (hadSync && typeof previousSync === "string") {
        process.env.MEMORY_MASON_SYNC = previousSync;
      } else {
        delete process.env.MEMORY_MASON_SYNC;
      }
    }
  };

  beforeEach(() => {
    originalMemoryMasonSyncIsSet = Object.hasOwn(process.env, "MEMORY_MASON_SYNC");
    originalMemoryMasonSync =
      typeof process.env.MEMORY_MASON_SYNC === "string" ? process.env.MEMORY_MASON_SYNC : "";
    delete process.env.MEMORY_MASON_SYNC;
  });

  afterEach(() => {
    if (originalMemoryMasonSyncIsSet) {
      process.env.MEMORY_MASON_SYNC = originalMemoryMasonSync;
    } else {
      delete process.env.MEMORY_MASON_SYNC;
    }
  });

  it("uses MEMORY_MASON_VAULT_PATH and config subfolder when env path is set", () => {
    expect(
      resolveVaultConfig(
        "/repo",
        "~/vault",
        '{"vaultPath":"~/ignored","subfolder":"my-brain"}',
        "/home/tester",
      ),
    ).toEqual({
      vaultPath: "/home/tester/vault",
      subfolder: "my-brain",
      sync: true,
    });
  });

  it("falls back to dotEnv subfolder when env path is set and config text is invalid", () => {
    expect(
      resolveVaultConfig("/repo", "~/vault", "{not-json", "/home/tester", {
        dotEnvText: "MEMORY_MASON_SUBFOLDER=from-env-file",
      }),
    ).toEqual({
      vaultPath: "/home/tester/vault",
      subfolder: "from-env-file",
      sync: true,
    });
  });

  it("falls back to ai-knowledge when env path is set and config text is invalid with no dotEnv subfolder", () => {
    expect(resolveVaultConfig("/repo", "~/vault", "{not-json", "/home/tester")).toEqual({
      vaultPath: "/home/tester/vault",
      subfolder: "ai-knowledge",
      sync: true,
    });
  });

  it("uses dotEnv subfolder when env path is set and config text is absent", () => {
    expect(
      resolveVaultConfig("/repo", "~/vault", "", "/home/tester", {
        dotEnvText: "MEMORY_MASON_SUBFOLDER=from-dotenv",
      }),
    ).toEqual({
      vaultPath: "/home/tester/vault",
      subfolder: "from-dotenv",
      sync: true,
    });
  });

  it("uses ai-knowledge when env path is set and no subfolder sources exist", () => {
    expect(resolveVaultConfig("/repo", "~/vault", "", "/home/tester")).toEqual({
      vaultPath: "/home/tester/vault",
      subfolder: "ai-knowledge",
      sync: true,
    });
  });

  it("uses memory-mason.json when provided and env path is absent", () => {
    expect(
      resolveVaultConfig(
        "/repo",
        "",
        '{"vaultPath":"~/vault","subfolder":"notes"}',
        "/home/tester",
      ),
    ).toEqual({
      vaultPath: "/home/tester/vault",
      subfolder: "notes",
      sync: true,
    });
  });

  it("uses .env config when env path and memory-mason.json are absent", () => {
    expect(
      resolveVaultConfig("/repo", "", "", "/home/tester", {
        dotEnvText: "MEMORY_MASON_VAULT_PATH=~/vault\nMEMORY_MASON_SUBFOLDER=notes",
      }),
    ).toEqual({
      vaultPath: "/home/tester/vault",
      subfolder: "notes",
      sync: true,
    });
  });

  it("uses .env vault path with default subfolder when subfolder key is missing", () => {
    expect(
      resolveVaultConfig("/repo", "", "", "/home/tester", {
        dotEnvText: "MEMORY_MASON_VAULT_PATH=~/vault",
      }),
    ).toEqual({
      vaultPath: "/home/tester/vault",
      subfolder: "ai-knowledge",
      sync: true,
    });
  });

  it("uses global config when env, memory-mason.json, and .env are absent", () => {
    expect(
      resolveVaultConfig("/repo", "", "", "/home/tester", {
        globalConfigText: '{"vaultPath":"~/global-vault","subfolder":"global-brain"}',
      }),
    ).toEqual({
      vaultPath: "/home/tester/global-vault",
      subfolder: "global-brain",
      sync: true,
    });
  });

  it("uses sync value from global config when provided", () => {
    expect(
      resolveVaultConfig("/repo", "", "", "/home/tester", {
        globalConfigText: '{"vaultPath":"~/global-vault","subfolder":"global-brain","sync":false}',
      }),
    ).toEqual({
      vaultPath: "/home/tester/global-vault",
      subfolder: "global-brain",
      sync: false,
    });
  });

  it("ignores non-object config JSON when env path is set", () => {
    expect(resolveVaultConfig("/repo", "~/vault", "[]", "/home/tester")).toEqual({
      vaultPath: "/home/tester/vault",
      subfolder: "ai-knowledge",
      sync: true,
    });
  });

  it("uses global config when .env is present but missing vault path", () => {
    expect(
      resolveVaultConfig("/repo", "", "", "/home/tester", {
        dotEnvText: "MEMORY_MASON_SUBFOLDER=dotenv-only-subfolder",
        globalConfigText: '{"vaultPath":"~/global-vault","subfolder":"global-brain"}',
      }),
    ).toEqual({
      vaultPath: "/home/tester/global-vault",
      subfolder: "global-brain",
      sync: true,
    });
  });

  it("uses global .env when env var, project config, project .env, and global JSON are absent", () => {
    expect(
      resolveVaultConfig("/repo", "", "", "/home/tester", {
        globalDotEnvText:
          "MEMORY_MASON_VAULT_PATH=~/global-env-vault\nMEMORY_MASON_SUBFOLDER=global-env-brain",
      }),
    ).toEqual({
      vaultPath: "/home/tester/global-env-vault",
      subfolder: "global-env-brain",
      sync: true,
    });
  });

  it("uses default subfolder when global .env has vault path but no subfolder", () => {
    expect(
      resolveVaultConfig("/repo", "", "", "/home/tester", {
        globalDotEnvText: "MEMORY_MASON_VAULT_PATH=~/global-env-vault",
      }),
    ).toEqual({
      vaultPath: "/home/tester/global-env-vault",
      subfolder: "ai-knowledge",
      sync: true,
    });
  });

  it("prefers global .env over global JSON", () => {
    expect(
      resolveVaultConfig("/repo", "", "", "/home/tester", {
        globalConfigText: '{"vaultPath":"~/global-json-vault","subfolder":"json-brain"}',
        globalDotEnvText:
          "MEMORY_MASON_VAULT_PATH=~/global-env-vault\nMEMORY_MASON_SUBFOLDER=env-brain",
      }),
    ).toEqual({
      vaultPath: "/home/tester/global-env-vault",
      subfolder: "env-brain",
      sync: true,
    });
  });

  describe("sync field resolution", () => {
    it("defaults sync to true when not specified in env or config", () => {
      withMemoryMasonSync(null, () => {
        expect(resolveVaultConfig("/repo", "~/vault", "", "/home/tester")).toEqual({
          vaultPath: "/home/tester/vault",
          subfolder: "ai-knowledge",
          sync: true,
        });
      });
    });

    it("sets sync=false when MEMORY_MASON_SYNC=false", () => {
      withMemoryMasonSync("false", () => {
        expect(resolveVaultConfig("/repo", "~/vault", "", "/home/tester")).toEqual({
          vaultPath: "/home/tester/vault",
          subfolder: "ai-knowledge",
          sync: false,
        });
      });
    });

    it("sets sync=true when MEMORY_MASON_SYNC=true", () => {
      withMemoryMasonSync("true", () => {
        expect(resolveVaultConfig("/repo", "~/vault", "", "/home/tester")).toEqual({
          vaultPath: "/home/tester/vault",
          subfolder: "ai-knowledge",
          sync: true,
        });
      });
    });

    it("MEMORY_MASON_SYNC=false overrides config sync=true", () => {
      withMemoryMasonSync("false", () => {
        expect(
          resolveVaultConfig(
            "/repo",
            "~/vault",
            '{"vaultPath":"~/ignored","subfolder":"my-brain","sync":true}',
            "/home/tester",
          ),
        ).toEqual({
          vaultPath: "/home/tester/vault",
          subfolder: "my-brain",
          sync: false,
        });
      });
    });

    it("MEMORY_MASON_SYNC=true overrides config sync=false", () => {
      withMemoryMasonSync("true", () => {
        expect(
          resolveVaultConfig(
            "/repo",
            "~/vault",
            '{"vaultPath":"~/ignored","subfolder":"my-brain","sync":false}',
            "/home/tester",
          ),
        ).toEqual({
          vaultPath: "/home/tester/vault",
          subfolder: "my-brain",
          sync: true,
        });
      });
    });

    it("throws on invalid MEMORY_MASON_SYNC value", () => {
      withMemoryMasonSync("invalid", () => {
        expect(() => resolveVaultConfig("/repo", "~/vault", "", "/home/tester")).toThrow(
          "MEMORY_MASON_SYNC must be 'true' or 'false', got: invalid",
        );
      });
    });

    it("sets sync=false from config JSON sync:false", () => {
      withMemoryMasonSync(null, () => {
        expect(
          resolveVaultConfig(
            "/repo",
            "",
            '{"vaultPath":"~/vault","subfolder":"notes","sync":false}',
            "/home/tester",
          ),
        ).toEqual({
          vaultPath: "/home/tester/vault",
          subfolder: "notes",
          sync: false,
        });
      });
    });

    it("sets sync=true from config JSON sync:true", () => {
      withMemoryMasonSync(null, () => {
        expect(
          resolveVaultConfig(
            "/repo",
            "",
            '{"vaultPath":"~/vault","subfolder":"notes","sync":true}',
            "/home/tester",
          ),
        ).toEqual({
          vaultPath: "/home/tester/vault",
          subfolder: "notes",
          sync: true,
        });
      });
    });

    it('throws on non-boolean config sync field (e.g. string "false")', () => {
      withMemoryMasonSync(null, () => {
        expect(() =>
          resolveVaultConfig(
            "/repo",
            "",
            '{"vaultPath":"~/vault","subfolder":"notes","sync":"false"}',
            "/home/tester",
          ),
        ).toThrow("config sync must be a boolean, got: string");
      });
    });

    it("sets sync=false from env while vaultPath still comes from MEMORY_MASON_VAULT_PATH", () => {
      withMemoryMasonSync("false", () => {
        expect(
          resolveVaultConfig(
            "/repo",
            "~/env-vault",
            '{"vaultPath":"~/config-vault","subfolder":"config-subfolder","sync":true}',
            "/home/tester",
          ),
        ).toEqual({
          vaultPath: "/home/tester/env-vault",
          subfolder: "config-subfolder",
          sync: false,
        });
      });
    });

    it("project .env vault path wins over memory-mason.json vault path", () => {
      withMemoryMasonSync(null, () => {
        expect(
          resolveVaultConfig(
            "/repo",
            "",
            '{"vaultPath":"~/json-vault","subfolder":"json-sub"}',
            "/home/tester",
            { dotEnvText: "MEMORY_MASON_VAULT_PATH=~/env-vault\nMEMORY_MASON_SUBFOLDER=env-sub" },
          ),
        ).toEqual({
          vaultPath: "/home/tester/env-vault",
          subfolder: "env-sub",
          sync: true,
        });
      });
    });

    it("sets sync=false from project .env MEMORY_MASON_SYNC", () => {
      withMemoryMasonSync(null, () => {
        expect(
          resolveVaultConfig("/repo", "", "", "/home/tester", {
            dotEnvText: "MEMORY_MASON_VAULT_PATH=~/vault\nMEMORY_MASON_SYNC=false",
          }),
        ).toEqual({
          vaultPath: "/home/tester/vault",
          subfolder: "ai-knowledge",
          sync: false,
        });
      });
    });

    it("project .env MEMORY_MASON_SYNC overrides JSON sync:true", () => {
      withMemoryMasonSync(null, () => {
        expect(
          resolveVaultConfig(
            "/repo",
            "",
            '{"vaultPath":"~/vault","subfolder":"notes","sync":true}',
            "/home/tester",
            { dotEnvText: "MEMORY_MASON_SYNC=false" },
          ),
        ).toEqual({
          vaultPath: "/home/tester/vault",
          subfolder: "notes",
          sync: false,
        });
      });
    });

    it("sets sync=false from global .env MEMORY_MASON_SYNC", () => {
      withMemoryMasonSync(null, () => {
        expect(
          resolveVaultConfig("/repo", "", "", "/home/tester", {
            globalDotEnvText: "MEMORY_MASON_VAULT_PATH=~/global-vault\nMEMORY_MASON_SYNC=false",
          }),
        ).toEqual({
          vaultPath: "/home/tester/global-vault",
          subfolder: "ai-knowledge",
          sync: false,
        });
      });
    });

    it("project .env MEMORY_MASON_SYNC overrides global .env MEMORY_MASON_SYNC", () => {
      withMemoryMasonSync(null, () => {
        expect(
          resolveVaultConfig("/repo", "", "", "/home/tester", {
            globalDotEnvText: "MEMORY_MASON_VAULT_PATH=~/global-vault\nMEMORY_MASON_SYNC=false",
            dotEnvText: "MEMORY_MASON_SYNC=true",
          }),
        ).toEqual({
          vaultPath: "/home/tester/global-vault",
          subfolder: "ai-knowledge",
          sync: true,
        });
      });
    });

    it("process env MEMORY_MASON_SYNC overrides project .env MEMORY_MASON_SYNC", () => {
      withMemoryMasonSync("false", () => {
        expect(
          resolveVaultConfig("/repo", "", "", "/home/tester", {
            dotEnvText: "MEMORY_MASON_VAULT_PATH=~/vault\nMEMORY_MASON_SYNC=true",
          }),
        ).toEqual({
          vaultPath: "/home/tester/vault",
          subfolder: "ai-knowledge",
          sync: false,
        });
      });
    });
  });

  it("fails fast when neither config source is provided", () => {
    expect(() => resolveVaultConfig("/repo", "", "", "/home/tester")).toThrow(
      "Memory Mason config not found. Checked MEMORY_MASON_VAULT_PATH, project .env, project memory-mason.json, ~/.memory-mason/.env, and ~/.memory-mason/config.json.",
    );
  });

  it("throws when cwd is empty and no config source exists", () => {
    expect(() => resolveVaultConfig("", "", "", "/home/tester")).toThrow(
      "cwd must be a non-empty string",
    );
  });

  it("treats non-string env and config inputs as absent", () => {
    expect(() => resolveVaultConfig("/repo", null, null, "/home/tester", null)).toThrow(
      "Memory Mason config not found. Checked MEMORY_MASON_VAULT_PATH, project .env, project memory-mason.json, ~/.memory-mason/.env, and ~/.memory-mason/config.json.",
    );
  });
});
