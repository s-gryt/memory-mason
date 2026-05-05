"use strict";

const {
  extractHookEventName,
  buildPromptExpansionText,
  getMmCommandToken,
  isMmCommand,
  extractPromptText,
  extractPromptEntry,
} = require("../lib/prompt");
const {
  TEST_HOOK_ENTRY_USER_PROMPT: HOOK_ENTRY_USER_PROMPT,
  TEST_HOOK_ENTRY_USER_PROMPT_EXPANSION: HOOK_ENTRY_USER_PROMPT_EXPANSION,
  TEST_HOOK_ENTRY_USER_PROMPT_SUBMIT: HOOK_ENTRY_USER_PROMPT_SUBMIT,
  TEST_HOOK_EVENT_USER_PROMPT_SUBMIT_KEBAB: HOOK_EVENT_USER_PROMPT_SUBMIT_KEBAB,
  TEST_PLATFORM_CLAUDE_CODE: PLATFORM_CLAUDE_CODE,
  TEST_PLATFORM_CODEX: PLATFORM_CODEX,
  TEST_PLATFORM_COPILOT_CLI: PLATFORM_COPILOT_CLI,
  TEST_PLATFORM_COPILOT_VSCODE: PLATFORM_COPILOT_VSCODE,
} = require("./helpers/test-constants");

const MM_COMMAND_NAMES = ["mma", "mmc", "mml", "mms", "mmq", "mmsetup"];

describe("prompt helpers", () => {
  it("extracts hook event name from known fields", () => {
    expect(extractHookEventName({ hook_event_name: HOOK_ENTRY_USER_PROMPT_EXPANSION })).toBe(
      HOOK_ENTRY_USER_PROMPT_EXPANSION,
    );
    expect(extractHookEventName({ hookEventName: HOOK_EVENT_USER_PROMPT_SUBMIT_KEBAB })).toBe(
      HOOK_EVENT_USER_PROMPT_SUBMIT_KEBAB,
    );
  });

  it("returns empty event name for invalid input", () => {
    expect(extractHookEventName(null)).toBe("");
    expect(extractHookEventName("not-an-object")).toBe("");
  });

  it("builds rich prompt expansion text", () => {
    expect(
      buildPromptExpansionText({
        prompt: "/caveman explain",
        expansion_type: "slash_command",
        command_name: "caveman:caveman",
        command_args: "explain",
        command_source: "plugin",
      }),
    ).toBe(
      "/caveman explain\ntype: slash_command\ncommand: caveman:caveman\nargs: explain\nsource: plugin",
    );
  });

  it("omits empty optional prompt expansion fields", () => {
    expect(
      buildPromptExpansionText({
        prompt: "/model",
        expansion_type: "",
        command_name: "",
        command_args: "",
        command_source: "",
      }),
    ).toBe("/model");
  });

  it("prepends Memory Mason command token for empty prompt expansion", () => {
    expect(
      buildPromptExpansionText({
        prompt: "",
        expansion_type: "skill",
        command_name: "memory-mason:mmc",
      }),
    ).toBe("/memory-mason:mmc\ntype: skill\ncommand: memory-mason:mmc");
  });

  it("returns prompt expansion entry for Claude UserPromptExpansion", () => {
    expect(
      extractPromptEntry(PLATFORM_CLAUDE_CODE, {
        hook_event_name: HOOK_ENTRY_USER_PROMPT_EXPANSION,
        prompt: "/caveman explain",
        command_name: "caveman:caveman",
      }),
    ).toEqual({
      entryName: HOOK_ENTRY_USER_PROMPT_EXPANSION,
      text: "/caveman explain\ncommand: caveman:caveman",
    });
  });

  it("returns Memory Mason prompt expansion entry with derived command token", () => {
    expect(
      extractPromptEntry(PLATFORM_CLAUDE_CODE, {
        hook_event_name: HOOK_ENTRY_USER_PROMPT_EXPANSION,
        prompt: "",
        expansion_type: "skill",
        command_name: "memory-mason:mmq",
      }),
    ).toEqual({
      entryName: HOOK_ENTRY_USER_PROMPT_EXPANSION,
      text: "/memory-mason:mmq\ntype: skill\ncommand: memory-mason:mmq",
    });
  });

  it("normalizes allowlisted Memory Mason command tokens", () => {
    MM_COMMAND_NAMES.forEach((commandName) => {
      expect(getMmCommandToken(commandName)).toBe(`/${commandName}`);
      expect(getMmCommandToken(`/${commandName}`)).toBe(`/${commandName}`);
      expect(getMmCommandToken(`memory-mason:${commandName}`)).toBe(`/memory-mason:${commandName}`);
      expect(getMmCommandToken(`/memory-mason:${commandName}`)).toBe(
        `/memory-mason:${commandName}`,
      );
    });
  });

  it("detects all short and namespaced Memory Mason commands", () => {
    MM_COMMAND_NAMES.forEach((commandName) => {
      expect(isMmCommand(`/${commandName}`)).toBe(true);
      expect(isMmCommand(` /memory-mason:${commandName} `)).toBe(true);
    });
  });

  it("does not detect non-Memory Mason commands", () => {
    expect(getMmCommandToken(null)).toBe("");
    expect(getMmCommandToken("   ")).toBe("");
    expect(getMmCommandToken("memory-mason:mmwhatever")).toBe("");
    expect(isMmCommand("/caveman:caveman")).toBe(false);
    expect(isMmCommand("/mmwhatever")).toBe(false);
    expect(isMmCommand("/memory-mason:mmwhatever arg")).toBe(false);
    expect(isMmCommand("normal prompt")).toBe(false);
    expect(isMmCommand(null)).toBe(false);
  });
});

