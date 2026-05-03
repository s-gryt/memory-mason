"use strict";

const {
  extractHookEventName,
  buildPromptExpansionText,
  getMmCommandToken,
  isMmCommand,
  extractPromptText,
  extractPromptEntry,
} = require("../lib/prompt");

const MM_COMMAND_NAMES = ["mma", "mmc", "mml", "mms", "mmq", "mmsetup"];

describe("prompt helpers", () => {
  it("extracts hook event name from known fields", () => {
    expect(extractHookEventName({ hook_event_name: "UserPromptExpansion" })).toBe(
      "UserPromptExpansion",
    );
    expect(extractHookEventName({ hookEventName: "user-prompt-submit" })).toBe(
      "user-prompt-submit",
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
      extractPromptEntry("claude-code", {
        hook_event_name: "UserPromptExpansion",
        prompt: "/caveman explain",
        command_name: "caveman:caveman",
      }),
    ).toEqual({
      entryName: "UserPromptExpansion",
      text: "/caveman explain\ncommand: caveman:caveman",
    });
  });

  it("returns Memory Mason prompt expansion entry with derived command token", () => {
    expect(
      extractPromptEntry("claude-code", {
        hook_event_name: "UserPromptExpansion",
        prompt: "",
        expansion_type: "skill",
        command_name: "memory-mason:mmq",
      }),
    ).toEqual({
      entryName: "UserPromptExpansion",
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
    expect(extractPromptText("copilot-vscode", { prompt: "  /mmc  " })).toBe("/mmc");
  });

  it("reads prompt for claude code", () => {
    expect(extractPromptText("claude-code", { prompt: "/mml" })).toBe("/mml");
  });

  it("reads prompt for codex", () => {
    expect(extractPromptText("codex", { prompt: "$mmq hooks" })).toBe("$mmq hooks");
  });

  it("falls back across known copilot cli prompt fields", () => {
    expect(extractPromptText("copilot-cli", { initialPrompt: "/mms" })).toBe("/mms");
    expect(extractPromptText("copilot-cli", { userPrompt: "/mmq writer" })).toBe("/mmq writer");
  });

  it("returns empty string when prompt missing", () => {
    expect(extractPromptText("copilot-vscode", {})).toBe("");
  });

  it("throws for unsupported platform", () => {
    expect(() => extractPromptText("unknown", { prompt: "/mmc" })).toThrow(
      "unsupported platform: unknown",
    );
  });

  it("returns user prompt entry for non-expansion events", () => {
    expect(
      extractPromptEntry("claude-code", { hook_event_name: "UserPromptSubmit", prompt: "/mml" }),
    ).toEqual({
      entryName: "UserPrompt",
      text: "/mml",
    });
  });
});
