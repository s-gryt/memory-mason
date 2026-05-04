"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  buildDailyChunkPath,
  buildDailyFilePath,
  buildKnowledgeIndexPath,
} = require("../lib/vault");
const { resolveCaptureStatePath } = require("../lib/capture-state");
const sessionStart = require("../session-start");
const userPromptSubmit = require("../user-prompt-submit");
const postToolUse = require("../post-tool-use");
const preCompact = require("../pre-compact");
const sessionEnd = require("../session-end");
const installCopilotHooks = require("../install-copilot-hooks");
const uninstallCopilotHooks = require("../uninstall-copilot-hooks");

const hooksRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(hooksRoot, "..");
const tempDirs = [];
const scriptModules = {
  "session-start.js": sessionStart,
  "user-prompt-submit.js": userPromptSubmit,
  "post-tool-use.js": postToolUse,
  "pre-compact.js": preCompact,
  "session-end.js": sessionEnd,
  "install-copilot-hooks.js": installCopilotHooks,
  "uninstall-copilot-hooks.js": uninstallCopilotHooks,
};
const entrypointConfigReaderModules = [
  { scriptName: "session-start.js", scriptModule: sessionStart },
  { scriptName: "user-prompt-submit.js", scriptModule: userPromptSubmit },
  { scriptName: "post-tool-use.js", scriptModule: postToolUse },
  { scriptName: "pre-compact.js", scriptModule: preCompact },
  { scriptName: "session-end.js", scriptModule: sessionEnd },
];
const copilotHookDefinitions = [
  {
    fileName: "session-start.json",
    eventName: "SessionStart",
    scriptName: "session-start.js",
    timeout: 10,
  },
  {
    fileName: "user-prompt-submit.json",
    eventName: "UserPromptSubmit",
    scriptName: "user-prompt-submit.js",
    timeout: 5,
  },
  {
    fileName: "post-tool-use.json",
    eventName: "PostToolUse",
    scriptName: "post-tool-use.js",
    timeout: 5,
  },
  {
    fileName: "pre-compact.json",
    eventName: "PreCompact",
    scriptName: "pre-compact.js",
    timeout: 15,
  },
  { fileName: "stop.json", eventName: "Stop", scriptName: "session-end.js", timeout: 15 },
  {
    fileName: "session-end.json",
    eventName: "SessionEnd",
    scriptName: "session-end.js",
    timeout: 15,
  },
];

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

const withMemoryMasonCaptureMode = (value, callback) => {
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

const runScript = (scriptName, options = {}) => {
  const scriptModule = scriptModules[scriptName];
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

  return scriptName === "install-copilot-hooks.js" || scriptName === "uninstall-copilot-hooks.js"
    ? scriptModule.run(runtime)
    : scriptModule.run(stdinText, runtime);
};

const writeText = (filePath, content) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
};

const assertInstalledCopilotHook = (hooksDirectory, hookRoot, definition) => {
  const installedPath = path.join(hooksDirectory, definition.fileName);
  const installed = JSON.parse(fs.readFileSync(installedPath, "utf-8"));
  const entries = installed.hooks[definition.eventName];

  expect(Array.isArray(entries)).toBe(true);
  expect(entries).toHaveLength(1);
  expect(entries[0].type).toBe("command");
  expect(entries[0].timeout).toBe(definition.timeout);
  expect(entries[0].command).toBe(
    `node "${path.join(hookRoot, definition.scriptName).replace(/\\/g, "/")}"`,
  );
};

const buildTranscript = (turnCount, firstUserContent = "user turn") =>
  Array.from({ length: turnCount }, (_, index) => {
    const isUser = index % 2 === 0;
    const role = isUser ? "user" : "assistant";
    const content = isUser && index === 0 ? firstUserContent : `${role} turn ${index}`;
    return JSON.stringify({ message: { role, content } });
  }).join("\n");

const buildVsCodeTranscript = (turns) => {
  const entries = [
    {
      type: "session.start",
      data: {
        sessionId: "session-1",
        version: 1,
        producer: "copilot-agent",
        copilotVersion: "0.0.0",
        vscodeVersion: "1.0.0",
        startTime: "2025-01-01T00:00:00.000Z",
        context: { cwd: hooksRoot },
      },
    },
  ].concat(
    turns.flatMap((turn, turnIndex) => {
      const userEntries = [
        {
          type: "user.message",
          data: { content: turn.user, attachments: [] },
        },
      ];

      if (typeof turn.assistant !== "string") {
        return userEntries;
      }

      return userEntries.concat([
        {
          type: "assistant.turn_start",
          data: { turnId: `${turnIndex}.0` },
        },
        {
          type: "assistant.message",
          data: { messageId: `message-${turnIndex}`, content: turn.assistant, toolRequests: [] },
        },
        {
          type: "assistant.turn_end",
          data: { turnId: `${turnIndex}.0` },
        },
      ]);
    }),
  );

  return entries
    .map((entry, index) =>
      JSON.stringify({
        ...entry,
        id: `entry-${index}`,
        timestamp: `2025-01-01T00:00:${String(index).padStart(2, "0")}.000Z`,
        parentId: index === 0 ? null : `entry-${index - 1}`,
      }),
    )
    .join("\n");
};

