"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { buildDailyChunkPath, buildDailyFilePath } = require("../lib/vault");
const { resolveCaptureStatePath } = require("../lib/capture-state");
const preCompact = require("../pre-compact");
const { materializeProjectDotEnvConfig } = require("./helpers/project-dot-env");
const {
  generatedEnvPaths,
  createTempDir,
  buildEnv,
  writeText,
  today,
  buildTranscript,
  cleanupGeneratedArtifacts,
  runHookEntrypoint,
} = require("./helpers/entrypoint-runtime");
const hooksRoot = path.resolve(__dirname, "..");

const withProcessCaptureMode = (value, callback) => {
  const hadCaptureMode = Object.hasOwn(process.env, "MEMORY_MASON_CAPTURE_MODE");
  const previousCaptureMode = process.env.MEMORY_MASON_CAPTURE_MODE;

  if (typeof value === "string") {
    process.env.MEMORY_MASON_CAPTURE_MODE = value;
  } else {
    delete process.env.MEMORY_MASON_CAPTURE_MODE;
  }

  try {
    return callback();
  } finally {
    if (hadCaptureMode && typeof previousCaptureMode === "string") {
      process.env.MEMORY_MASON_CAPTURE_MODE = previousCaptureMode;
    } else {
      delete process.env.MEMORY_MASON_CAPTURE_MODE;
    }
  }
};

