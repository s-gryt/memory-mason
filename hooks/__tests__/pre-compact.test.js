"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildDailyChunkPath, buildDailyFilePath } = require("../lib/vault");
const { resolveCaptureStatePath } = require("../lib/capture-state");
const preCompact = require("../pre-compact");
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

const buildTranscript = (turnCount, firstUserContent = "user turn") =>
  Array.from({ length: turnCount }, (_, index) => {
    const isUser = index % 2 === 0;
    const role = isUser ? "user" : "assistant";
    const content = isUser && index === 0 ? firstUserContent : `${role} turn ${index}`;
    return JSON.stringify({ message: { role, content } });
  }).join("\n");

const runScript = (_scriptName, options = {}) => {
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

  return preCompact.run(stdinText, runtime);
};

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe("entrypoint config readers", () => {
  const scriptName = "pre-compact.js";
  const scriptModule = preCompact;

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

  it(`reads memory-mason.json config for ${scriptName} when env vault path is absent`, () => {
    const cwd = createTempDir("memory-mason-cwd-");
    const homeDir = createTempDir("memory-mason-home-");
    const vaultPath = createTempDir("memory-mason-vault-");
    const transcriptPath = path.join(createTempDir("memory-mason-transcript-"), "session.jsonl");

    writeText(
      path.join(cwd, "memory-mason.json"),
      JSON.stringify({ vaultPath, subfolder: "ai-knowledge" }),
    );
    writeText(transcriptPath, buildTranscript(6));

    const result = runScript("pre-compact.js", {
      payload: { cwd, transcript_path: transcriptPath, session_id: "cfg-test" },
      cwd,
      env: buildEnv(homeDir),
    });

    expect(result.status).toBe(0);
    expect(
      fs.readFileSync(buildDailyChunkPath(vaultPath, "ai-knowledge", today(), 1), "utf-8"),
    ).toContain("cfg-test / pre-compact");
  });
});