const today = () => {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

const yesterday = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe("entrypoint config readers", () => {
  entrypointConfigReaderModules.forEach(({ scriptName, scriptModule }) => {
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
});

describe("session-start.js", () => {
  it("reads memory-mason.json and returns KB context with today log", () => {
    const cwd = createTempDir("memory-mason-cwd-");
    const vaultPath = createTempDir("memory-mason-vault-");
    const configPath = path.join(cwd, "memory-mason.json");
    const indexPath = buildKnowledgeIndexPath(vaultPath, "ai-knowledge");
    const dailyPath = buildDailyFilePath(vaultPath, "ai-knowledge", today());

    writeText(configPath, JSON.stringify({ vaultPath, subfolder: "ai-knowledge" }));
    writeText(indexPath, "# Index\n\n[[Topic]]");
    writeText(dailyPath, "# Daily Log\n\nrecent line");

    const result = runScript("session-start.js", { payload: { cwd }, cwd, env: buildEnv(cwd) });
    const parsed = JSON.parse(result.stdout);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(parsed.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("[[Topic]]");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("recent line");
  });

  it("falls back to yesterday log when today log missing", () => {
    const homeDir = createTempDir("memory-mason-home-");
    const vaultPath = createTempDir("memory-mason-vault-");
    const dailyPath = buildDailyFilePath(vaultPath, "ai-knowledge", yesterday());

    writeText(dailyPath, "# Daily Log\n\nyesterday line");

    const result = runScript("session-start.js", {
      payload: { cwd: hooksRoot },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
    });
    const parsed = JSON.parse(result.stdout);

    expect(result.status).toBe(0);
    expect(parsed.hookSpecificOutput.additionalContext).toContain("yesterday line");
  });

  it("uses empty placeholders when KB files are missing", () => {
    const homeDir = createTempDir("memory-mason-home-");
    const vaultPath = createTempDir("memory-mason-vault-");

    const result = runScript("session-start.js", {
      payload: { cwd: hooksRoot },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
    });
    const parsed = JSON.parse(result.stdout);

    expect(result.status).toBe(0);
    expect(parsed.hookSpecificOutput.additionalContext).toContain(
      "(empty - no articles compiled yet)",
    );
    expect(parsed.hookSpecificOutput.additionalContext).toContain("(no recent daily log)");
  });

  it("uses global config fallback when project config and env var are absent", () => {
    const cwd = createTempDir("memory-mason-cwd-");
    const homeDir = createTempDir("memory-mason-home-");
    const vaultPath = createTempDir("memory-mason-vault-");
    const dailyPath = buildDailyFilePath(vaultPath, "global-brain", today());

    writeText(
      path.join(homeDir, ".memory-mason", "config.json"),
      JSON.stringify({ vaultPath, subfolder: "global-brain" }),
    );
    writeText(dailyPath, "# Daily Log\n\nfrom global config");

    const result = runScript("session-start.js", { payload: { cwd }, cwd, env: buildEnv(homeDir) });
    const parsed = JSON.parse(result.stdout);

    expect(result.status).toBe(0);
    expect(parsed.hookSpecificOutput.additionalContext).toContain("from global config");
  });

  it("uses .env fallback when project config and env var are absent", () => {
    const cwd = createTempDir("memory-mason-cwd-");
    const homeDir = createTempDir("memory-mason-home-");
    const vaultPath = createTempDir("memory-mason-vault-");
    const dailyPath = buildDailyFilePath(vaultPath, "dotenv-brain", today());

    writeText(
      path.join(cwd, ".env"),
      `MEMORY_MASON_VAULT_PATH=${vaultPath}\nMEMORY_MASON_SUBFOLDER=dotenv-brain`,
    );
    writeText(dailyPath, "# Daily Log\n\nfrom dotenv config");

    const result = runScript("session-start.js", { payload: { cwd }, cwd, env: buildEnv(homeDir) });
    const parsed = JSON.parse(result.stdout);

    expect(result.status).toBe(0);
    expect(parsed.hookSpecificOutput.additionalContext).toContain("from dotenv config");
  });

  it("reports invalid stdin to stderr", () => {
    const homeDir = createTempDir("memory-mason-home-");
    const vaultPath = createTempDir("memory-mason-vault-");

    const result = runScript("session-start.js", {
      stdinText: "{not-json",
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("invalid JSON in stdin: {not-json");
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
      "Memory Mason config not found. Checked MEMORY_MASON_VAULT_PATH, project .env, project memory-mason.json, ~/.memory-mason/.env, and ~/.memory-mason/config.json.",
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

describe("post-tool-use.js", () => {
  it("writes tool output for copilot vscode payloads", () => {
    withMemoryMasonCaptureMode("full", () => {
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
  });

  it("writes structured tool output for claude payloads", () => {
    withMemoryMasonCaptureMode("full", () => {
      const homeDir = createTempDir("memory-mason-home-");
      const vaultPath = createTempDir("memory-mason-vault-");

      const result = runScript("post-tool-use.js", {
        payload: {
          hook_event_name: "PostToolUse",
          cwd: hooksRoot,
          tool_name: "Write",
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
  });

  it("writes text blocks for structured claude tool outputs", () => {
    withMemoryMasonCaptureMode("full", () => {
      const homeDir = createTempDir("memory-mason-home-");
      const vaultPath = createTempDir("memory-mason-vault-");

      const result = runScript("post-tool-use.js", {
        payload: {
          hook_event_name: "PostToolUse",
          cwd: hooksRoot,
          tool_name: "apply_patch",
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
  });

  it("writes tool output for copilot cli payloads", () => {
    withMemoryMasonCaptureMode("full", () => {
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
  });

  it("writes tool output for codex payloads", () => {
    withMemoryMasonCaptureMode("full", () => {
      const homeDir = createTempDir("memory-mason-home-");
      const vaultPath = createTempDir("memory-mason-vault-");

      runScript("post-tool-use.js", {
        payload: {
          hook_event_name: "post_tool_use",
          turn_id: "turn-1",
          cwd: hooksRoot,
          tool_name: "apply_patch",
          tool_result: "codex result",
        },
        env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
      });

      expect(
        fs.readFileSync(buildDailyChunkPath(vaultPath, "ai-knowledge", today(), 1), "utf-8"),
      ).toContain("codex result");
    });
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
    withMemoryMasonCaptureMode("full", () => {
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
      expect(JSON.parse(fs.readFileSync(statePath, "utf-8")).lastCapture.source).toBe(
        "pre-compact",
      );
    });
  });

  it("writes full transcript without turn or character truncation", () => {
    withMemoryMasonCaptureMode("full", () => {
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
  });

  it("skips duplicate capture within duplicate window", () => {
    withMemoryMasonCaptureMode("full", () => {
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

describe("session-end.js", () => {
  it("skips when invoked by another Memory Mason command", () => {
    const homeDir = createTempDir("memory-mason-home-");
    const vaultPath = createTempDir("memory-mason-vault-");
    const transcriptPath = path.join(createTempDir("memory-mason-transcript-"), "session.jsonl");

    writeText(transcriptPath, buildTranscript(2));

    const result = runScript("session-end.js", {
      payload: { hook_event_name: "session_end", cwd: hooksRoot, transcript_path: transcriptPath },
      env: buildEnv(homeDir, {
        MEMORY_MASON_VAULT_PATH: vaultPath,
        MEMORY_MASON_INVOKED_BY: "mmq",
      }),
    });

    expect(result.status).toBe(0);
    expect(fs.existsSync(buildDailyFilePath(vaultPath, "ai-knowledge", today()))).toBe(false);
  });

  it("captures assistant replies on Stop and skips duplicates for unchanged transcript", () => {
    const homeDir = createTempDir("memory-mason-home-");
    const vaultPath = createTempDir("memory-mason-vault-");
    const transcriptPath = path.join(createTempDir("memory-mason-transcript-"), "session.jsonl");

    writeText(transcriptPath, buildTranscript(1, "first prompt turn"));

    runScript("user-prompt-submit.js", {
      payload: {
        hookEventName: "user-prompt-submit",
        cwd: hooksRoot,
        prompt: "first prompt",
        transcript_path: transcriptPath,
        session_id: "session-stop-order",
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
    });

    const dailyPath = buildDailyChunkPath(vaultPath, "ai-knowledge", today(), 1);
    const afterFirstPrompt = fs.readFileSync(dailyPath, "utf-8");
    expect(afterFirstPrompt).toContain("first prompt");
    expect(afterFirstPrompt).not.toContain("AssistantReply");

    writeText(transcriptPath, buildTranscript(2, "first prompt turn"));

    runScript("session-end.js", {
      payload: {
        hookEventName: "Stop",
        cwd: hooksRoot,
        transcript_path: transcriptPath,
        session_id: "session-stop-order",
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
    });

    const afterFirstStop = fs.readFileSync(dailyPath, "utf-8");
    expect(afterFirstStop).toContain("AssistantReply");
    expect(afterFirstStop).toContain("assistant turn 1");
    expect(afterFirstStop.indexOf("first prompt")).toBeLessThan(
      afterFirstStop.indexOf("assistant turn 1"),
    );

    writeText(transcriptPath, buildTranscript(3, "first prompt turn"));

    runScript("user-prompt-submit.js", {
      payload: {
        hookEventName: "user-prompt-submit",
        cwd: hooksRoot,
        prompt: "second prompt",
        transcript_path: transcriptPath,
        session_id: "session-stop-order",
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
    });

    const afterSecondPrompt = fs.readFileSync(dailyPath, "utf-8");
    expect(afterSecondPrompt).toContain("second prompt");
    expect(afterSecondPrompt.split("assistant turn 1").length - 1).toBe(1);
    expect(afterSecondPrompt).not.toContain("assistant turn 3");

    writeText(transcriptPath, buildTranscript(4, "first prompt turn"));

    runScript("session-end.js", {
      payload: {
        hook_event_name: "stop",
        cwd: hooksRoot,
        transcript_path: transcriptPath,
        session_id: "session-stop-order",
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
    });

    const afterSecondStop = fs.readFileSync(dailyPath, "utf-8");
    expect(afterSecondStop).toContain("assistant turn 3");
    expect(afterSecondStop.indexOf("second prompt")).toBeLessThan(
      afterSecondStop.indexOf("assistant turn 3"),
    );

    runScript("session-end.js", {
      payload: {
        hook_event_name: "stop",
        cwd: hooksRoot,
        transcript_path: transcriptPath,
        session_id: "session-stop-order",
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
    });

    const afterDuplicateStop = fs.readFileSync(dailyPath, "utf-8");
    expect(afterDuplicateStop).toBe(afterSecondStop);
    expect(afterDuplicateStop.split("assistant turn 3").length - 1).toBe(1);
  });

  it("captures first assistant reply on Stop when prompt submit could not anchor transcript count", () => {
    const homeDir = createTempDir("memory-mason-home-");
    const vaultPath = createTempDir("memory-mason-vault-");
    const transcriptPath = path.join(createTempDir("memory-mason-transcript-"), "session.jsonl");

    runScript("user-prompt-submit.js", {
      payload: {
        hook_event_name: "UserPromptSubmit",
        cwd: hooksRoot,
        prompt: "first prompt",
        transcript_path: transcriptPath,
        session_id: "session-stop-first-turn",
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
    });

    writeText(transcriptPath, buildTranscript(2, "first prompt turn"));

    const result = runScript("session-end.js", {
      payload: {
        hook_event_name: "Stop",
        cwd: hooksRoot,
        transcript_path: transcriptPath,
        session_id: "session-stop-first-turn",
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
    });

    const dailyContent = fs.readFileSync(
      buildDailyChunkPath(vaultPath, "ai-knowledge", today(), 1),
      "utf-8",
    );

    expect(result.status).toBe(0);
    expect(dailyContent).toContain("first prompt");
    expect(dailyContent).toContain("assistant turn 1");
    expect(dailyContent.indexOf("first prompt")).toBeLessThan(
      dailyContent.indexOf("assistant turn 1"),
    );
  });

  it("uses last_assistant_message fallback on Stop without replaying duplicate assistant replies later", () => {
    const homeDir = createTempDir("memory-mason-home-");
    const vaultPath = createTempDir("memory-mason-vault-");
    const transcriptPath = path.join(createTempDir("memory-mason-transcript-"), "session.jsonl");

    writeText(transcriptPath, buildTranscript(1, "first prompt turn"));

    runScript("user-prompt-submit.js", {
      payload: {
        hook_event_name: "UserPromptSubmit",
        cwd: hooksRoot,
        prompt: "first prompt",
        transcript_path: transcriptPath,
        session_id: "session-stop-payload-fallback",
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
    });

    runScript("session-end.js", {
      payload: {
        hook_event_name: "Stop",
        cwd: hooksRoot,
        transcript_path: transcriptPath,
        session_id: "session-stop-payload-fallback",
        last_assistant_message: "assistant turn 1",
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
    });

    writeText(transcriptPath, buildTranscript(2, "first prompt turn"));

    const result = runScript("session-end.js", {
      payload: {
        hook_event_name: "Stop",
        cwd: hooksRoot,
        transcript_path: transcriptPath,
        session_id: "session-stop-payload-fallback",
        last_assistant_message: "assistant turn 1",
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
    });

    const dailyContent = fs.readFileSync(
      buildDailyChunkPath(vaultPath, "ai-knowledge", today(), 1),
      "utf-8",
    );

    expect(result.status).toBe(0);
    expect(dailyContent.split("assistant turn 1").length - 1).toBe(1);
  });

  it("is a no-op on first Stop when transcript is empty and payload has no assistant message", () => {
    const homeDir = createTempDir("memory-mason-home-");
    const vaultPath = createTempDir("memory-mason-vault-");
    const transcriptPath = path.join(createTempDir("memory-mason-transcript-"), "session.jsonl");

    writeText(transcriptPath, "");

    const result = runScript("session-end.js", {
      payload: {
        hook_event_name: "Stop",
        cwd: hooksRoot,
        transcript_path: transcriptPath,
        session_id: "session-stop-empty-first",
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
    });

    expect(result.status).toBe(0);
    expect(fs.existsSync(buildDailyFilePath(vaultPath, "ai-knowledge", today()))).toBe(false);
  });

  it("captures assistant reply from VS Code transcript entries on Stop", () => {
    const homeDir = createTempDir("memory-mason-home-");
    const vaultPath = createTempDir("memory-mason-vault-");
    const transcriptPath = path.join(createTempDir("memory-mason-transcript-"), "session.jsonl");

    writeText(transcriptPath, buildVsCodeTranscript([{ user: "first prompt" }]));

    runScript("user-prompt-submit.js", {
      payload: {
        hook_event_name: "UserPromptSubmit",
        cwd: hooksRoot,
        prompt: "first prompt",
        transcript_path: transcriptPath,
        session_id: "session-stop-vscode-transcript",
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
    });

    writeText(
      transcriptPath,
      buildVsCodeTranscript([{ user: "first prompt", assistant: "assistant turn 1" }]),
    );

    const result = runScript("session-end.js", {
      payload: {
        hook_event_name: "Stop",
        cwd: hooksRoot,
        transcript_path: transcriptPath,
        session_id: "session-stop-vscode-transcript",
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
    });

    const dailyContent = fs.readFileSync(
      buildDailyChunkPath(vaultPath, "ai-knowledge", today(), 1),
      "utf-8",
    );

    expect(result.status).toBe(0);
    expect(dailyContent).toContain("first prompt");
    expect(dailyContent).toContain("assistant turn 1");
  });

  it("writes transcript from explicit transcript path", () => {
    withMemoryMasonCaptureMode("full", () => {
      const homeDir = createTempDir("memory-mason-home-");
      const vaultPath = createTempDir("memory-mason-vault-");
      const transcriptPath = path.join(createTempDir("memory-mason-transcript-"), "session.jsonl");

      writeText(transcriptPath, buildTranscript(2));

      const result = runScript("session-end.js", {
        payload: {
          hook_event_name: "session_end",
          cwd: hooksRoot,
          transcript_path: transcriptPath,
          session_id: "session-1",
          source: "stop",
        },
        env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
      });

      const dailyPath = buildDailyChunkPath(vaultPath, "ai-knowledge", today(), 1);
      expect(result.status).toBe(0);
      expect(fs.readFileSync(dailyPath, "utf-8")).toContain("session-1 / stop");
    });
  });

  it("writes full transcript from explicit path without truncation", () => {
    withMemoryMasonCaptureMode("full", () => {
      const homeDir = createTempDir("memory-mason-home-");
      const vaultPath = createTempDir("memory-mason-vault-");
      const transcriptPath = path.join(createTempDir("memory-mason-transcript-"), "session.jsonl");
      const longFirstTurn = `session-end-first-user-${"y".repeat(17000)}`;

      writeText(transcriptPath, buildTranscript(40, longFirstTurn));

      const result = runScript("session-end.js", {
        payload: {
          hook_event_name: "session_end",
          cwd: hooksRoot,
          transcript_path: transcriptPath,
          session_id: "session-full-session-end",
          source: "stop",
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
  });

  it("falls back to codex session files when transcript path missing", () => {
    withMemoryMasonCaptureMode("full", () => {
      const homeDir = createTempDir("memory-mason-home-");
      const vaultPath = createTempDir("memory-mason-vault-");
      const codexFile = path.join(
        homeDir,
        ".codex",
        "sessions",
        "session-2",
        "session-2-log.jsonl",
      );

      writeText(codexFile, buildTranscript(2));

      runScript("session-end.js", {
        payload: {
          hook_event_name: "session_end",
          turn_id: "turn-1",
          cwd: hooksRoot,
          session_id: "session-2",
        },
        env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
      });

      expect(
        fs.readFileSync(buildDailyChunkPath(vaultPath, "ai-knowledge", today(), 1), "utf-8"),
      ).toContain("session-2 / codex");
    });
  });

  it("falls back to Copilot CLI session-state content", () => {
    withMemoryMasonCaptureMode("full", () => {
      const homeDir = createTempDir("memory-mason-home-");
      const vaultPath = createTempDir("memory-mason-vault-");
      const sessionDir = path.join(homeDir, ".copilot", "session-state", "session-a");
      const cwd = createTempDir("memory-mason-cwd-");
      const transcriptPath = path.join(sessionDir, "state.jsonl");

      writeText(transcriptPath, buildTranscript(2, cwd));

      runScript("session-end.js", {
        payload: {
          timestamp: "2026-04-27T10:00:00.000Z",
          cwd,
        },
        env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
      });

      expect(
        fs.readFileSync(buildDailyChunkPath(vaultPath, "ai-knowledge", today(), 1), "utf-8"),
      ).toContain("unknown / copilot-cli");
    });
  });

  it("skips when Copilot CLI session-state is missing", () => {
    const homeDir = createTempDir("memory-mason-home-");
    const vaultPath = createTempDir("memory-mason-vault-");

    const result = runScript("session-end.js", {
      payload: {
        timestamp: "2026-04-27T10:00:00.000Z",
        cwd: hooksRoot,
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
    });

    expect(result.status).toBe(0);
    expect(fs.existsSync(buildDailyFilePath(vaultPath, "ai-knowledge", today()))).toBe(false);
  });

  it("skips duplicate transcript capture within duplicate window", () => {
    withMemoryMasonCaptureMode("full", () => {
      const homeDir = createTempDir("memory-mason-home-");
      const vaultPath = createTempDir("memory-mason-vault-");
      const transcriptPath = path.join(createTempDir("memory-mason-transcript-"), "session.jsonl");

      writeText(transcriptPath, buildTranscript(2));

      runScript("session-end.js", {
        payload: {
          hook_event_name: "session_end",
          cwd: hooksRoot,
          transcript_path: transcriptPath,
          session_id: "session-3",
        },
        env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
      });

      const dailyPath = buildDailyChunkPath(vaultPath, "ai-knowledge", today(), 1);
      const firstContent = fs.readFileSync(dailyPath, "utf-8");

      runScript("session-end.js", {
        payload: {
          hook_event_name: "session_end",
          cwd: hooksRoot,
          transcript_path: transcriptPath,
          session_id: "session-3",
        },
        env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
      });

      expect(fs.readFileSync(dailyPath, "utf-8")).toBe(firstContent);
    });
  });

  it("reports invalid stdin to stderr", () => {
    const result = runScript("session-end.js", {
      stdinText: "{bad",
      env: buildEnv(createTempDir("memory-mason-home-")),
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("invalid JSON in stdin: {bad");
  });
});

describe("Copilot hook installer scripts", () => {
  it("installs user-level Copilot hook files with absolute commands and hook metadata", () => {
    const homeDir = createTempDir("memory-mason-home-");
    const result = runScript("install-copilot-hooks.js", {
      stdinText: "",
      cwd: repoRoot,
      env: buildEnv(homeDir),
    });

    const hooksDirectory = path.join(homeDir, ".copilot", "hooks");
    const hookRoot = path.join(repoRoot, "hooks");

    expect(result.status).toBe(0);
    copilotHookDefinitions.forEach((definition) => {
      assertInstalledCopilotHook(hooksDirectory, hookRoot, definition);
    });
  });

  it("installs workspace-level Copilot hook files with absolute commands and hook metadata", () => {
    const homeDir = createTempDir("memory-mason-home-");
    const workspaceDir = createTempDir("memory-mason-workspace-");
    const writes = [];
    const result = installCopilotHooks.main({
      cwd: repoRoot,
      env: buildEnv(homeDir),
      homedir: homeDir,
      argv: ["--workspace", workspaceDir],
      io: {
        stdout: (text) => writes.push(text),
        stderr: () => {},
        exit: () => {},
      },
    });

    const hooksDirectory = path.join(workspaceDir, ".github", "hooks");
    const hookRoot = path.join(repoRoot, "hooks");

    expect(result.status).toBe(0);
    expect(writes.join("")).toContain(path.join(workspaceDir, ".github", "hooks"));
    copilotHookDefinitions.forEach((definition) => {
      assertInstalledCopilotHook(hooksDirectory, hookRoot, definition);
    });
  });

  it("falls back to inline definitions when source hook files are not available", () => {
    const homeDir = createTempDir("memory-mason-home-");
    const targetDir = createTempDir("memory-mason-copilot-target-");
    const missingSourceDir = path.join(
      createTempDir("memory-mason-missing-source-"),
      ".github",
      "hooks",
    );

    const result = runScript("install-copilot-hooks.js", {
      cwd: repoRoot,
      env: buildEnv(homeDir),
      runtime: {
        targetDir,
        sourceDir: missingSourceDir,
      },
    });

    const hookRoot = path.join(repoRoot, "hooks");

    expect(result.status).toBe(0);
    copilotHookDefinitions.forEach((definition) => {
      assertInstalledCopilotHook(targetDir, hookRoot, definition);
    });
  });

  it("uninstalls user-level Copilot hook files", () => {
    const homeDir = createTempDir("memory-mason-home-");

    runScript("install-copilot-hooks.js", {
      stdinText: "",
      cwd: repoRoot,
      env: buildEnv(homeDir),
    });

    const result = runScript("uninstall-copilot-hooks.js", {
      stdinText: "",
      cwd: repoRoot,
      env: buildEnv(homeDir),
    });

    expect(result.status).toBe(0);
    expect(fs.existsSync(path.join(homeDir, ".copilot", "hooks", "session-start.json"))).toBe(
      false,
    );
    expect(fs.existsSync(path.join(homeDir, ".copilot", "hooks", "stop.json"))).toBe(false);
  });

  it("uninstalls workspace-level Copilot hook files", () => {
    const homeDir = createTempDir("memory-mason-home-");
    const workspaceDir = createTempDir("memory-mason-workspace-");

    installCopilotHooks.main({
      cwd: repoRoot,
      env: buildEnv(homeDir),
      homedir: homeDir,
      argv: ["--workspace", workspaceDir],
      io: {
        stdout: () => {},
        stderr: () => {},
        exit: () => {},
      },
    });

    const result = uninstallCopilotHooks.main({
      cwd: repoRoot,
      env: buildEnv(homeDir),
      homedir: homeDir,
      argv: ["--workspace", workspaceDir],
      io: {
        stdout: () => {},
        stderr: () => {},
        exit: () => {},
      },
    });

    expect(result.status).toBe(0);
    expect(fs.existsSync(path.join(workspaceDir, ".github", "hooks", "session-start.json"))).toBe(
      false,
    );
    expect(fs.existsSync(path.join(workspaceDir, ".github", "hooks", "stop.json"))).toBe(false);
  });
});

describe("capture-state.js helpers", () => {
  const {
    getTranscriptTurnCount,
    setTranscriptTurnCount,
    defaultCaptureState,
    loadCaptureState,
  } = require("../lib/capture-state");

  it("getTranscriptTurnCount returns 0 when sessionId not found", () => {
    const state = defaultCaptureState();
    expect(getTranscriptTurnCount(state, "unknown-session")).toBe(0);
  });

  it("getTranscriptTurnCount returns stored count", () => {
    const state = {
      lastCapture: null,
      mmSuppressed: false,
      transcriptTurnCounts: { "session-1": 5 },
    };
    expect(getTranscriptTurnCount(state, "session-1")).toBe(5);
  });

  it("getTranscriptTurnCount returns 0 for invalid/empty sessionId", () => {
    const state = defaultCaptureState();
    expect(getTranscriptTurnCount(state, "")).toBe(0);
    expect(getTranscriptTurnCount(null, "session-1")).toBe(0);
  });

  it("setTranscriptTurnCount stores count for sessionId", () => {
    const state = defaultCaptureState();
    const next = setTranscriptTurnCount(state, "session-1", 4);
    expect(next.transcriptTurnCounts["session-1"]).toBe(4);
    expect(next.lastCapture).toBe(null);
  });

  it("setTranscriptTurnCount preserves other session counts", () => {
    const state = {
      lastCapture: null,
      mmSuppressed: false,
      transcriptTurnCounts: { "session-1": 2 },
    };
    const next = setTranscriptTurnCount(state, "session-2", 6);
    expect(next.transcriptTurnCounts["session-1"]).toBe(2);
    expect(next.transcriptTurnCounts["session-2"]).toBe(6);
  });

  it("setTranscriptTurnCount throws on empty sessionId", () => {
    expect(() => setTranscriptTurnCount(defaultCaptureState(), "", 1)).toThrow(
      "sessionId must be a non-empty string",
    );
    expect(() => setTranscriptTurnCount(defaultCaptureState(), 123, 1)).toThrow(
      "sessionId must be a non-empty string",
    );
  });

  it("setTranscriptTurnCount throws on invalid count", () => {
    expect(() => setTranscriptTurnCount(defaultCaptureState(), "session-1", -1)).toThrow(
      "count must be a non-negative integer",
    );
    expect(() => setTranscriptTurnCount(defaultCaptureState(), "session-1", 1.5)).toThrow(
      "count must be a non-negative integer",
    );
  });

  it("setTranscriptTurnCount falls back to default state for non-object state", () => {
    expect(setTranscriptTurnCount(null, "session-1", 2)).toEqual({
      lastCapture: null,
      mmSuppressed: false,
      transcriptTurnCounts: {
        "session-1": 2,
      },
    });
  });

  it("loadCaptureState sanitizes transcriptTurnCounts and keeps only non-negative integers", () => {
    const vaultPath = createTempDir("memory-mason-vault-");
    const statePath = resolveCaptureStatePath(vaultPath, "ai-knowledge");

    writeText(
      statePath,
      JSON.stringify({
        lastCapture: null,
        mmSuppressed: false,
        transcriptTurnCounts: {
          "session-1": 3,
          "session-2": -1,
          "session-3": 1.5,
          "session-4": "4",
        },
      }),
    );

    expect(loadCaptureState(vaultPath, "ai-knowledge")).toEqual({
      lastCapture: null,
      mmSuppressed: false,
      transcriptTurnCounts: {
        "session-1": 3,
      },
    });
  });
});

describe("vault.js buildAssistantReplyEntry", () => {
  const { buildAssistantReplyEntry } = require("../lib/vault");

  it("builds a labeled AssistantReply entry", () => {
    const entry = buildAssistantReplyEntry("SELECT * FROM foo;", "14:22:31");
    expect(entry).toContain("AssistantReply");
    expect(entry).toContain("14:22:31");
    expect(entry).toContain("SELECT * FROM foo;");
  });

  it("preserves full content exceeding 5000 chars", () => {
    const longContent = "x".repeat(6000);
    const entry = buildAssistantReplyEntry(longContent, "09:00:00");
    expect(entry).toContain(longContent);
    expect(entry).not.toContain("...(truncated)");
  });

  it("throws on invalid timestamp", () => {
    expect(() => buildAssistantReplyEntry("hello", "bad")).toThrow(
      "timestamp must be in HH:MM:SS format",
    );
    expect(() => buildAssistantReplyEntry("hello", "")).toThrow();
  });

  it("throws on non-string content", () => {
    expect(() => buildAssistantReplyEntry(null, "12:00:00")).toThrow("content must be a string");
    expect(() => buildAssistantReplyEntry(42, "12:00:00")).toThrow("content must be a string");
  });
});

describe("session-start.js readStdin", () => {
  it("returns valid JSON string from mocked fd 0", () => {
    const payload = JSON.stringify({ cwd: "/tmp", hookEventName: "SessionStart" });
    const payloadBuffer = Buffer.from(payload, "utf-8");
    let callCount = 0;
    const mockFs = {
      readSync(_fd, chunk) {
        if (callCount === 0) {
          callCount++;
          payloadBuffer.copy(chunk, 0, 0, payloadBuffer.length);
          return payloadBuffer.length;
        }
        return 0;
      },
    };
    expect(sessionStart.readStdin(mockFs)).toBe(payload);
  });

  it("returns empty string when fd 0 yields zero bytes immediately", () => {
    expect(sessionStart.readStdin({ readSync: () => 0 })).toBe("");
  });

  it("concatenates multiple chunks before EOF", () => {
    const part1 = Buffer.from('{"cwd":');
    const part2 = Buffer.from('"/tmp"}');
    let callCount = 0;
    const mockFs = {
      readSync(_fd, chunk) {
        if (callCount === 0) {
          callCount++;
          part1.copy(chunk);
          return part1.length;
        }
        if (callCount === 1) {
          callCount++;
          part2.copy(chunk);
          return part2.length;
        }
        return 0;
      },
    };
    expect(sessionStart.readStdin(mockFs)).toBe('{"cwd":"/tmp"}');
  });
});

describe("session-start.js main", () => {
  it("writes stdout and calls exit with status 0 on success", () => {
    const homeDir = createTempDir("mm-home-");
    const vaultPath = createTempDir("mm-vault-");
    const cwd = createTempDir("mm-cwd-");
    writeText(
      path.join(cwd, "memory-mason.json"),
      JSON.stringify({ vaultPath, subfolder: "ai-knowledge" }),
    );
    const payload = JSON.stringify({ cwd });
    const buf = Buffer.from(payload);
    let rc = 0;
    const writes = [];
    const errors = [];
    let exitCode = null;
    sessionStart.main({
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
      env: buildEnv(homeDir),
      homedir: homeDir,
    });
    expect(exitCode).toBe(0);
    expect(writes.length).toBeGreaterThan(0);
    expect(errors).toHaveLength(0);
  });

  it("writes stderr when config is missing and still exits 0", () => {
    const homeDir = createTempDir("mm-home-");
    const payload = JSON.stringify({ cwd: createTempDir("mm-nocfg-") });
    const buf = Buffer.from(payload);
    let rc = 0;
    const writes = [];
    const errors = [];
    let exitCode = null;
    sessionStart.main({
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
      cwd: createTempDir("mm-fb-"),
      env: buildEnv(homeDir),
      homedir: homeDir,
    });
    expect(exitCode).toBe(0);
    expect(errors.join("")).toContain(
      "Memory Mason config not found. Checked MEMORY_MASON_VAULT_PATH, project .env, project memory-mason.json, ~/.memory-mason/.env, and ~/.memory-mason/config.json.",
    );
  });

  it("uses io fallback functions when stdout/stderr not provided", () => {
    const homeDir = createTempDir("mm-home-");
    const vaultPath = createTempDir("mm-vault-");
    const payload = JSON.stringify({ cwd: homeDir });
    const buf = Buffer.from(payload);
    let rc = 0;
    let exitCode = null;
    const result = sessionStart.main({
      io: {
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
    expect(result.status).toBe(0);
    expect(exitCode).toBe(0);
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
    expect(errors.join("")).toContain(
      "Memory Mason config not found. Checked MEMORY_MASON_VAULT_PATH, project .env, project memory-mason.json, ~/.memory-mason/.env, and ~/.memory-mason/config.json.",
    );
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

describe("session-end.js readStdin", () => {
  it("reads single chunk from mocked fd 0", () => {
    const payload = JSON.stringify({ hook_event_name: "Stop" });
    const buf = Buffer.from(payload);
    let rc = 0;
    expect(
      sessionEnd.readStdin({
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
    expect(sessionEnd.readStdin({ readSync: () => 0 })).toBe("");
  });
});

describe("session-end.js firstNonEmptyString", () => {
  it("throws when values is not an array", () => {
    expect(() => sessionEnd.firstNonEmptyString("x")).toThrow("values must be an array");
    expect(() => sessionEnd.firstNonEmptyString(null)).toThrow("values must be an array");
  });
});

describe("session-end.js utility functions", () => {
  it("listFilesRecursive returns empty array for nonexistent path", () => {
    expect(sessionEnd.listFilesRecursive(path.join(createTempDir("mm-m-"), "no"))).toEqual([]);
  });

  it("findCodexSessionContent returns empty for dir with no json/jsonl files", () => {
    const dir = createTempDir("mm-codex-");
    writeText(path.join(dir, "readme.txt"), "not json");
    expect(sessionEnd.findCodexSessionContent(dir, "session-1")).toBe("");
  });

  it("findCodexSessionContent returns empty for nonexistent dir", () => {
    expect(sessionEnd.findCodexSessionContent(path.join(createTempDir("mm-m-"), "no"), "s1")).toBe(
      "",
    );
  });

  it("findCopilotCliSessionContent throws on missing session-state dir", () => {
    expect(() =>
      sessionEnd.findCopilotCliSessionContent(path.join(createTempDir("mm-m-"), "no"), ""),
    ).toThrow("copilot session-state dir not found");
  });

  it("findCopilotCliSessionContentOrEmpty returns empty on missing dir", () => {
    expect(
      sessionEnd.findCopilotCliSessionContentOrEmpty(path.join(createTempDir("mm-m-"), "no"), ""),
    ).toBe("");
  });

  it("collectAssistantTurnContents filters and collects from start index", () => {
    const turns = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
      { role: "assistant", content: "bye" },
    ];
    expect(sessionEnd.collectAssistantTurnContents(turns, 0)).toEqual(["hello", "bye"]);
    expect(sessionEnd.collectAssistantTurnContents(turns, 2)).toEqual(["bye"]);
  });

  it("collectAssistantTurnContents skips null and empty entries", () => {
    expect(
      sessionEnd.collectAssistantTurnContents(
        [null, { role: "assistant", content: "" }, { role: "assistant", content: "ok" }],
        0,
      ),
    ).toEqual(["ok"]);
  });

  it("getLastAssistantTurnContent returns last assistant or empty", () => {
    expect(
      sessionEnd.getLastAssistantTurnContent([
        { role: "assistant", content: "a" },
        { role: "assistant", content: "b" },
      ]),
    ).toBe("b");
    expect(sessionEnd.getLastAssistantTurnContent([])).toBe("");
  });
});

describe("session-end.js stop with empty session ID", () => {
  it("returns early", () => {
    const homeDir = createTempDir("mm-home-");
    const vaultPath = createTempDir("mm-vault-");
    const result = sessionEnd.run(
      JSON.stringify({
        hook_event_name: "Stop",
        cwd: hooksRoot,
        transcript_path: path.join(createTempDir("mm-tr-"), "x.jsonl"),
      }),
      {
        cwd: hooksRoot,
        env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
        homedir: homeDir,
      },
    );
    expect(result).toEqual({ status: 0, stdout: "", stderr: "" });
  });
});

describe("session-end.js transcript with 0 turns on non-stop event", () => {
  it("skips when transcript has no user/assistant turns", () => {
    const homeDir = createTempDir("mm-home-");
    const vaultPath = createTempDir("mm-vault-");
    const transcriptPath = path.join(createTempDir("mm-tr-"), "session.jsonl");
    writeText(transcriptPath, JSON.stringify({ message: { role: "system", content: "sys" } }));
    const result = runScript("session-end.js", {
      payload: {
        hook_event_name: "session_end",
        cwd: hooksRoot,
        transcript_path: transcriptPath,
        session_id: "session-zero",
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
    });
    expect(result.status).toBe(0);
  });
});

describe("session-end.js main", () => {
  it("reads stdin via mock fs and calls exit", () => {
    const homeDir = createTempDir("mm-home-");
    const vaultPath = createTempDir("mm-vault-");
    const transcriptPath = path.join(createTempDir("mm-tr-"), "session.jsonl");
    writeText(transcriptPath, buildTranscript(2));
    const payload = JSON.stringify({
      hook_event_name: "session_end",
      cwd: hooksRoot,
      transcript_path: transcriptPath,
      session_id: "se-main",
    });
    const buf = Buffer.from(payload);
    let rc = 0;
    const errors = [];
    let exitCode = null;
    sessionEnd.main({
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
  });

  it("writes stderr on error", () => {
    const buf = Buffer.from("{bad");
    let rc = 0;
    const errors = [];
    let exitCode = null;
    sessionEnd.main({
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

describe("install-copilot-hooks.js parseArgs", () => {
  it("throws on unknown argument", () => {
    expect(() => installCopilotHooks.parseArgs(["--unknown"], "/cwd")).toThrow(
      "unknown argument: --unknown",
    );
  });

  it("throws when --workspace is last with no value", () => {
    expect(() => installCopilotHooks.parseArgs(["--workspace"], "/cwd")).toThrow(
      "--workspace requires a workspace path",
    );
  });

  it("throws when -w is last with no value", () => {
    expect(() => installCopilotHooks.parseArgs(["-w"], "/cwd")).toThrow(
      "-w requires a workspace path",
    );
  });

  it("throws when --workspace value is empty", () => {
    expect(() => installCopilotHooks.parseArgs(["--workspace", ""], "/cwd")).toThrow(
      "--workspace requires a workspace path",
    );
  });
});

describe("install-copilot-hooks.js readSourceHookFile", () => {
  it("returns null for non-string or empty sourceDir", () => {
    expect(installCopilotHooks.readSourceHookFile("session-start.json", null)).toBeNull();
    expect(installCopilotHooks.readSourceHookFile("session-start.json", "")).toBeNull();
  });

  it("returns null when source file does not exist", () => {
    expect(
      installCopilotHooks.readSourceHookFile("session-start.json", createTempDir("mm-empty-")),
    ).toBeNull();
  });

  it("returns parsed JSON when source file exists", () => {
    const sourceDir = createTempDir("mm-src-");
    const content = {
      hooks: { SessionStart: [{ type: "command", command: "node x.js", timeout: 10 }] },
    };
    writeText(path.join(sourceDir, "session-start.json"), JSON.stringify(content));
    expect(installCopilotHooks.readSourceHookFile("session-start.json", sourceDir)).toEqual(
      content,
    );
  });
});

describe("install-copilot-hooks.js buildInlineHookFile", () => {
  it("throws for unknown hook file name", () => {
    expect(() => installCopilotHooks.buildInlineHookFile("unknown.json")).toThrow(
      "missing inline hook definition for unknown.json",
    );
  });
});

describe("install-copilot-hooks.js rewriteEntry", () => {
  it("returns null/non-object entries unchanged", () => {
    expect(installCopilotHooks.rewriteEntry(null, "/hooks", "session-start.js")).toBeNull();
    expect(installCopilotHooks.rewriteEntry(42, "/hooks", "session-start.js")).toBe(42);
    expect(installCopilotHooks.rewriteEntry("s", "/hooks", "session-start.js")).toBe("s");
  });
});

describe("install-copilot-hooks.js rewriteHookFile", () => {
  it("throws for unknown hook file name with no script mapping", () => {
    expect(() => installCopilotHooks.rewriteHookFile("unknown.json", "/hooks")).toThrow(
      "missing hook script mapping for unknown.json",
    );
  });

  it("throws when hook document is an array", () => {
    const sourceDir = createTempDir("mm-src-");
    writeText(path.join(sourceDir, "session-start.json"), JSON.stringify([1, 2]));
    expect(() =>
      installCopilotHooks.rewriteHookFile("session-start.json", "/hooks", { sourceDir }),
    ).toThrow("invalid hook file shape for session-start.json");
  });

  it("throws when hooks property is not a plain object", () => {
    const sourceDir = createTempDir("mm-src-");
    writeText(path.join(sourceDir, "session-start.json"), JSON.stringify({ hooks: [1] }));
    expect(() =>
      installCopilotHooks.rewriteHookFile("session-start.json", "/hooks", { sourceDir }),
    ).toThrow("invalid hooks object for session-start.json");
  });

  it("throws when hooks property is null", () => {
    const sourceDir = createTempDir("mm-src-");
    writeText(path.join(sourceDir, "session-start.json"), JSON.stringify({ hooks: null }));
    expect(() =>
      installCopilotHooks.rewriteHookFile("session-start.json", "/hooks", { sourceDir }),
    ).toThrow("invalid hooks object for session-start.json");
  });
});

describe("install-copilot-hooks.js main", () => {
  it("calls exit with status 0 and writes stdout", () => {
    const homeDir = createTempDir("mm-home-");
    const writes = [];
    let exitCode = null;
    installCopilotHooks.main({
      cwd: repoRoot,
      env: buildEnv(homeDir),
      homedir: homeDir,
      argv: [],
      io: {
        stdout: (t) => writes.push(t),
        stderr: () => {},
        exit: (c) => {
          exitCode = c;
        },
      },
    });
    expect(exitCode).toBe(0);
    expect(writes.join("")).toContain("Installed Memory Mason Copilot hooks");
  });
});

describe("uninstall-copilot-hooks.js parseArgs", () => {
  it("throws on unknown argument", () => {
    expect(() => uninstallCopilotHooks.parseArgs(["--unknown"], "/cwd")).toThrow(
      "unknown argument: --unknown",
    );
  });

  it("throws when --workspace has no value", () => {
    expect(() => uninstallCopilotHooks.parseArgs(["--workspace"], "/cwd")).toThrow(
      "--workspace requires a workspace path",
    );
  });

  it("throws when -w value is empty", () => {
    expect(() => uninstallCopilotHooks.parseArgs(["-w", ""], "/cwd")).toThrow(
      "-w requires a workspace path",
    );
  });
});

describe("uninstall-copilot-hooks.js resolveTargetDir", () => {
  it("falls back to homedir copilot hooks", () => {
    const homeDir = createTempDir("mm-home-");
    expect(uninstallCopilotHooks.resolveTargetDir({ homedir: homeDir })).toBe(
      path.join(homeDir, ".copilot", "hooks"),
    );
  });

  it("uses workspacePath when provided", () => {
    const ws = createTempDir("mm-ws-");
    expect(uninstallCopilotHooks.resolveTargetDir({ workspacePath: ws })).toBe(
      path.join(ws, ".github", "hooks"),
    );
  });
});

describe("uninstall-copilot-hooks.js main", () => {
  it("calls exit and writes stdout", () => {
    const homeDir = createTempDir("mm-home-");
    const targetDir = createTempDir("mm-target-");
    writeText(path.join(targetDir, "session-start.json"), "{}");
    const writes = [];
    let exitCode = null;
    uninstallCopilotHooks.main({
      cwd: repoRoot,
      env: buildEnv(homeDir),
      homedir: homeDir,
      argv: [],
      targetDir,
      io: {
        stdout: (t) => writes.push(t),
        stderr: () => {},
        exit: (c) => {
          exitCode = c;
        },
      },
    });
    expect(exitCode).toBe(0);
    expect(writes.join("")).toContain("Removed Memory Mason Copilot hooks");
  });
});

describe("session-start.js runtime fallback branches", () => {
  it("falls back to process defaults when runtime properties are invalid", () => {
    const result = sessionStart.run(JSON.stringify({ cwd: createTempDir("mm-cwd-") }), {
      env: null,
      cwd: 123,
      homedir: 42,
    });
    expect(result.status).toBe(0);
  });

  it("uses fallbackCwd when input has no cwd", () => {
    const homeDir = createTempDir("mm-home-");
    const vaultPath = createTempDir("mm-vault-");
    const result = sessionStart.run(JSON.stringify({}), {
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
      cwd: createTempDir("mm-fb-cwd-"),
      homedir: homeDir,
    });
    expect(result.status).toBe(0);
  });

  it("handles non-Error throw via String coercion", () => {
    const result = sessionStart.run("not-json-at-all", {});
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("invalid JSON");
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

describe("session-end.js runtime fallback branches", () => {
  it("falls back to process defaults when runtime properties are invalid", () => {
    const result = sessionEnd.run(
      JSON.stringify({ hook_event_name: "session_end", cwd: createTempDir("mm-cwd-") }),
      { env: null, cwd: 123, homedir: 42 },
    );
    expect(result.status).toBe(0);
  });

  it("uses fallbackCwd when input has no cwd", () => {
    const homeDir = createTempDir("mm-home-");
    const vaultPath = createTempDir("mm-vault-");
    const result = sessionEnd.run(JSON.stringify({ hook_event_name: "session_end" }), {
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
      cwd: createTempDir("mm-fb-"),
      homedir: homeDir,
    });
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

describe("session-end.js findCopilotCliSessionContent no jsonl files", () => {
  it("throws when dirs exist but contain no .jsonl files", () => {
    const sessionStateDir = createTempDir("mm-copilot-state-");
    const subDir = path.join(sessionStateDir, "session-a");
    writeText(path.join(subDir, "readme.txt"), "not a jsonl");
    expect(() => sessionEnd.findCopilotCliSessionContent(sessionStateDir, "")).toThrow(
      "no .jsonl files found in copilot session-state",
    );
  });
});

describe("session-end.js findCopilotCliSessionContent empty content", () => {
  it("throws when jsonl files exist but are empty", () => {
    const sessionStateDir = createTempDir("mm-copilot-state-");
    const subDir = path.join(sessionStateDir, "session-b");
    writeText(path.join(subDir, "session.jsonl"), "");
    expect(() => sessionEnd.findCopilotCliSessionContent(sessionStateDir, "")).toThrow(
      "no transcript content found in copilot session-state",
    );
  });
});

describe("session-end.js readTranscriptFromPath", () => {
  it("returns empty when path is empty", () => {
    expect(sessionEnd.readTranscriptFromPath("")).toBe("");
  });

  it("returns empty when file does not exist", () => {
    expect(sessionEnd.readTranscriptFromPath(path.join(createTempDir("mm-m-"), "no.jsonl"))).toBe(
      "",
    );
  });

  it("returns content when file exists", () => {
    const dir = createTempDir("mm-tr-");
    const filePath = path.join(dir, "session.jsonl");
    writeText(filePath, "transcript content");
    expect(sessionEnd.readTranscriptFromPath(filePath)).toBe("transcript content");
  });
});

describe("session-end.js findCodexSessionContent with non-matching session id", () => {
  it("falls back to all files when session id does not match", () => {
    const sessionRoot = createTempDir("mm-codex-");
    writeText(path.join(sessionRoot, "other.jsonl"), buildTranscript(2));
    const result = sessionEnd.findCodexSessionContent(sessionRoot, "nonexistent-session");
    expect(result).not.toBe("");
  });
});

describe("post-tool-use.js copilot-cli payload with null toolResult", () => {
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

describe("post-tool-use.js inputCwd fallback", () => {
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

describe("post-tool-use.js textResultForLlm branch", () => {
  it("handles copilot-vscode payload with textResultForLlm", () => {
    const homeDir = createTempDir("mm-home-");
    const vaultPath = createTempDir("mm-vault-");
    const result = postToolUse.run(
      JSON.stringify({
        hookEventName: "PostToolUse",
        cwd: homeDir,
        toolName: "Bash",
        toolResult: { textResultForLlm: "llm text" },
      }),
      {
        env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
        cwd: homeDir,
        homedir: homeDir,
      },
    );
    expect(result.status).toBe(0);
  });

  it("handles copilot-vscode payload without textResultForLlm", () => {
    const homeDir = createTempDir("mm-home-");
    const vaultPath = createTempDir("mm-vault-");
    const result = postToolUse.run(
      JSON.stringify({
        hookEventName: "PostToolUse",
        cwd: homeDir,
        toolName: "Bash",
        toolResult: { something: "else" },
      }),
      {
        env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
        cwd: homeDir,
        homedir: homeDir,
      },
    );
    expect(result.status).toBe(0);
  });
});

describe("install-copilot-hooks.js runtime fallback branches", () => {
  it("falls back to defaults when argv/cwd/homedir are invalid", () => {
    expect(() => installCopilotHooks.parseArgs(null, null)).not.toThrow();
  });

  it("resolves target dir with homedir fallback", () => {
    const homeDir = createTempDir("mm-home-");
    expect(installCopilotHooks.resolveTargetDir({ homedir: homeDir })).toBe(
      path.join(homeDir, ".copilot", "hooks"),
    );
  });

  it("resolves target dir falling back to os.homedir when homedir is invalid", () => {
    const result = installCopilotHooks.resolveTargetDir({ homedir: 42 });
    expect(result).toContain(".copilot");
  });

  it("rewriteEntry handles entry with non-PLACEHOLDER command", () => {
    const entry = { type: "command", command: "node hooks/session-start.js", timeout: 10 };
    const result = installCopilotHooks.rewriteEntry(entry, "/my/hooks", "session-start.js");
    expect(result.command).toContain("/my/hooks");
  });

  it("rewriteEntry handles entry with hooks array", () => {
    const entry = { hooks: [{ type: "command", command: "PLACEHOLDER", timeout: 5 }] };
    const result = installCopilotHooks.rewriteEntry(entry, "/my/hooks", "session-start.js");
    expect(result.hooks[0].command).toContain("/my/hooks");
  });

  it("rewriteEntry handles entry without command or hooks", () => {
    const entry = { type: "filter", pattern: "*.js" };
    const result = installCopilotHooks.rewriteEntry(entry, "/my/hooks", "session-start.js");
    expect(result.type).toBe("filter");
  });

  it("rewriteHookFile handles non-array event entries", () => {
    const sourceDir = createTempDir("mm-src-");
    writeText(
      path.join(sourceDir, "session-start.json"),
      JSON.stringify({ hooks: { SessionStart: "not-an-array" } }),
    );
    const result = installCopilotHooks.rewriteHookFile("session-start.json", "/my/hooks", {
      sourceDir,
    });
    const parsed = JSON.parse(result);
    expect(parsed.hooks.SessionStart).toBe("not-an-array");
  });
});

describe("uninstall-copilot-hooks.js runtime fallback branches", () => {
  it("falls back to defaults when argv and cwd are invalid", () => {
    const result = uninstallCopilotHooks.parseArgs(null, null);
    expect(result).toBeDefined();
  });

  it("resolves target dir falling back to os.homedir when homedir is invalid", () => {
    const result = uninstallCopilotHooks.resolveTargetDir({ homedir: 42 });
    expect(result).toContain(".copilot");
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

describe("pre-compact.js readConfigText with existing file", () => {
  it("uses memory-mason.json when no env vault path is set", () => {
    const homeDir = createTempDir("mm-home-");
    const vaultPath = createTempDir("mm-vault-");
    const cwd = createTempDir("mm-cwd-");
    const transcriptPath = path.join(createTempDir("mm-tr-"), "session.jsonl");
    writeText(transcriptPath, buildTranscript(6));
    writeText(
      path.join(cwd, "memory-mason.json"),
      JSON.stringify({ vaultPath, subfolder: "ai-knowledge" }),
    );
    const result = runScript("pre-compact.js", {
      payload: { cwd, transcript_path: transcriptPath, session_id: "cfg-test" },
      cwd,
      env: buildEnv(homeDir),
    });
    expect(result.status).toBe(0);
  });
});

describe("session-end.js readConfigText with existing file", () => {
  it("uses memory-mason.json when no env vault path is set", () => {
    const homeDir = createTempDir("mm-home-");
    const vaultPath = createTempDir("mm-vault-");
    const cwd = createTempDir("mm-cwd-");
    const transcriptPath = path.join(createTempDir("mm-tr-"), "session.jsonl");
    writeText(transcriptPath, buildTranscript(4));
    writeText(
      path.join(cwd, "memory-mason.json"),
      JSON.stringify({ vaultPath, subfolder: "ai-knowledge" }),
    );
    const result = runScript("session-end.js", {
      payload: {
        hook_event_name: "session_end",
        cwd,
        transcript_path: transcriptPath,
        session_id: "cfg-test",
      },
      cwd,
      env: buildEnv(homeDir),
    });
    expect(result.status).toBe(0);
  });
});

describe("session-end.js findCodexSessionContent with empty session id", () => {
  it("returns content of most recent file when session id is empty", () => {
    const sessionRoot = createTempDir("mm-codex-");
    writeText(path.join(sessionRoot, "session.jsonl"), buildTranscript(2));
    const result = sessionEnd.findCodexSessionContent(sessionRoot, "");
    expect(result).not.toBe("");
  });
});

describe("session-end.js findCopilotCliSessionContent with matching cwd", () => {
  it("returns content when matching cwd found in jsonl", () => {
    const sessionStateDir = createTempDir("mm-copilot-");
    const subDir = path.join(sessionStateDir, "session-a");
    const targetCwd = "/my/project";
    writeText(
      path.join(subDir, "session.jsonl"),
      JSON.stringify({ message: { role: "user", content: `hello from ${targetCwd}` } }),
    );
    const result = sessionEnd.findCopilotCliSessionContent(sessionStateDir, targetCwd);
    expect(result).toContain(targetCwd);
  });

  it("falls back to first dir when cwd not matched", () => {
    const sessionStateDir = createTempDir("mm-copilot-");
    const subDir = path.join(sessionStateDir, "session-a");
    writeText(
      path.join(subDir, "session.jsonl"),
      JSON.stringify({ message: { role: "user", content: "hello" } }),
    );
    const result = sessionEnd.findCopilotCliSessionContent(sessionStateDir, "/nonexistent/path");
    expect(result).toContain("hello");
  });
});

describe("session-end.js calculateNextTurnCount edge cases", () => {
  it("handles stop event with non-empty last_assistant_message and empty transcript", () => {
    const homeDir = createTempDir("mm-home-");
    const vaultPath = createTempDir("mm-vault-");
    const result = sessionEnd.run(
      JSON.stringify({
        hook_event_name: "Stop",
        cwd: hooksRoot,
        session_id: "calc-test",
        last_assistant_message: "test reply",
      }),
      {
        cwd: hooksRoot,
        env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
        homedir: homeDir,
      },
    );
    expect(result.status).toBe(0);
  });
});
