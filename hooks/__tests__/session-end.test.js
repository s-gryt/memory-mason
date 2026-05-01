"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildDailyChunkPath, buildDailyFilePath } = require("../lib/vault");
const { resolveCaptureStatePath } = require("../lib/capture-state");
const sessionEnd = require("../session-end");
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

const runScript = (scriptName, options = {}) => {
  let stdinText = "";
  if (typeof options.stdinText === "string") {
    stdinText = options.stdinText;
  } else if (typeof options.payload !== "undefined") {
    stdinText = JSON.stringify(options.payload);
  }
  const env = options.env || process.env;
  const homedir = env.USERPROFILE && env.USERPROFILE !== "" ? env.USERPROFILE : os.homedir();
  const runtime = { cwd: options.cwd || hooksRoot, env, homedir, ...(options.runtime || {}) };
  if (scriptName === "user-prompt-submit.js") return userPromptSubmit.run(stdinText, runtime);
  return sessionEnd.run(stdinText, runtime);
};

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe("entrypoint config readers", () => {
  const scriptName = "session-end.js";
  const scriptModule = sessionEnd;

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

  it("writes full transcript from explicit path without truncation", () => {
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

  it("falls back to codex session files when transcript path missing", () => {
    const homeDir = createTempDir("memory-mason-home-");
    const vaultPath = createTempDir("memory-mason-vault-");
    const codexFile = path.join(homeDir, ".codex", "sessions", "session-2", "session-2-log.jsonl");

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

  it("falls back to Copilot CLI session-state content", () => {
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

  it("reports invalid stdin to stderr", () => {
    const result = runScript("session-end.js", {
      stdinText: "{bad",
      env: buildEnv(createTempDir("memory-mason-home-")),
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("invalid JSON in stdin: {bad");
  });
});

describe("run - mm suppression for Stop event", () => {
  it("skips writing assistant reply when mmSuppressed is true", () => {
    const homeDir = createTempDir("memory-mason-home-");
    const vaultPath = createTempDir("memory-mason-vault-");
    const transcriptPath = path.join(createTempDir("memory-mason-transcript-"), "session.jsonl");
    const statePath = resolveCaptureStatePath(vaultPath, "ai-knowledge");

    writeText(transcriptPath, buildTranscript(2, "stop-mm-user"));
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

    const result = runScript("session-end.js", {
      payload: {
        hook_event_name: "Stop",
        cwd: hooksRoot,
        transcript_path: transcriptPath,
        session_id: "session-stop-mm-true",
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
    });

    expect(result.status).toBe(0);
    expect(fs.existsSync(buildDailyChunkPath(vaultPath, "ai-knowledge", today(), 1))).toBe(false);
  });

  it("writes assistant reply when mmSuppressed is false", () => {
    const homeDir = createTempDir("memory-mason-home-");
    const vaultPath = createTempDir("memory-mason-vault-");
    const transcriptPath = path.join(createTempDir("memory-mason-transcript-"), "session.jsonl");
    const statePath = resolveCaptureStatePath(vaultPath, "ai-knowledge");

    writeText(transcriptPath, buildTranscript(2, "stop-mm-user"));
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

    const result = runScript("session-end.js", {
      payload: {
        hook_event_name: "Stop",
        cwd: hooksRoot,
        transcript_path: transcriptPath,
        session_id: "session-stop-mm-false",
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
    });

    const dailyContent = fs.readFileSync(
      buildDailyChunkPath(vaultPath, "ai-knowledge", today(), 1),
      "utf-8",
    );

    expect(result.status).toBe(0);
    expect(dailyContent).toContain("assistant turn 1");
  });
});

describe("run - sync flag", () => {
  it("returns status 0 without vault write for Stop event when sync is false", () => {
    const cwd = createTempDir("memory-mason-cwd-");
    const homeDir = createTempDir("memory-mason-home-");
    const vaultPath = createTempDir("memory-mason-vault-");
    const transcriptPath = path.join(createTempDir("memory-mason-transcript-"), "session.jsonl");
    const statePath = resolveCaptureStatePath(vaultPath, "ai-knowledge");
    const initialState = {
      lastCapture: null,
      mmSuppressed: false,
      transcriptTurnCounts: {
        "session-stop-sync-false": 1,
      },
    };

    writeText(
      path.join(cwd, "memory-mason.json"),
      JSON.stringify({ vaultPath, subfolder: "ai-knowledge", sync: false }),
    );
    writeText(transcriptPath, buildTranscript(2, "session-sync-user"));
    writeText(statePath, JSON.stringify(initialState, null, 2));

    const result = runScript("session-end.js", {
      payload: {
        hook_event_name: "Stop",
        cwd,
        transcript_path: transcriptPath,
        session_id: "session-stop-sync-false",
      },
      cwd,
      env: buildEnv(homeDir),
    });

    const persistedState = JSON.parse(fs.readFileSync(statePath, "utf-8"));

    expect(result.status).toBe(0);
    expect(fs.existsSync(buildDailyChunkPath(vaultPath, "ai-knowledge", today(), 1))).toBe(false);
    expect(persistedState).toEqual(initialState);
  });

  it("returns status 0 without vault write for SessionEnd event when sync is false", () => {
    const cwd = createTempDir("memory-mason-cwd-");
    const homeDir = createTempDir("memory-mason-home-");
    const vaultPath = createTempDir("memory-mason-vault-");
    const transcriptPath = path.join(createTempDir("memory-mason-transcript-"), "session.jsonl");
    const statePath = resolveCaptureStatePath(vaultPath, "ai-knowledge");
    const initialState = {
      lastCapture: {
        sessionId: "previous-session-sync",
        source: "claude-code",
        contentHash: "fedcba9876543210",
        timestampMs: 1,
      },
      mmSuppressed: false,
    };

    writeText(
      path.join(cwd, "memory-mason.json"),
      JSON.stringify({ vaultPath, subfolder: "ai-knowledge", sync: false }),
    );
    writeText(transcriptPath, buildTranscript(2, "session-sync-user"));
    writeText(statePath, JSON.stringify(initialState, null, 2));

    const result = runScript("session-end.js", {
      payload: {
        hook_event_name: "session_end",
        cwd,
        transcript_path: transcriptPath,
        session_id: "session-end-sync-false",
      },
      cwd,
      env: buildEnv(homeDir),
    });

    const persistedState = JSON.parse(fs.readFileSync(statePath, "utf-8"));

    expect(result.status).toBe(0);
    expect(fs.existsSync(buildDailyChunkPath(vaultPath, "ai-knowledge", today(), 1))).toBe(false);
    expect(persistedState).toEqual(initialState);
  });
});

describe("run - mm transcript filtering for SessionEnd event", () => {
  it("filters out /mm turns from full transcript before writing", () => {
    const homeDir = createTempDir("memory-mason-home-");
    const vaultPath = createTempDir("memory-mason-vault-");
    const transcriptPath = path.join(createTempDir("memory-mason-transcript-"), "session.jsonl");
    const mixedTranscript = [
      JSON.stringify({ message: { role: "user", content: "/mmq summarize history" } }),
      JSON.stringify({ message: { role: "assistant", content: "hidden mm assistant" } }),
      JSON.stringify({ message: { role: "user", content: "normal prompt" } }),
      JSON.stringify({ message: { role: "assistant", content: "normal assistant" } }),
    ].join("\n");

    writeText(transcriptPath, mixedTranscript);

    const result = runScript("session-end.js", {
      payload: {
        hook_event_name: "session_end",
        cwd: hooksRoot,
        transcript_path: transcriptPath,
        session_id: "session-filter-mixed",
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
    });

    const dailyContent = fs.readFileSync(
      buildDailyChunkPath(vaultPath, "ai-knowledge", today(), 1),
      "utf-8",
    );

    expect(result.status).toBe(0);
    expect(dailyContent).toContain("normal prompt");
    expect(dailyContent).toContain("normal assistant");
    expect(dailyContent).not.toContain("/mmq summarize history");
    expect(dailyContent).not.toContain("hidden mm assistant");
  });

  it("writes full transcript when no /mm turns are present", () => {
    const homeDir = createTempDir("memory-mason-home-");
    const vaultPath = createTempDir("memory-mason-vault-");
    const transcriptPath = path.join(createTempDir("memory-mason-transcript-"), "session.jsonl");

    writeText(transcriptPath, buildTranscript(4, "normal first user turn"));

    const result = runScript("session-end.js", {
      payload: {
        hook_event_name: "session_end",
        cwd: hooksRoot,
        transcript_path: transcriptPath,
        session_id: "session-filter-none",
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
    });

    const dailyContent = fs.readFileSync(
      buildDailyChunkPath(vaultPath, "ai-knowledge", today(), 1),
      "utf-8",
    );

    expect(result.status).toBe(0);
    expect(dailyContent).toContain("normal first user turn");
    expect(dailyContent).toContain("assistant turn 3");
  });

  it("skips writing full transcript when all turns are /mm commands", () => {
    const homeDir = createTempDir("memory-mason-home-");
    const vaultPath = createTempDir("memory-mason-vault-");
    const transcriptPath = path.join(createTempDir("memory-mason-transcript-"), "session.jsonl");
    const mmOnlyTranscript = [
      JSON.stringify({ message: { role: "user", content: "/mmc" } }),
      JSON.stringify({ message: { role: "assistant", content: "compiled" } }),
      JSON.stringify({ message: { role: "user", content: "/mml" } }),
      JSON.stringify({ message: { role: "assistant", content: "linted" } }),
    ].join("\n");

    writeText(transcriptPath, mmOnlyTranscript);

    const result = runScript("session-end.js", {
      payload: {
        hook_event_name: "session_end",
        cwd: hooksRoot,
        transcript_path: transcriptPath,
        session_id: "session-filter-all-mm",
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
    });

    expect(result.status).toBe(0);
    expect(fs.existsSync(buildDailyChunkPath(vaultPath, "ai-knowledge", today(), 1))).toBe(false);
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

  it("findCodexSessionContent returns content when session id is empty", () => {
    const dir = createTempDir("mm-codex-");
    writeText(path.join(dir, "other.jsonl"), buildTranscript(2));
    expect(sessionEnd.findCodexSessionContent(dir, "")).not.toBe("");
  });

  it("findCodexSessionContent falls back to all files when session id does not match", () => {
    const dir = createTempDir("mm-codex-");
    writeText(path.join(dir, "other.jsonl"), buildTranscript(2));
    expect(sessionEnd.findCodexSessionContent(dir, "nonexistent-session")).not.toBe("");
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

  it("findCopilotCliSessionContent throws when dirs exist but contain no .jsonl files", () => {
    const sessionStateDir = createTempDir("mm-copilot-state-");
    const subDir = path.join(sessionStateDir, "session-a");
    writeText(path.join(subDir, "readme.txt"), "not a jsonl");
    expect(() => sessionEnd.findCopilotCliSessionContent(sessionStateDir, "")).toThrow(
      "no .jsonl files found in copilot session-state",
    );
  });

  it("findCopilotCliSessionContentOrEmpty returns empty on missing dir", () => {
    expect(
      sessionEnd.findCopilotCliSessionContentOrEmpty(path.join(createTempDir("mm-m-"), "no"), ""),
    ).toBe("");
  });

  it("findCopilotCliSessionContent throws when jsonl files exist but are empty", () => {
    const sessionStateDir = createTempDir("mm-copilot-state-");
    const subDir = path.join(sessionStateDir, "session-b");
    writeText(path.join(subDir, "session.jsonl"), "");
    expect(() => sessionEnd.findCopilotCliSessionContent(sessionStateDir, "")).toThrow(
      "no transcript content found in copilot session-state",
    );
  });

  it("findCopilotCliSessionContent falls back to first dir when targetCwd not found in any jsonl", () => {
    const sessionStateDir = createTempDir("mm-copilot-state-");
    const subDir = path.join(sessionStateDir, "session-fb");
    writeText(path.join(subDir, "data.jsonl"), "some real content here");
    const result = sessionEnd.findCopilotCliSessionContent(sessionStateDir, "/nonexistent/path");
    expect(result).toBe("some real content here");
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

  it("increments transcript turn count from payload assistant when transcript is empty", () => {
    const homeDir = createTempDir("mm-home-");
    const vaultPath = createTempDir("mm-vault-");
    const transcriptPath = path.join(createTempDir("mm-tr-"), "session.jsonl");
    const sessionId = "session-stop-empty-payload";

    writeText(transcriptPath, "");

    const result = runScript("session-end.js", {
      payload: {
        hook_event_name: "Stop",
        cwd: hooksRoot,
        transcript_path: transcriptPath,
        session_id: sessionId,
        last_assistant_message: "assistant from payload",
      },
      env: buildEnv(homeDir, { MEMORY_MASON_VAULT_PATH: vaultPath }),
    });

    const statePath = resolveCaptureStatePath(vaultPath, "ai-knowledge");
    const state = JSON.parse(fs.readFileSync(statePath, "utf-8"));

    expect(result.status).toBe(0);
    expect(state.transcriptTurnCounts[sessionId]).toBe(2);
  });
});

describe("session-end.js readConfigText with existing file", () => {
  it("uses memory-mason.json when no env vault path is set", () => {
    const homeDir = createTempDir("mm-home-");
    const vaultPath = createTempDir("mm-vault-");
    const cwd = createTempDir("mm-cwd-");
    const transcriptPath = path.join(createTempDir("mm-tr-"), "session.jsonl");

    writeText(
      path.join(cwd, "memory-mason.json"),
      JSON.stringify({ vaultPath, subfolder: "ai-knowledge" }),
    );
    writeText(transcriptPath, buildTranscript(2));

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
    expect(result.stderr).toBe("");
    expect(
      fs.readFileSync(buildDailyChunkPath(vaultPath, "ai-knowledge", today(), 1), "utf-8"),
    ).toContain("cfg-test /");
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