describe("pre-compact.js", () => {
  it("skips when invoked by another Memory Mason command", () => {
    const homeDir = createTempDir("memory-mason-home-");
    const vaultPath = createTempDir("memory-mason-vault-");
    const transcriptPath = path.join(createTempDir("memory-mason-transcript-"), "session.jsonl");

    writeText(transcriptPath, buildTranscript(6));

    const result = runScript("pre-compact.js", {
      payload: { cwd: hooksRoot, transcript_path: transcriptPath, session_id: "session-1" },
      env: buildEnv(homeDir, {
        MEMORY_MASON_VAULT_PATH: vaultPath,
        MEMORY_MASON_INVOKED_BY: "mmc",
      }),
    });

    expect(result.status).toBe(0);
    expect(fs.existsSync(buildDailyFilePath(vaultPath, "ai-knowledge", today()))).toBe(false);
  });

  it("skips when transcript file missing", () => {
    const homeDir = createTempDir("memory-mason-home-");
    const vaultPath = createTempDir("memory-mason-vault-");

    const result = runScript("pre-compact.js", {
      payload: {
        cwd: hooksRoot,
        transcript_path: path.join(hooksRoot, "missing.jsonl"),
        session_id: "session-1",
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
    });

    expect(result.status).toBe(0);
    expect(fs.existsSync(buildDailyFilePath(vaultPath, "ai-knowledge", today()))).toBe(false);
  });

  it("skips when transcript excerpt too small", () => {
    const homeDir = createTempDir("memory-mason-home-");
    const vaultPath = createTempDir("memory-mason-vault-");
    const transcriptPath = path.join(createTempDir("memory-mason-transcript-"), "session.jsonl");

    writeText(transcriptPath, buildTranscript(4));

    runScript("pre-compact.js", {
      payload: { cwd: hooksRoot, transcript_path: transcriptPath, session_id: "session-1" },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
    });

    expect(fs.existsSync(buildDailyFilePath(vaultPath, "ai-knowledge", today()))).toBe(false);
  });

  it("writes excerpt and capture state for valid transcript", () => {
    const homeDir = createTempDir("memory-mason-home-");
    const vaultPath = createTempDir("memory-mason-vault-");
    const transcriptPath = path.join(createTempDir("memory-mason-transcript-"), "session.jsonl");

    writeText(transcriptPath, buildTranscript(6));

    const result = runScript("pre-compact.js", {
      payload: { cwd: hooksRoot, transcript_path: transcriptPath, session_id: "session-1" },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
    });

    const dailyPath = buildDailyChunkPath(vaultPath, "ai-knowledge", today(), 1);
    const statePath = resolveCaptureStatePath(vaultPath, "ai-knowledge");
    expect(result.status).toBe(0);
    expect(fs.readFileSync(dailyPath, "utf-8")).toContain("session-1 / pre-compact");
    expect(fs.readFileSync(dailyPath, "utf-8")).toContain("**User:** user turn");
    expect(JSON.parse(fs.readFileSync(statePath, "utf-8")).lastCapture.source).toBe("pre-compact");
  });

  it("writes full transcript without turn or character truncation", () => {
    const homeDir = createTempDir("memory-mason-home-");
    const vaultPath = createTempDir("memory-mason-vault-");
    const transcriptPath = path.join(createTempDir("memory-mason-transcript-"), "session.jsonl");
    const longFirstTurn = `first-user-turn-${"x".repeat(17000)}`;

    writeText(transcriptPath, buildTranscript(40, longFirstTurn));

    const result = runScript("pre-compact.js", {
      payload: {
        cwd: hooksRoot,
        transcript_path: transcriptPath,
        session_id: "session-full-pre-compact",
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
    });

    const dailyPath = buildDailyChunkPath(vaultPath, "ai-knowledge", today(), 1);
    const dailyContent = fs.readFileSync(dailyPath, "utf-8");

    expect(result.status).toBe(0);
    expect(dailyContent).toContain(longFirstTurn);
    expect(dailyContent).toContain("assistant turn 39");
    expect(dailyContent).not.toContain("...(truncated)");
  });

  it("skips duplicate capture within duplicate window", () => {
    const homeDir = createTempDir("memory-mason-home-");
    const vaultPath = createTempDir("memory-mason-vault-");
    const transcriptPath = path.join(createTempDir("memory-mason-transcript-"), "session.jsonl");

    writeText(transcriptPath, buildTranscript(6));

    runScript("pre-compact.js", {
      payload: { cwd: hooksRoot, transcript_path: transcriptPath, session_id: "session-1" },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
    });
    const dailyPath = buildDailyChunkPath(vaultPath, "ai-knowledge", today(), 1);
    const firstContent = fs.readFileSync(dailyPath, "utf-8");

    runScript("pre-compact.js", {
      payload: { cwd: hooksRoot, transcript_path: transcriptPath, session_id: "session-1" },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
    });

    expect(fs.readFileSync(dailyPath, "utf-8")).toBe(firstContent);
  });

  it("reports invalid stdin to stderr", () => {
    const result = runScript("pre-compact.js", {
      stdinText: "{bad",
      env: buildEnv(createTempDir("memory-mason-home-")),
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("invalid JSON in stdin: {bad");
  });
});

describe("run - mm suppression", () => {
  it("skips pre-compact capture when mmSuppressed is true", () => {
    const homeDir = createTempDir("memory-mason-home-");
    const vaultPath = createTempDir("memory-mason-vault-");
    const transcriptPath = path.join(createTempDir("memory-mason-transcript-"), "session.jsonl");
    const statePath = resolveCaptureStatePath(vaultPath, "ai-knowledge");

    writeText(transcriptPath, buildTranscript(6));
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

    const result = runScript("pre-compact.js", {
      payload: { cwd: hooksRoot, transcript_path: transcriptPath, session_id: "session-mm-true" },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
    });

    expect(result.status).toBe(0);
    expect(fs.existsSync(buildDailyChunkPath(vaultPath, "ai-knowledge", today(), 1))).toBe(false);
  });

  it("continues pre-compact capture when mmSuppressed is false", () => {
    const homeDir = createTempDir("memory-mason-home-");
    const vaultPath = createTempDir("memory-mason-vault-");
    const transcriptPath = path.join(createTempDir("memory-mason-transcript-"), "session.jsonl");
    const statePath = resolveCaptureStatePath(vaultPath, "ai-knowledge");

    writeText(transcriptPath, buildTranscript(6));
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

    const result = runScript("pre-compact.js", {
      payload: {
        cwd: hooksRoot,
        transcript_path: transcriptPath,
        session_id: "session-mm-false",
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
    });

    const dailyContent = fs.readFileSync(
      buildDailyChunkPath(vaultPath, "ai-knowledge", today(), 1),
      "utf-8",
    );

    expect(result.status).toBe(0);
    expect(dailyContent).toContain("session-mm-false / pre-compact");
  });
});

describe("pre-compact.js readStdin", () => {
  it("reads single chunk from mocked fd 0", () => {
    const payload = JSON.stringify({ session_id: "s1" });
    const buf = Buffer.from(payload);
    let rc = 0;
    expect(
      preCompact.readStdin({
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
    expect(preCompact.readStdin({ readSync: () => 0 })).toBe("");
  });
});

describe("pre-compact.js firstNonEmptyString", () => {
  it("throws when values is not an array", () => {
    expect(() => preCompact.firstNonEmptyString("not-an-array")).toThrow("values must be an array");
    expect(() => preCompact.firstNonEmptyString(null)).toThrow("values must be an array");
    expect(() => preCompact.firstNonEmptyString(42)).toThrow("values must be an array");
  });
});

describe("pre-compact.js runtime fallback branches", () => {
  it("falls back to process defaults when runtime properties are invalid", () => {
    const result = preCompact.run(JSON.stringify({ cwd: createTempDir("mm-cwd-") }), {
      env: null,
      cwd: 123,
      homedir: 42,
    });
    expect(result.status).toBe(0);
  });

  it("uses fallbackCwd when input has no cwd", () => {
    const homeDir = createTempDir("mm-home-");
    const vaultPath = createTempDir("mm-vault-");
    const transcriptPath = path.join(createTempDir("mm-tr-"), "session.jsonl");

    writeText(transcriptPath, buildTranscript(6));

    const result = preCompact.run(
      JSON.stringify({ transcript_path: transcriptPath, session_id: "nocwd" }),
      {
        env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
        cwd: createTempDir("mm-fb-"),
        homedir: homeDir,
      },
    );

    expect(result.status).toBe(0);
  });
});

describe("pre-compact.js main", () => {
  it("reads stdin via mock fs and calls exit", () => {
    const homeDir = createTempDir("mm-home-");
    const vaultPath = createTempDir("mm-vault-");
    const transcriptPath = path.join(createTempDir("mm-tr-"), "session.jsonl");
    writeText(transcriptPath, buildTranscript(6));
    const payload = JSON.stringify({
      cwd: hooksRoot,
      transcript_path: transcriptPath,
      session_id: "session-main",
    });
    const buf = Buffer.from(payload);
    let rc = 0;
    const errors = [];
    let exitCode = null;
    preCompact.main({
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
      cwd: hooksRoot,
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
      homedir: homeDir,
      io: {
        stdout: () => {},
        stderr: (t) => errors.push(t),
        exit: (c) => {
          exitCode = c;
        },
      },
    });
    expect(exitCode).toBe(0);
    expect(errors).toHaveLength(0);
  });

  it("writes stderr on error", () => {
    const buf = Buffer.from("{bad-json");
    let rc = 0;
    const errors = [];
    let exitCode = null;
    preCompact.main({
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
      cwd: hooksRoot,
      env: buildEnv(createTempDir("mm-h-")),
      io: {
        stdout: () => {},
        stderr: (t) => errors.push(t),
        exit: (c) => {
          exitCode = c;
        },
      },
    });
    expect(exitCode).toBe(0);
    expect(errors.join("")).toContain("invalid JSON in stdin");
  });
});
