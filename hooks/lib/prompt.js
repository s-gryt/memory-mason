"use strict";

const {
  PLATFORM_COPILOT_VSCODE,
  PLATFORM_CLAUDE_CODE,
  PLATFORM_COPILOT_CLI,
  PLATFORM_CODEX,
} = require("./platforms");
const { HOOK_ENTRY_USER_PROMPT_EXPANSION, HOOK_ENTRY_USER_PROMPT } = require("./hook-events");

const firstNonEmptyString = (values) => {
  const stringValues = values.filter((value) => typeof value === "string");
  const match = stringValues.find((value) => value.trim() !== "");
  return typeof match === "string" ? match.trim() : "";
};

const MM_COMMAND_NAMES = Object.freeze(["mma", "mmc", "mml", "mms", "mmq", "mmsetup"]);

const MM_COMMAND_TOKENS = new Set(
  MM_COMMAND_NAMES.flatMap((commandName) => [`/${commandName}`, `/memory-mason:${commandName}`]),
);

const getMmCommandToken = (value) => {
  if (typeof value !== "string") {
    return "";
  }

  const trimmedValue = value.trim();
  if (trimmedValue === "") {
    return "";
  }

  const normalizedValue = trimmedValue.startsWith("/") ? trimmedValue : `/${trimmedValue}`;
  return MM_COMMAND_TOKENS.has(normalizedValue) ? normalizedValue : "";
};

const extractCommandName = (input) =>
  firstNonEmptyString([
    input !== null && typeof input === "object" && !Array.isArray(input) ? input.command_name : "",
    input !== null && typeof input === "object" && !Array.isArray(input) ? input.commandName : "",
  ]);

const isMmCommand = (value) => {
  if (typeof value !== "string") {
    return false;
  }

  const trimmedValue = value.trim();
  const firstToken = trimmedValue.split(/\s+/, 1)[0];
  return MM_COMMAND_TOKENS.has(firstToken);
};

const extractHookEventName = (input) =>
  firstNonEmptyString([
    input !== null && typeof input === "object" && !Array.isArray(input)
      ? input.hook_event_name
      : "",
    input !== null && typeof input === "object" && !Array.isArray(input) ? input.hookEventName : "",
  ]);

const buildPromptExpansionText = (input) => {
  const prompt = firstNonEmptyString([input.prompt]);
  const expansionType = firstNonEmptyString([input.expansion_type, input.expansionType]);
  const commandName = extractCommandName(input);
  const commandArgs = firstNonEmptyString([input.command_args, input.commandArgs]);
  const commandSource = firstNonEmptyString([input.command_source, input.commandSource]);
  const mmCommandToken = prompt === "" ? getMmCommandToken(commandName) : "";

  return [
    prompt,
    mmCommandToken,
    expansionType === "" ? "" : `type: ${expansionType}`,
    commandName === "" ? "" : `command: ${commandName}`,
    commandArgs === "" ? "" : `args: ${commandArgs}`,
    commandSource === "" ? "" : `source: ${commandSource}`,
  ]
    .filter((value) => value !== "")
    .join("\n");
};

const extractPromptText = (platform, input) => {
  const mmCommandToken = getMmCommandToken(extractCommandName(input));

  if (
    platform === PLATFORM_COPILOT_VSCODE ||
    platform === PLATFORM_CLAUDE_CODE ||
    platform === PLATFORM_CODEX
  ) {
    return firstNonEmptyString([input.prompt, mmCommandToken]);
  }

  if (platform === PLATFORM_COPILOT_CLI) {
    return firstNonEmptyString([
      input.prompt,
      input.userPrompt,
      input.initialPrompt,
      mmCommandToken,
    ]);
  }

  throw new Error(`unsupported platform: ${platform}`);
};

const extractPromptEntry = (platform, input) => {
  if (
    platform === PLATFORM_CLAUDE_CODE &&
    extractHookEventName(input) === HOOK_ENTRY_USER_PROMPT_EXPANSION
  ) {
    return {
      entryName: HOOK_ENTRY_USER_PROMPT_EXPANSION,
      text: buildPromptExpansionText(input),
    };
  }

  return {
    entryName: HOOK_ENTRY_USER_PROMPT,
    text: extractPromptText(platform, input),
  };
};

module.exports = {
  extractHookEventName,
  buildPromptExpansionText,
  getMmCommandToken,
  isMmCommand,
  extractPromptText,
  extractPromptEntry,
};
