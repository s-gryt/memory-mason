"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildDailyChunkPath, buildDailyFilePath } = require("../lib/vault");
const { resolveCaptureStatePath } = require("../lib/capture-state");
const postToolUse = require("../post-tool-use");
const hooksRoot = path.resolve(__dirname, "..");

const tempDirs = [];

const createTempDir = (prefix) => {
  const dirPath = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dirPath);
  return dirPath;
};

const buildEnv = (homeDir, overrides = {}) => ({
  ...process.env,
  PATH: "",
  Path: "",
  HOME: homeDir,
  USERPROFILE: homeDir,
  ...overrides,
});

const writeText = (filePath, content) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
};

const today = () => {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

const runScript = (scriptNameOrOptions, maybeOptions = {}) => {
  let options = {};
  if (typeof scriptNameOrOptions === "string") {
    options = maybeOptions;
  } else if (scriptNameOrOptions !== null && typeof scriptNameOrOptions === "object") {
    options = scriptNameOrOptions;
  }

  let stdinText = "";
  if (typeof options.stdinText === "string") {
    stdinText = options.stdinText;
  } else if (typeof options.payload !== "undefined") {
    stdinText = JSON.stringify(options.payload);
  }
  const env = typeof options.env === "object" && options.env !== null ? options.env : process.env;
  const homedir =
    typeof env.USERPROFILE === "string" && env.USERPROFILE !== "" ? env.USERPROFILE : os.homedir();
  const extraRuntime =
    typeof options.runtime === "object" && options.runtime !== null ? options.runtime : {};
  const runtime = {
    cwd: typeof options.cwd === "string" ? options.cwd : hooksRoot,
    env,
    homedir,
    ...extraRuntime,
  };

  return postToolUse.run(stdinText, runtime);
};

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe("entrypoint config readers", () => {
  const scriptName = "post-tool-use.js";
  const scriptModule = postToolUse;

  it(`reads .env text for ${scriptName}`, () => {
    const cwd = createTempDir("memory-mason-cwd-");
    const envText = "MEMORY_MASON_VAULT_PATH=/vault/path\nMEMORY_MASON_SUBFOLDER=notes";

    writeText(path.join(cwd, ".env"), envText);

    expect(scriptModule.readDotEnvText(cwd)).toBe(envText);
    expect(scriptModule.readDotEnvText(createTempDir("memory-mason-cwd-empty-"))).toBe("");
  });

  it(`reads global config text for ${scriptName}`, () => {
    const homeDir = createTempDir("memory-mason-home-");
    const configText = JSON.stringify({ vaultPath: "/vault", subfolder: "notes" });

    writeText(path.join(homeDir, ".memory-mason", "config.json"), configText);

    expect(scriptModule.readGlobalConfigText(homeDir)).toBe(configText);
    expect(scriptModule.readGlobalConfigText(createTempDir("memory-mason-home-empty-"))).toBe("");
  });

  it(`reads global .env text for ${scriptName}`, () => {
    const homeDir = createTempDir("memory-mason-home-");
    const envText = "MEMORY_MASON_VAULT_PATH=~/vault\nMEMORY_MASON_SUBFOLDER=global-brain";

    writeText(path.join(homeDir, ".memory-mason", ".env"), envText);

    expect(scriptModule.readGlobalDotEnvText(homeDir)).toBe(envText);
    expect(scriptModule.readGlobalDotEnvText(createTempDir("memory-mason-home-empty-"))).toBe("");
  });
});

describe("post-tool-use.js", () => {
  it("writes tool output for copilot vscode payloads", () => {
    const homeDir = createTempDir("memory-mason-home-");
    const vaultPath = createTempDir("memory-mason-vault-");

    const result = runScript("post-tool-use.js", {
      payload: {
        hookEventName: "post-tool-use",
        cwd: hooksRoot,
        tool_name: "Edit",
        tool_response: "patched file",
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
    });

    expect(result.status).toBe(0);
    expect(
      fs.readFileSync(buildDailyChunkPath(vaultPath, "ai-knowledge", today(), 1), "utf-8"),
    ).toContain("patched file");
  });

  it("writes structured tool output for claude payloads", () => {
    const homeDir = createTempDir("memory-mason-home-");
    const vaultPath = createTempDir("memory-mason-vault-");

    const result = runScript("post-tool-use.js", {
      payload: {
        hook_event_name: "PostToolUse",
        cwd: hooksRoot,
        tool_name: "Bash",
        tool_response: {
          stdout: "grep hit 1\ngrep hit 2",
          stderr: "",
          interrupted: false,
          isImage: false,
        },
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
    });

    expect(result.status).toBe(0);
    expect(
      fs.readFileSync(buildDailyChunkPath(vaultPath, "ai-knowledge", today(), 1), "utf-8"),
    ).toContain("grep hit 1");
    expect(
      fs.readFileSync(buildDailyChunkPath(vaultPath, "ai-knowledge", today(), 1), "utf-8"),
    ).toContain("stdout");
  });

  it("writes text blocks for structured claude tool outputs", () => {
    const homeDir = createTempDir("memory-mason-home-");
    const vaultPath = createTempDir("memory-mason-vault-");

    const result = runScript("post-tool-use.js", {
      payload: {
        hook_event_name: "PostToolUse",
        cwd: hooksRoot,
        tool_name: "mcp__plugin_claude-mem_mcp-search__search",
        tool_response: [
          { type: "text", text: "match 1" },
          { type: "text", text: "match 2" },
        ],
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
    });

    expect(result.status).toBe(0);
    expect(
      fs.readFileSync(buildDailyChunkPath(vaultPath, "ai-knowledge", today(), 1), "utf-8"),
    ).toContain("match 1");
    expect(
      fs.readFileSync(buildDailyChunkPath(vaultPath, "ai-knowledge", today(), 1), "utf-8"),
    ).toContain("match 2");
  });

  it("writes tool output for copilot cli payloads", () => {
    const homeDir = createTempDir("memory-mason-home-");
    const vaultPath = createTempDir("memory-mason-vault-");

    runScript("post-tool-use.js", {
      payload: {
        timestamp: "2026-04-27T10:00:00.000Z",
        cwd: hooksRoot,
        toolName: "apply_patch",
        toolResult: { textResultForLlm: "patch ok" },
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
    });

    expect(
      fs.readFileSync(buildDailyChunkPath(vaultPath, "ai-knowledge", today(), 1), "utf-8"),
    ).toContain("patch ok");
  });

  it("writes tool output for codex payloads", () => {
    const homeDir = createTempDir("memory-mason-home-");
    const vaultPath = createTempDir("memory-mason-vault-");

    runScript("post-tool-use.js", {
      payload: {
        hook_event_name: "post_tool_use",
        turn_id: "turn-1",
        cwd: hooksRoot,
        tool_name: "Shell",
        tool_result: "codex result",
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
    });

    expect(
      fs.readFileSync(buildDailyChunkPath(vaultPath, "ai-knowledge", today(), 1), "utf-8"),
    ).toContain("codex result");
  });

  it("skips noisy tools", () => {
    const homeDir = createTempDir("memory-mason-home-");
    const vaultPath = createTempDir("memory-mason-vault-");

    const result = runScript("post-tool-use.js", {
      payload: {
        hookEventName: "post-tool-use",
        cwd: hooksRoot,
        tool_name: "Read",
        tool_response: "ignored",
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
    });

    expect(result.status).toBe(0);
    expect(fs.existsSync(buildDailyFilePath(vaultPath, "ai-knowledge", today()))).toBe(false);
  });

  it("reports invalid payloads to stderr", () => {
    const result = runScript("post-tool-use.js", {
      payload: { cwd: hooksRoot },
      env: buildEnv(createTempDir("memory-mason-home-")),
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("cannot detect platform from stdin shape:");
  });
});

describe("run - mm suppression", () => {
  it("skips tool write when mmSuppressed is true", () => {
    const homeDir = createTempDir("memory-mason-home-");
    const vaultPath = createTempDir("memory-mason-vault-");
    const statePath = resolveCaptureStatePath(vaultPath, "ai-knowledge");

    writeText(
      statePath,
      JSON.stringify(
        {
          lastCapture: null,
          mmSuppressed: true,
        },
        null,
        2,
      ),
    );

    const result = runScript("post-tool-use.js", {
      payload: {
        hook_event_name: "PostToolUse",
        cwd: hooksRoot,
        tool_name: "Bash",
        tool_response: "should be skipped",
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
    });

    expect(result.status).toBe(0);
    expect(fs.existsSync(buildDailyChunkPath(vaultPath, "ai-knowledge", today(), 1))).toBe(false);
  });

  it("writes tool output when mmSuppressed is false", () => {
    const homeDir = createTempDir("memory-mason-home-");
    const vaultPath = createTempDir("memory-mason-vault-");
    const statePath = resolveCaptureStatePath(vaultPath, "ai-knowledge");

    writeText(
      statePath,
      JSON.stringify(
        {
          lastCapture: null,
          mmSuppressed: false,
        },
        null,
        2,
      ),
    );

    const result = runScript("post-tool-use.js", {
      payload: {
        hook_event_name: "PostToolUse",
        cwd: hooksRoot,
        tool_name: "Bash",
        tool_response: "tool output when not suppressed",
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
    });

    const dailyContent = fs.readFileSync(
      buildDailyChunkPath(vaultPath, "ai-knowledge", today(), 1),
      "utf-8",
    );

    expect(result.status).toBe(0);
    expect(dailyContent).toContain("tool output when not suppressed");
  });

  it("writes tool output when capture state file does not exist", () => {
    const homeDir = createTempDir("memory-mason-home-");
    const vaultPath = createTempDir("memory-mason-vault-");

    const result = runScript("post-tool-use.js", {
      payload: {
        hook_event_name: "PostToolUse",
        cwd: hooksRoot,
        tool_name: "Bash",
        tool_response: "tool output with missing state",
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
    });

    const dailyContent = fs.readFileSync(
      buildDailyChunkPath(vaultPath, "ai-knowledge", today(), 1),
      "utf-8",
    );

    expect(result.status).toBe(0);
    expect(dailyContent).toContain("tool output with missing state");
  });
});

describe("run - sync flag", () => {
  it("returns status 0 without writing to vault when sync is false", () => {
    const homeDir = createTempDir("memory-mason-home-");
    const vaultPath = createTempDir("memory-mason-vault-");
    const cwd = createTempDir("memory-mason-cwd-");

    writeText(
      path.join(cwd, "memory-mason.json"),
      JSON.stringify(
        {
          vaultPath,
          subfolder: "ai-knowledge",
          sync: false,
        },
        null,
        2,
      ),
    );

    const result = runScript("post-tool-use.js", {
      payload: {
        hook_event_name: "PostToolUse",
        cwd,
        tool_name: "Bash",
        tool_response: "should be skipped when sync is false",
      },
      cwd,
      env: buildEnv(homeDir),
    });

    expect(result).toEqual({ status: 0, stdout: "", stderr: "" });
    expect(fs.existsSync(buildDailyChunkPath(vaultPath, "ai-knowledge", today(), 1))).toBe(false);
  });

  it("proceeds normally when sync is true", () => {
    const homeDir = createTempDir("memory-mason-home-");
    const vaultPath = createTempDir("memory-mason-vault-");
    const cwd = createTempDir("memory-mason-cwd-");

    writeText(
      path.join(cwd, "memory-mason.json"),
      JSON.stringify(
        {
          vaultPath,
          subfolder: "ai-knowledge",
          sync: true,
        },
        null,
        2,
      ),
    );

    const result = runScript("post-tool-use.js", {
      payload: {
        hook_event_name: "PostToolUse",
        cwd,
        tool_name: "Bash",
        tool_response: "tool output when sync is enabled",
      },
      cwd,
      env: buildEnv(homeDir),
    });

    const dailyContent = fs.readFileSync(
      buildDailyChunkPath(vaultPath, "ai-knowledge", today(), 1),
      "utf-8",
    );

    expect(result.status).toBe(0);
    expect(dailyContent).toContain("tool output when sync is enabled");
  });
});

describe("post-tool-use.js readStdin", () => {
  it("returns valid JSON string from mocked fd 0", () => {
    const payload = JSON.stringify({ tool_name: "Bash", tool_response: "ok" });
    const buf = Buffer.from(payload);
    let rc = 0;
    expect(
      postToolUse.readStdin({
        readSync(_fd, chunk) {
          if (rc === 0) {
            rc++;
            buf.copy(chunk);
            return buf.length;
          }
          return 0;
        },
      }),
    ).toBe(payload);
  });

  it("returns empty string on immediate EOF", () => {
    expect(postToolUse.readStdin({ readSync: () => 0 })).toBe("");
  });
});

describe("post-tool-use.js serializeToolResponse", () => {
  it("returns empty string for null/undefined/numeric/boolean", () => {
    expect(postToolUse.serializeToolResponse(null)).toBe("");
    expect(postToolUse.serializeToolResponse(undefined)).toBe("");
    expect(postToolUse.serializeToolResponse(42)).toBe("");
    expect(postToolUse.serializeToolResponse(true)).toBe("");
  });

  it("returns string as-is", () => {
    expect(postToolUse.serializeToolResponse("hello")).toBe("hello");
  });

  it("returns JSON.stringify for plain object", () => {
    const obj = { stdout: "out" };
    expect(postToolUse.serializeToolResponse(obj)).toBe(JSON.stringify(obj, null, 2));
  });

  it("joins text blocks for array with valid text blocks", () => {
    expect(
      postToolUse.serializeToolResponse([
        { type: "text", text: "a" },
        { type: "text", text: "b" },
      ]),
    ).toBe("a\nb");
  });

  it("falls back to JSON for array with non-text blocks only", () => {
    const arr = [{ type: "image", url: "x" }];
    expect(postToolUse.serializeToolResponse(arr)).toBe(JSON.stringify(arr, null, 2));
  });

  it("falls back to JSON for array with empty text blocks", () => {
    const arr = [
      { type: "text", text: "   " },
      { type: "text", text: "" },
    ];
    expect(postToolUse.serializeToolResponse(arr)).toBe(JSON.stringify(arr, null, 2));
  });

  it("filters out null, non-object, non-text-type, non-string-text elements", () => {
    const arr = [
      null,
      "str",
      { type: "image", text: "no" },
      { type: "text", text: null },
      { type: "text", text: "yes" },
    ];
    expect(postToolUse.serializeToolResponse(arr)).toBe("yes");
  });
});

describe("post-tool-use.js runtime fallback branches", () => {
  it("resolveRuntimeEnv falls back when env is null", () => {
    const result = postToolUse.run(
      JSON.stringify({
        hook_event_name: "PostToolUse",
        cwd: createTempDir("mm-cwd-"),
        tool_name: "Bash",
        tool_response: "x",
      }),
      { env: null, cwd: createTempDir("mm-cwd-"), homedir: createTempDir("mm-h-") },
    );
    expect(result.status).toBe(0);
  });

  it("resolveFallbackCwd falls back when cwd is not a string", () => {
    const homeDir = createTempDir("mm-home-");
    const result = postToolUse.run(
      JSON.stringify({
        hook_event_name: "PostToolUse",
        cwd: homeDir,
        tool_name: "Bash",
        tool_response: "x",
      }),
      {
        env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: createTempDir("mm-v-") }),
        cwd: 123,
        homedir: homeDir,
      },
    );
    expect(result.status).toBe(0);
  });

  it("resolveRuntimeHomedir falls back when homedir is not a string", () => {
    const homeDir = createTempDir("mm-home-");
    const result = postToolUse.run(
      JSON.stringify({
        hook_event_name: "PostToolUse",
        cwd: homeDir,
        tool_name: "Bash",
        tool_response: "x",
      }),
      {
        env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: createTempDir("mm-v-") }),
        cwd: homeDir,
        homedir: 42,
      },
    );
    expect(result.status).toBe(0);
  });
});

describe("post-tool-use.js extractToolPayload unsupported platform", () => {
  it("throws for unsupported platform", () => {
    expect(() => postToolUse.extractToolPayload("unknown-platform", {})).toThrow(
      "unsupported platform: unknown-platform",
    );
  });
});

describe("post-tool-use.js MEMORY_MASON_INVOKED_BY skip", () => {
  it("returns empty when MEMORY_MASON_INVOKED_BY is set", () => {
    const homeDir = createTempDir("mm-home-");
    const result = postToolUse.run(
      JSON.stringify({
        hook_event_name: "PostToolUse",
        cwd: createTempDir("mm-cwd-"),
        tool_name: "Bash",
        tool_response: "x",
      }),
      { env: { MEMORY_MASON_INVOKED_BY: "mmc" }, cwd: createTempDir("mm-cwd-"), homedir: homeDir },
    );
    expect(result).toEqual({ status: 0, stdout: "", stderr: "" });
  });
});

describe("post-tool-use.js readConfigText with existing file", () => {
  it("uses memory-mason.json when no env vault path is set", () => {
    const homeDir = createTempDir("mm-home-");
    const vaultPath = createTempDir("mm-vault-");
    const cwd = createTempDir("mm-cwd-");

    writeText(
      path.join(cwd, "memory-mason.json"),
      JSON.stringify({ vaultPath, subfolder: "ai-knowledge" }),
    );

    const result = runScript("post-tool-use.js", {
      payload: { hook_event_name: "PostToolUse", cwd, tool_name: "Bash", tool_response: "output" },
      cwd,
      env: buildEnv(homeDir),
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(
      fs.readFileSync(buildDailyChunkPath(vaultPath, "ai-knowledge", today(), 1), "utf-8"),
    ).toContain("output");
  });
});

describe("post-tool-use.js copilot-cli payload branches", () => {
  it("falls back to empty object when toolResult is null", () => {
    const homeDir = createTempDir("mm-home-");
    const vaultPath = createTempDir("mm-vault-");
    const result = postToolUse.run(
      JSON.stringify({ timestamp: "2025-01-01T00:00:00.000Z", toolName: "Bash", toolResult: null }),
      {
        env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
        cwd: homeDir,
        homedir: homeDir,
      },
    );
    expect(result.status).toBe(0);
  });
});

describe("post-tool-use.js input cwd fallback branch", () => {
  it("uses fallbackCwd when input has no cwd", () => {
    const homeDir = createTempDir("mm-home-");
    const vaultPath = createTempDir("mm-vault-");
    const result = postToolUse.run(
      JSON.stringify({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_response: "x" }),
      {
        env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
        cwd: homeDir,
        homedir: homeDir,
      },
    );
    expect(result.status).toBe(0);
  });
});

describe("post-tool-use.js main", () => {
  it("calls exit 0 after writing tool output", () => {
    const homeDir = createTempDir("mm-home-");
    const vaultPath = createTempDir("mm-vault-");
    const payload = JSON.stringify({
      hook_event_name: "PostToolUse",
      cwd: homeDir,
      tool_name: "Bash",
      tool_response: "main out",
    });
    const buf = Buffer.from(payload);
    let rc = 0;
    const writes = [];
    const errors = [];
    let exitCode = null;
    postToolUse.main({
      io: {
        stdout: (t) => writes.push(t),
        stderr: (t) => errors.push(t),
        exit: (c) => {
          exitCode = c;
        },
      },
      fs: {
        readSync(_fd, chunk) {
          if (rc === 0) {
            rc++;
            buf.copy(chunk);
            return buf.length;
          }
          return 0;
        },
      },
      cwd: homeDir,
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
      homedir: homeDir,
    });
    expect(exitCode).toBe(0);
    expect(errors).toHaveLength(0);
  });

  it("writes stderr on config failure", () => {
    const homeDir = createTempDir("mm-home-");
    const payload = JSON.stringify({
      hook_event_name: "PostToolUse",
      cwd: createTempDir("mm-nocfg-"),
      tool_name: "Bash",
      tool_response: "x",
    });
    const buf = Buffer.from(payload);
    let rc = 0;
    const errors = [];
    let exitCode = null;
    postToolUse.main({
      io: {
        stdout: () => {},
        stderr: (t) => errors.push(t),
        exit: (c) => {
          exitCode = c;
        },
      },
      fs: {
        readSync(_fd, chunk) {
          if (rc === 0) {
            rc++;
            buf.copy(chunk);
            return buf.length;
          }
          return 0;
        },
      },
      cwd: createTempDir("mm-fb-"),
      env: buildEnv(homeDir),
      homedir: homeDir,
    });
    expect(exitCode).toBe(0);
    expect(errors.join("")).toContain(
      "Memory Mason config not found. Checked MEMORY_MASON_VAULT_PATH, project .env, project memory-mason.json, ~/.memory-mason/.env, and ~/.memory-mason/config.json.",
    );
  });

  it("falls back to process stdout/stderr when io functions are missing", () => {
    const homeDir = createTempDir("mm-home-");
    const vaultPath = createTempDir("mm-vault-");
    const payload = JSON.stringify({
      hook_event_name: "PostToolUse",
      cwd: homeDir,
      tool_name: "Read",
      tool_response: "",
    });
    const buf = Buffer.from(payload);
    let rc = 0;
    const result = postToolUse.main({
      io: { exit: () => {} },
      fs: {
        readSync(_fd, chunk) {
          if (rc === 0) {
            rc++;
            buf.copy(chunk);
            return buf.length;
          }
          return 0;
        },
      },
      cwd: homeDir,
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
      homedir: homeDir,
    });
    expect(result.status).toBe(0);
  });
});
