"use strict";

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
  const commandName = firstNonEmptyString([input.command_name, input.commandName]);
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
  if (platform === "copilot-vscode" || platform === "claude-code" || platform === "codex") {
    return firstNonEmptyString([input.prompt]);
  }

  if (platform === "copilot-cli") {
    return firstNonEmptyString([input.prompt, input.userPrompt, input.initialPrompt]);
  }

  throw new Error(`unsupported platform: ${platform}`);
};

const extractPromptEntry = (platform, input) => {
  if (platform === "claude-code" && extractHookEventName(input) === "UserPromptExpansion") {
    return {
      entryName: "UserPromptExpansion",
      text: buildPromptExpansionText(input),
    };
  }

  return {
    entryName: "UserPrompt",
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