describe("extractPromptText", () => {
  it("reads prompt for copilot vscode", () => {
    expect(extractPromptText(PLATFORM_COPILOT_VSCODE, { prompt: "  /mmc  " })).toBe("/mmc");
  });

  it("reads prompt for claude code", () => {
    expect(extractPromptText(PLATFORM_CLAUDE_CODE, { prompt: "/mml" })).toBe("/mml");
  });

  it("reads prompt for codex", () => {
    expect(extractPromptText(PLATFORM_CODEX, { prompt: "$mmq hooks" })).toBe("$mmq hooks");
  });

  it("falls back across known copilot cli prompt fields", () => {
    expect(extractPromptText(PLATFORM_COPILOT_CLI, { initialPrompt: "/mms" })).toBe("/mms");
    expect(extractPromptText(PLATFORM_COPILOT_CLI, { userPrompt: "/mmq writer" })).toBe(
      "/mmq writer",
    );
  });

  it("falls back to camelCase commandName for derived Memory Mason prompt token", () => {
    expect(extractPromptText(PLATFORM_CLAUDE_CODE, { commandName: "memory-mason:mmc" })).toBe(
      "/memory-mason:mmc",
    );
  });

  it("returns empty string for array input", () => {
    expect(extractPromptText(PLATFORM_CLAUDE_CODE, [])).toBe("");
  });

  it("returns empty string when prompt missing", () => {
    expect(extractPromptText(PLATFORM_COPILOT_VSCODE, {})).toBe("");
  });

  it("throws for unsupported platform", () => {
    expect(() => extractPromptText("unknown", { prompt: "/mmc" })).toThrow(
      "unsupported platform: unknown",
    );
  });

  it("returns user prompt entry for non-expansion events", () => {
    expect(
      extractPromptEntry(PLATFORM_CLAUDE_CODE, {
        hook_event_name: HOOK_ENTRY_USER_PROMPT_SUBMIT,
        prompt: "/mml",
      }),
    ).toEqual({
      entryName: HOOK_ENTRY_USER_PROMPT,
      text: "/mml",
    });
  });
});