afterEach(() => {
  cleanupGeneratedArtifacts();
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
      JSON.stringify({ vaultPath, subfolder: "ai-knowledge", captureMode: "full" }),
    );
    writeText(transcriptPath, buildTranscript(6));

    const result = runHookEntrypoint("pre-compact.js", {
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

    const result = runHookEntrypoint("pre-compact.js", {
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

    const result = runHookEntrypoint("pre-compact.js", {
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

    runHookEntrypoint("pre-compact.js", {
      payload: { cwd: hooksRoot, transcript_path: transcriptPath, session_id: "session-1" },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
    });

    expect(fs.existsSync(buildDailyFilePath(vaultPath, "ai-knowledge", today()))).toBe(false);
  });

  it("skips when transcript excerpt too small in full mode", () => {
    withProcessCaptureMode("full", () => {
      const homeDir = createTempDir("memory-mason-home-");
      const vaultPath = createTempDir("memory-mason-vault-");
      const transcriptPath = path.join(createTempDir("memory-mason-transcript-"), "session.jsonl");

      writeText(transcriptPath, buildTranscript(4));

      const result = runHookEntrypoint("pre-compact.js", {
        payload: {
          cwd: hooksRoot,
          transcript_path: transcriptPath,
          session_id: "session-short-full",
        },
        env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
      });

      expect(result.status).toBe(0);
      expect(fs.existsSync(buildDailyFilePath(vaultPath, "ai-knowledge", today()))).toBe(false);
    });
  });

  it("writes excerpt and capture state for valid transcript", () =>
    withProcessCaptureMode("full", () => {
      const homeDir = createTempDir("memory-mason-home-");
      const vaultPath = createTempDir("memory-mason-vault-");
      const transcriptPath = path.join(createTempDir("memory-mason-transcript-"), "session.jsonl");

      writeText(transcriptPath, buildTranscript(6));

      const result = runHookEntrypoint("pre-compact.js", {
        payload: { cwd: hooksRoot, transcript_path: transcriptPath, session_id: "session-1" },
        env: buildEnv(homeDir, {
          MEMORY_MASON_VAULT_PATH: vaultPath,
        }),
      });

      const dailyPath = buildDailyChunkPath(vaultPath, "ai-knowledge", today(), 1);
      const statePath = resolveCaptureStatePath(vaultPath, "ai-knowledge");
      expect(result.status).toBe(0);
      expect(fs.readFileSync(dailyPath, "utf-8")).toContain("session-1 / pre-compact");
      expect(fs.readFileSync(dailyPath, "utf-8")).toContain("**User:** user turn");
      expect(JSON.parse(fs.readFileSync(statePath, "utf-8")).lastCapture.source).toBe(
        "pre-compact",
      );
    }));

  it("writes full transcript without turn or character truncation", () =>
    withProcessCaptureMode("full", () => {
      const homeDir = createTempDir("memory-mason-home-");
      const vaultPath = createTempDir("memory-mason-vault-");
      const transcriptPath = path.join(createTempDir("memory-mason-transcript-"), "session.jsonl");
      const longFirstTurn = `first-user-turn-${"x".repeat(17000)}`;

      writeText(transcriptPath, buildTranscript(40, longFirstTurn));

      const result = runHookEntrypoint("pre-compact.js", {
        payload: {
          cwd: hooksRoot,
          transcript_path: transcriptPath,
          session_id: "session-full-pre-compact",
        },
        env: buildEnv(homeDir, {
          MEMORY_MASON_VAULT_PATH: vaultPath,
        }),
      });

      const dailyPath = buildDailyChunkPath(vaultPath, "ai-knowledge", today(), 1);
      const dailyContent = fs.readFileSync(dailyPath, "utf-8");

      expect(result.status).toBe(0);
      expect(dailyContent).toContain(longFirstTurn);
      expect(dailyContent).toContain("assistant turn 39");
      expect(dailyContent).not.toContain("...(truncated)");
    }));

  it("lite mode skips pre-compact entirely", () => {
    const homeDir = createTempDir("memory-mason-home-");
    const vaultPath = createTempDir("memory-mason-vault-");
    const transcriptPath = path.join(createTempDir("memory-mason-transcript-"), "session.jsonl");
    const transcript = [
      JSON.stringify({ message: { role: "user", content: "u1" } }),
      JSON.stringify({ message: { role: "assistant", content: "a1" } }),
      JSON.stringify({ message: { role: "user", content: "u2" } }),
      JSON.stringify({ message: { role: "assistant", content: "a2" } }),
      JSON.stringify({ message: { role: "user", content: "u3" } }),
      JSON.stringify({ message: { role: "assistant", content: "a3" } }),
    ].join("\n");

    writeText(transcriptPath, transcript);

    const result = runHookEntrypoint("pre-compact.js", {
      payload: {
        cwd: hooksRoot,
        transcript_path: transcriptPath,
        session_id: "session-lite-skip",
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
    });

    expect(result.status).toBe(0);
    expect(fs.existsSync(buildDailyFilePath(vaultPath, "ai-knowledge", today()))).toBe(false);
  });

  it("lite mode skips pre-compact (system-reminder test)", () => {
    const homeDir = createTempDir("memory-mason-home-");
    const vaultPath = createTempDir("memory-mason-vault-");
    const transcriptPath = path.join(createTempDir("memory-mason-transcript-"), "session.jsonl");

    writeText(transcriptPath, buildTranscript(6));

    const result = runHookEntrypoint("pre-compact.js", {
      payload: {
        cwd: hooksRoot,
        transcript_path: transcriptPath,
        session_id: "session-lite-skip-2",
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
    });

    expect(result.status).toBe(0);
    expect(fs.existsSync(buildDailyFilePath(vaultPath, "ai-knowledge", today()))).toBe(false);
  });

  it("full mode via project JSON preserves tags in persisted markdown", () => {
    const cwd = createTempDir("memory-mason-cwd-");
    const homeDir = createTempDir("memory-mason-home-");
    const vaultPath = createTempDir("memory-mason-vault-");
    const transcriptPath = path.join(createTempDir("memory-mason-transcript-"), "session.jsonl");
    const transcript = [
      JSON.stringify({ message: { role: "user", content: "u1<thinking>hidden</thinking>" } }),
      JSON.stringify({ message: { role: "assistant", content: "a1" } }),
      JSON.stringify({ message: { role: "user", content: "u2" } }),
      JSON.stringify({ message: { role: "assistant", content: "a2" } }),
      JSON.stringify({ message: { role: "user", content: "u3" } }),
      JSON.stringify({ message: { role: "assistant", content: "a3" } }),
    ].join("\n");

    writeText(
      path.join(cwd, "memory-mason.json"),
      JSON.stringify({ vaultPath, subfolder: "ai-knowledge", captureMode: "full" }, null, 2),
    );
    writeText(transcriptPath, transcript);

    const result = runHookEntrypoint("pre-compact.js", {
      payload: {
        cwd,
        transcript_path: transcriptPath,
        session_id: "session-full-preserve-tags",
      },
      cwd,
      env: buildEnv(homeDir),
    });

    const dailyContent = fs.readFileSync(
      buildDailyChunkPath(vaultPath, "ai-knowledge", today(), 1),
      "utf-8",
    );

    expect(result.status).toBe(0);
    expect(dailyContent).toContain("<thinking>hidden</thinking>");
  });

  it("skips duplicate capture within duplicate window", () =>
    withProcessCaptureMode("full", () => {
      const homeDir = createTempDir("memory-mason-home-");
      const vaultPath = createTempDir("memory-mason-vault-");
      const transcriptPath = path.join(createTempDir("memory-mason-transcript-"), "session.jsonl");

      writeText(transcriptPath, buildTranscript(6));

      runHookEntrypoint("pre-compact.js", {
        payload: { cwd: hooksRoot, transcript_path: transcriptPath, session_id: "session-1" },
        env: buildEnv(homeDir, {
          MEMORY_MASON_VAULT_PATH: vaultPath,
        }),
      });
      const dailyPath = buildDailyChunkPath(vaultPath, "ai-knowledge", today(), 1);
      const firstContent = fs.readFileSync(dailyPath, "utf-8");

      runHookEntrypoint("pre-compact.js", {
        payload: { cwd: hooksRoot, transcript_path: transcriptPath, session_id: "session-1" },
        env: buildEnv(homeDir, {
          MEMORY_MASON_VAULT_PATH: vaultPath,
        }),
      });

      expect(fs.readFileSync(dailyPath, "utf-8")).toBe(firstContent);
    }));

  it("reports invalid stdin to stderr", () => {
    const result = runHookEntrypoint("pre-compact.js", {
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

    const result = runHookEntrypoint("pre-compact.js", {
      payload: { cwd: hooksRoot, transcript_path: transcriptPath, session_id: "session-mm-true" },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
    });

    expect(result.status).toBe(0);
    expect(fs.existsSync(buildDailyChunkPath(vaultPath, "ai-knowledge", today(), 1))).toBe(false);
  });

  it("skips pre-compact capture in full mode when mmSuppressed is true", () => {
    withProcessCaptureMode("full", () => {
      const homeDir = createTempDir("memory-mason-home-");
      const vaultPath = createTempDir("memory-mason-vault-");
      const transcriptPath = path.join(createTempDir("memory-mason-transcript-"), "session.jsonl");
      const statePath = resolveCaptureStatePath(vaultPath, "ai-knowledge");

      writeText(transcriptPath, buildTranscript(6));
      writeText(statePath, JSON.stringify({ lastCapture: null, mmSuppressed: true }, null, 2));

      const result = runHookEntrypoint("pre-compact.js", {
        payload: {
          cwd: hooksRoot,
          transcript_path: transcriptPath,
          session_id: "session-mm-full-true",
        },
        env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
      });

      expect(result.status).toBe(0);
      expect(fs.existsSync(buildDailyChunkPath(vaultPath, "ai-knowledge", today(), 1))).toBe(false);
    });
  });

  it("continues pre-compact capture when mmSuppressed is false", () =>
    withProcessCaptureMode("full", () => {
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

      const result = runHookEntrypoint("pre-compact.js", {
        payload: {
          cwd: hooksRoot,
          transcript_path: transcriptPath,
          session_id: "session-mm-false",
        },
        env: buildEnv(homeDir, {
          MEMORY_MASON_VAULT_PATH: vaultPath,
        }),
      });

      const dailyContent = fs.readFileSync(
        buildDailyChunkPath(vaultPath, "ai-knowledge", today(), 1),
        "utf-8",
      );

      expect(result.status).toBe(0);
      expect(dailyContent).toContain("session-mm-false / pre-compact");
    }));
});

describe("run - sync flag", () => {
  it("returns status 0 without writing to vault when sync is false", () => {
    const cwd = createTempDir("memory-mason-cwd-");
    const homeDir = createTempDir("memory-mason-home-");
    const vaultPath = createTempDir("memory-mason-vault-");
    const transcriptPath = path.join(createTempDir("memory-mason-transcript-"), "session.jsonl");

    writeText(
      path.join(cwd, "memory-mason.json"),
      JSON.stringify({ vaultPath, subfolder: "ai-knowledge", sync: false }),
    );
    writeText(transcriptPath, buildTranscript(6));

    const result = runHookEntrypoint("pre-compact.js", {
      payload: {
        cwd,
        transcript_path: transcriptPath,
        session_id: "session-sync-false",
      },
      cwd,
      env: buildEnv(homeDir),
    });

    expect(result.status).toBe(0);
    expect(fs.existsSync(buildDailyChunkPath(vaultPath, "ai-knowledge", today(), 1))).toBe(false);
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
  it("reads stdin via mock fs and calls exit", () =>
    withProcessCaptureMode("full", () => {
      const homeDir = createTempDir("mm-home-");
      const vaultPath = createTempDir("mm-vault-");
      const env = buildEnv(homeDir, {
        MEMORY_MASON_VAULT_PATH: vaultPath,
      });
      const transcriptPath = path.join(createTempDir("mm-tr-"), "session.jsonl");
      writeText(transcriptPath, buildTranscript(6));
      const projectCwd = createTempDir("mm-cwd-");
      const payload = JSON.stringify({
        cwd: projectCwd,
        transcript_path: transcriptPath,
        session_id: "session-main",
      });
      const buf = Buffer.from(payload);
      let rc = 0;
      const errors = [];
      let exitCode = null;
      materializeProjectDotEnvConfig(projectCwd, env, generatedEnvPaths);
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
        cwd: projectCwd,
        env,
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
    }));

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
