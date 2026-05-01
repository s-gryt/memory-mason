"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildDailyChunkPath, buildDailyFilePath } = require("../lib/vault");
const { resolveCaptureStatePath } = require("../lib/capture-state");
const userPromptSubmit = require("../user-prompt-submit");
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

const _yesterday = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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

  return userPromptSubmit.run(stdinText, runtime);
};

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe("entrypoint config readers", () => {
  it("reads .env text for user-prompt-submit.js", () => {
    const cwd = createTempDir("memory-mason-cwd-");
    const envText = "MEMORY_MASON_VAULT_PATH=/vault/path\nMEMORY_MASON_SUBFOLDER=notes";

    writeText(path.join(cwd, ".env"), envText);

    expect(userPromptSubmit.readDotEnvText(cwd)).toBe(envText);
    expect(userPromptSubmit.readDotEnvText(createTempDir("memory-mason-cwd-empty-"))).toBe("");
  });

  it("reads global config text for user-prompt-submit.js", () => {
    const homeDir = createTempDir("memory-mason-home-");
    const configText = JSON.stringify({ vaultPath: "/vault", subfolder: "notes" });

    writeText(path.join(homeDir, ".memory-mason", "config.json"), configText);

    expect(userPromptSubmit.readGlobalConfigText(homeDir)).toBe(configText);
    expect(userPromptSubmit.readGlobalConfigText(createTempDir("memory-mason-home-empty-"))).toBe(
      "",
    );
  });

  it("reads global .env text for user-prompt-submit.js", () => {
    const homeDir = createTempDir("memory-mason-home-");
    const envText = "MEMORY_MASON_VAULT_PATH=~/vault\nMEMORY_MASON_SUBFOLDER=global-brain";

    writeText(path.join(homeDir, ".memory-mason", ".env"), envText);

    expect(userPromptSubmit.readGlobalDotEnvText(homeDir)).toBe(envText);
    expect(userPromptSubmit.readGlobalDotEnvText(createTempDir("memory-mason-home-empty-"))).toBe(
      "",
    );
  });
});

describe("user-prompt-submit.js", () => {
  it("writes prompt into daily log", () => {
    const homeDir = createTempDir("memory-mason-home-");
    const vaultPath = createTempDir("memory-mason-vault-");

    const result = runScript("user-prompt-submit.js", {
      payload: { hookEventName: "user-prompt-submit", cwd: hooksRoot, prompt: " remember hooks " },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
    });

    const dailyPath = buildDailyChunkPath(vaultPath, "ai-knowledge", today(), 1);
    expect(result.status).toBe(0);
    expect(fs.readFileSync(dailyPath, "utf-8")).toContain("remember hooks");
  });

  it("writes rich slash-command metadata for Claude prompt expansion events", () => {
    const homeDir = createTempDir("memory-mason-home-");
    const vaultPath = createTempDir("memory-mason-vault-");

    const result = runScript("user-prompt-submit.js", {
      payload: {
        hook_event_name: "UserPromptExpansion",
        cwd: hooksRoot,
        prompt: "/caveman analyze attachments",
        expansion_type: "slash_command",
        command_name: "caveman:caveman",
        command_args: "analyze attachments",
        command_source: "plugin",
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
    });

    const dailyPath = buildDailyChunkPath(vaultPath, "ai-knowledge", today(), 1);
    const dailyContent = fs.readFileSync(dailyPath, "utf-8");

    expect(result.status).toBe(0);
    expect(dailyContent).toContain("UserPromptExpansion");
    expect(dailyContent).toContain("/caveman analyze attachments");
    expect(dailyContent).toContain("command: caveman:caveman");
    expect(dailyContent).toContain("source: plugin");
  });

  it("uses custom subfolder from memory-mason.json when env vault path is set", () => {
    const cwd = createTempDir("memory-mason-cwd-");
    const homeDir = createTempDir("memory-mason-home-");
    const vaultPath = createTempDir("memory-mason-vault-");

    writeText(
      path.join(cwd, "memory-mason.json"),
      JSON.stringify({ vaultPath: "/ignored", subfolder: "my-brain" }),
    );

    const result = runScript("user-prompt-submit.js", {
      payload: { hookEventName: "user-prompt-submit", cwd, prompt: "remember this" },
      cwd,
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
    });

    expect(result.status).toBe(0);
    expect(
      fs.readFileSync(buildDailyChunkPath(vaultPath, "my-brain", today(), 1), "utf-8"),
    ).toContain("remember this");
    expect(fs.existsSync(buildDailyFilePath(vaultPath, "ai-knowledge", today()))).toBe(false);
  });

  it("skips when prompt text is empty", () => {
    const homeDir = createTempDir("memory-mason-home-");
    const vaultPath = createTempDir("memory-mason-vault-");

    const result = runScript("user-prompt-submit.js", {
      payload: { hookEventName: "user-prompt-submit", cwd: hooksRoot },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
    });

    expect(result.status).toBe(0);
    expect(fs.existsSync(buildDailyFilePath(vaultPath, "ai-knowledge", today()))).toBe(false);
  });

  it("reports missing config when prompt exists but vault config does not", () => {
    const homeDir = createTempDir("memory-mason-home-");

    const result = runScript("user-prompt-submit.js", {
      payload: { hookEventName: "user-prompt-submit", cwd: hooksRoot, prompt: "capture this" },
      env: buildEnv(homeDir),
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain(
      "memory-mason.json not found and MEMORY_MASON_VAULT_PATH is not set",
    );
  });

  it("does not backfill assistant turns on prompt submit after transcript grows", () => {
    const homeDir = createTempDir("memory-mason-home-");
    const vaultPath = createTempDir("memory-mason-vault-");
    const transcriptDir = createTempDir("memory-mason-transcript-");
    const transcriptPath = path.join(transcriptDir, "session.jsonl");

    writeText(transcriptPath, buildTranscript(2));

    runScript("user-prompt-submit.js", {
      payload: {
        hookEventName: "user-prompt-submit",
        cwd: hooksRoot,
        prompt: "first user prompt",
        transcript_path: transcriptPath,
        session_id: "session-anchor",
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
    });

    const dailyPathAfterFirst = buildDailyChunkPath(vaultPath, "ai-knowledge", today(), 1);
    const contentAfterFirst = fs.readFileSync(dailyPathAfterFirst, "utf-8");
    expect(contentAfterFirst).not.toContain("AssistantReply");
    expect(contentAfterFirst).toContain("first user prompt");

    writeText(transcriptPath, buildTranscript(4));

    const result = runScript("user-prompt-submit.js", {
      payload: {
        hookEventName: "user-prompt-submit",
        cwd: hooksRoot,
        prompt: "second user prompt",
        transcript_path: transcriptPath,
        session_id: "session-anchor",
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
    });

    const dailyContent = fs.readFileSync(dailyPathAfterFirst, "utf-8");

    expect(result.status).toBe(0);
    expect(dailyContent).toContain("second user prompt");
    expect(dailyContent).not.toContain("AssistantReply");
    expect(dailyContent).not.toContain("assistant turn 3");
  });

  it("skips assistant dump on first call even when transcript has historical turns", () => {
    const homeDir = createTempDir("memory-mason-home-");
    const vaultPath = createTempDir("memory-mason-vault-");
    const transcriptDir = createTempDir("memory-mason-transcript-");
    const transcriptPath = path.join(transcriptDir, "session.jsonl");

    writeText(transcriptPath, buildTranscript(10));

    const result = runScript("user-prompt-submit.js", {
      payload: {
        hookEventName: "user-prompt-submit",
        cwd: hooksRoot,
        prompt: "new prompt after long history",
        transcript_path: transcriptPath,
        session_id: "session-noorphan",
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
    });

    const dailyContent = fs.readFileSync(
      buildDailyChunkPath(vaultPath, "ai-knowledge", today(), 1),
      "utf-8",
    );

    expect(result.status).toBe(0);
    expect(dailyContent).not.toContain("AssistantReply");
    expect(dailyContent).toContain("new prompt after long history");
  });

  it("keeps first and second prompts adjacent without inserting assistant backfill", () => {
    const homeDir = createTempDir("memory-mason-home-");
    const vaultPath = createTempDir("memory-mason-vault-");
    const transcriptDir = createTempDir("memory-mason-transcript-");
    const transcriptPath = path.join(transcriptDir, "session.jsonl");

    writeText(transcriptPath, buildTranscript(2));

    runScript("user-prompt-submit.js", {
      payload: {
        hookEventName: "user-prompt-submit",
        cwd: hooksRoot,
        prompt: "second prompt",
        transcript_path: transcriptPath,
        session_id: "session-dedup",
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
    });

    writeText(transcriptPath, buildTranscript(4));

    runScript("user-prompt-submit.js", {
      payload: {
        hookEventName: "user-prompt-submit",
        cwd: hooksRoot,
        prompt: "third prompt",
        transcript_path: transcriptPath,
        session_id: "session-dedup",
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
    });

    const dailyPath = buildDailyChunkPath(vaultPath, "ai-knowledge", today(), 1);
    const dailyContent = fs.readFileSync(dailyPath, "utf-8");

    expect(dailyContent).toContain("second prompt");
    expect(dailyContent).toContain("third prompt");
    expect(dailyContent).not.toContain("AssistantReply");
    expect(dailyContent).not.toContain("assistant turn 3");
  });

  it("skips assistant capture when transcript_path is absent", () => {
    const homeDir = createTempDir("memory-mason-home-");
    const vaultPath = createTempDir("memory-mason-vault-");

    const result = runScript("user-prompt-submit.js", {
      payload: {
        hookEventName: "user-prompt-submit",
        cwd: hooksRoot,
        prompt: "no transcript here",
        session_id: "session-xyz",
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
    });

    const dailyContent = fs.readFileSync(
      buildDailyChunkPath(vaultPath, "ai-knowledge", today(), 1),
      "utf-8",
    );

    expect(result.status).toBe(0);
    expect(dailyContent).not.toContain("AssistantReply");
    expect(dailyContent).toContain("no transcript here");
  });

  it("skips assistant capture when session_id is absent", () => {
    const homeDir = createTempDir("memory-mason-home-");
    const vaultPath = createTempDir("memory-mason-vault-");
    const transcriptDir = createTempDir("memory-mason-transcript-");
    const transcriptPath = path.join(transcriptDir, "session.jsonl");

    writeText(transcriptPath, buildTranscript(2));

    const result = runScript("user-prompt-submit.js", {
      payload: {
        hookEventName: "user-prompt-submit",
        cwd: hooksRoot,
        prompt: "no session id",
        transcript_path: transcriptPath,
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
    });

    const dailyContent = fs.readFileSync(
      buildDailyChunkPath(vaultPath, "ai-knowledge", today(), 1),
      "utf-8",
    );

    expect(result.status).toBe(0);
    expect(dailyContent).not.toContain("AssistantReply");
  });

  it("skips assistant capture when transcript file does not exist", () => {
    const homeDir = createTempDir("memory-mason-home-");
    const vaultPath = createTempDir("memory-mason-vault-");

    const result = runScript("user-prompt-submit.js", {
      payload: {
        hookEventName: "user-prompt-submit",
        cwd: hooksRoot,
        prompt: "missing transcript file",
        transcript_path: path.join(hooksRoot, "does-not-exist.jsonl"),
        session_id: "session-missing",
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
    });

    const dailyContent = fs.readFileSync(
      buildDailyChunkPath(vaultPath, "ai-knowledge", today(), 1),
      "utf-8",
    );

    expect(result.status).toBe(0);
    expect(dailyContent).not.toContain("AssistantReply");
  });
});

describe("run - mm command filtering", () => {
  const runWithPrompt = (prompt) => {
    const writerPath = require.resolve("../lib/writer");
    const userPromptSubmitPath = require.resolve("../user-prompt-submit");

    delete require.cache[userPromptSubmitPath];
    delete require.cache[writerPath];

    const writer = require("../lib/writer");
    const appendToDailySpy = vi.spyOn(writer, "appendToDaily");
    const isolatedUserPromptSubmit = require("../user-prompt-submit");

    const homeDir = createTempDir("memory-mason-home-");
    const vaultPath = createTempDir("memory-mason-vault-");
    const payload = JSON.stringify({
      hookEventName: "user-prompt-submit",
      cwd: hooksRoot,
      prompt,
    });
    const buf = Buffer.from(payload);
    let rc = 0;

    const rawStdin = isolatedUserPromptSubmit.readStdin({
      readSync(_fd, chunk) {
        if (rc === 0) {
          rc++;
          buf.copy(chunk);
          return buf.length;
        }
        return 0;
      },
    });

    const result = isolatedUserPromptSubmit.run(rawStdin, {
      cwd: hooksRoot,
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
      homedir: homeDir,
    });

    return { result, appendToDailySpy };
  };

  afterEach(() => {
    vi.restoreAllMocks();
    delete require.cache[require.resolve("../user-prompt-submit")];
    delete require.cache[require.resolve("../lib/writer")];
  });

  it("returns status 0 and skips vault write for /mmc prompt", () => {
    const { result, appendToDailySpy } = runWithPrompt("/mmc");

    expect(result.status).toBe(0);
    expect(appendToDailySpy).not.toHaveBeenCalled();
  });

  it("returns status 0 and skips vault write for /mmq prompt", () => {
    const { result, appendToDailySpy } = runWithPrompt("/mmq");

    expect(result.status).toBe(0);
    expect(appendToDailySpy).not.toHaveBeenCalled();
  });

  it("returns status 0 and skips vault write for /mml prompt", () => {
    const { result, appendToDailySpy } = runWithPrompt("/mml");

    expect(result.status).toBe(0);
    expect(appendToDailySpy).not.toHaveBeenCalled();
  });

  it("returns status 0 and skips vault write for /mms prompt", () => {
    const { result, appendToDailySpy } = runWithPrompt("/mms");

    expect(result.status).toBe(0);
    expect(appendToDailySpy).not.toHaveBeenCalled();
  });

  it("returns status 0 and skips vault write for /mma prompt", () => {
    const { result, appendToDailySpy } = runWithPrompt("/mma");

    expect(result.status).toBe(0);
    expect(appendToDailySpy).not.toHaveBeenCalled();
  });

  it("returns status 0 and skips vault write for /mmsetup prompt", () => {
    const { result, appendToDailySpy } = runWithPrompt("/mmsetup");

    expect(result.status).toBe(0);
    expect(appendToDailySpy).not.toHaveBeenCalled();
  });

  it("does NOT skip for regular prompts starting with /m but not /mm", () => {
    const { result, appendToDailySpy } = runWithPrompt("/migrate notes");

    expect(result.status).toBe(0);
    expect(appendToDailySpy).toHaveBeenCalledTimes(1);
  });

  it("does NOT skip for prompts that contain /mmc but do not start with it", () => {
    const { result, appendToDailySpy } = runWithPrompt("please run /mmc later");

    expect(result.status).toBe(0);
    expect(appendToDailySpy).toHaveBeenCalledTimes(1);
  });
});

describe("run - mm suppression state management", () => {
  it("sets mmSuppressed=true in capture state when /mm prompt is received", () => {
    const homeDir = createTempDir("memory-mason-home-");
    const vaultPath = createTempDir("memory-mason-vault-");

    const result = runScript("user-prompt-submit.js", {
      payload: {
        hookEventName: "user-prompt-submit",
        cwd: hooksRoot,
        prompt: "/mmc",
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
    });

    const statePath = resolveCaptureStatePath(vaultPath, "ai-knowledge");
    const state = JSON.parse(fs.readFileSync(statePath, "utf-8"));

    expect(result.status).toBe(0);
    expect(fs.existsSync(buildDailyChunkPath(vaultPath, "ai-knowledge", today(), 1))).toBe(false);
    expect(state.mmSuppressed).toBe(true);
  });

  it("saves updated capture state when setting mmSuppressed", () => {
    const homeDir = createTempDir("memory-mason-home-");
    const vaultPath = createTempDir("memory-mason-vault-");
    const statePath = resolveCaptureStatePath(vaultPath, "ai-knowledge");

    expect(fs.existsSync(statePath)).toBe(false);

    const result = runScript("user-prompt-submit.js", {
      payload: {
        hookEventName: "user-prompt-submit",
        cwd: hooksRoot,
        prompt: "/mmq summarize",
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
    });

    const state = JSON.parse(fs.readFileSync(statePath, "utf-8"));

    expect(result.status).toBe(0);
    expect(fs.existsSync(statePath)).toBe(true);
    expect(state.mmSuppressed).toBe(true);
  });

  it("clears mmSuppressed before processing non-/mm prompt", () => {
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

    const result = runScript("user-prompt-submit.js", {
      payload: {
        hookEventName: "user-prompt-submit",
        cwd: hooksRoot,
        prompt: "normal prompt after mm",
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
    });

    const dailyContent = fs.readFileSync(
      buildDailyChunkPath(vaultPath, "ai-knowledge", today(), 1),
      "utf-8",
    );
    const state = JSON.parse(fs.readFileSync(statePath, "utf-8"));

    expect(result.status).toBe(0);
    expect(dailyContent).toContain("normal prompt after mm");
    expect(state.mmSuppressed).toBe(false);
  });
});

describe("user-prompt-submit.js readStdin", () => {
  it("returns valid JSON string from mocked fd 0", () => {
    const payload = JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "hello" });
    const buf = Buffer.from(payload);
    let rc = 0;
    expect(
      userPromptSubmit.readStdin({
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
    expect(userPromptSubmit.readStdin({ readSync: () => 0 })).toBe("");
  });
});

describe("user-prompt-submit.js main", () => {
  it("calls exit with status 0 after writing prompt", () => {
    const homeDir = createTempDir("mm-home-");
    const vaultPath = createTempDir("mm-vault-");
    const cwd = createTempDir("mm-cwd-");
    const payload = JSON.stringify({
      hook_event_name: "UserPromptSubmit",
      cwd,
      prompt: "main test",
    });
    const buf = Buffer.from(payload);
    let rc = 0;
    const writes = [];
    const errors = [];
    let exitCode = null;
    userPromptSubmit.main({
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
      cwd,
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
      homedir: homeDir,
    });
    expect(exitCode).toBe(0);
    expect(errors).toHaveLength(0);
  });

  it("writes stderr when config is missing", () => {
    const homeDir = createTempDir("mm-home-");
    const payload = JSON.stringify({
      hook_event_name: "UserPromptSubmit",
      cwd: createTempDir("mm-nocfg-"),
      prompt: "test",
    });
    const buf = Buffer.from(payload);
    let rc = 0;
    const errors = [];
    let exitCode = null;
    userPromptSubmit.main({
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
    expect(errors.join("")).toContain("memory-mason.json not found");
  });

  it("falls back to process stdout/stderr when io functions are missing", () => {
    const homeDir = createTempDir("mm-home-");
    const vaultPath = createTempDir("mm-vault-");
    const payload = JSON.stringify({ hook_event_name: "UserPromptSubmit", cwd: homeDir });
    const buf = Buffer.from(payload);
    let rc = 0;
    const result = userPromptSubmit.main({
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

describe("user-prompt-submit.js runtime fallback branches", () => {
  it("falls back to process defaults when runtime properties are invalid", () => {
    const result = userPromptSubmit.run(
      JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "test" }),
      { env: null, cwd: 123, homedir: 42 },
    );
    expect(result.status).toBe(0);
  });

  it("uses fallbackCwd when input has no cwd", () => {
    const homeDir = createTempDir("mm-home-");
    const vaultPath = createTempDir("mm-vault-");
    const result = userPromptSubmit.run(
      JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "test" }),
      {
        env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
        cwd: createTempDir("mm-fb-"),
        homedir: homeDir,
      },
    );
    expect(result.status).toBe(0);
  });
});
