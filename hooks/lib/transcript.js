"use strict";

const { truncateContext } = require("./vault");

const assertNonEmptyString = (name, value) => {
  if (typeof value !== "string" || value === "") {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
};

const assertPositiveInteger = (name, value) => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
};

const extractTagText = (content, tagName) => {
  if (typeof content !== "string" || typeof tagName !== "string" || tagName === "") {
    return "";
  }

  const match = content.match(new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`));
  return Array.isArray(match) && typeof match[1] === "string" ? match[1] : "";
};

const stripAnsiEscapeSequences = (content) => {
  if (typeof content !== "string") {
    return "";
  }

  let index = 0;
  let result = "";

  while (index < content.length) {
    const isEscape = content.charCodeAt(index) === 27;
    const hasCsiPrefix = content[index + 1] === "[";

    if (isEscape && hasCsiPrefix) {
      let probe = index + 2;

      while (probe < content.length) {
        const code = content.charCodeAt(probe);
        const isDigit = code >= 48 && code <= 57;
        const isSemicolon = content[probe] === ";";
        if (!isDigit && !isSemicolon) {
          break;
        }
        probe += 1;
      }

      if (probe < content.length && content[probe] === "m") {
        index = probe + 1;
        continue;
      }
    }

    result += content[index];
    index += 1;
  }

  return result;
};

const normalizeTranscriptText = (content) => {
  if (typeof content !== "string") {
    return "";
  }

  const localCommandStdout = extractTagText(content, "local-command-stdout");
  if (localCommandStdout !== "") {
    return stripAnsiEscapeSequences(localCommandStdout).trim();
  }

  const commandName = extractTagText(content, "command-name").trim();
  if (commandName !== "") {
    const commandArgs = extractTagText(content, "command-args").trim();
    return [commandName, commandArgs].filter((part) => part !== "").join(" ");
  }

  return content;
};

const extractEntryPayload = (entry) => {
  const emptyPayload = {
    role: "",
    content: "",
  };

  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    return emptyPayload;
  }

  if (
    entry.message !== null &&
    typeof entry.message === "object" &&
    !Array.isArray(entry.message)
  ) {
    return {
      role: entry.message.role,
      content: entry.message.content,
    };
  }

  if (entry.type === "user.message" || entry.type === "assistant.message") {
    const role = entry.type === "user.message" ? "user" : "assistant";
    const data = entry.data;
    return {
      role,
      content:
        data !== null && typeof data === "object" && !Array.isArray(data) ? data.content : "",
    };
  }

  return {
    role: entry.role,
    content: entry.content,
  };
};

const isTranscriptTextBlock = (block) =>
  block !== null &&
  typeof block === "object" &&
  !Array.isArray(block) &&
  block.type === "text" &&
  typeof block.text === "string";

const extractTextContentFromString = (rawContent) => {
  if (typeof rawContent !== "string") {
    return "";
  }

  return normalizeTranscriptText(rawContent);
};

const extractTextContentFromBlockArray = (rawContent) => {
  if (!Array.isArray(rawContent)) {
    return "";
  }

  return normalizeTranscriptText(
    rawContent
      .filter((block) => isTranscriptTextBlock(block))
      .map((block) => block.text)
      .join("\n"),
  );
};

const extractTextContent = (rawContent) => {
  const extractionStrategies = [extractTextContentFromString, extractTextContentFromBlockArray];
  const extractedContent = extractionStrategies
    .map((extractContent) => extractContent(rawContent))
    .find((content) => content !== "");

  if (typeof extractedContent === "string") {
    return extractedContent;
  }

  return "";
};

const parseJsonlLine = (line) => {
  try {
    return JSON.parse(line);
  } catch (_error) {
    return null;
  }
};

const isSupportedTranscriptRole = (role) => role === "user" || role === "assistant";

const mapEntryToTranscriptTurn = (entry) => {
  const payload = extractEntryPayload(entry);
  if (!isSupportedTranscriptRole(payload.role)) {
    return null;
  }

  const textContent = extractTextContent(payload.content);
  if (textContent.trim() === "") {
    return null;
  }

  return {
    role: payload.role,
    content: textContent,
  };
};

const isNotNull = (value) => value !== null;

const parseJsonlTranscript = (content) => {
  assertNonEmptyString("content", content);

  return content
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => parseJsonlLine(line))
    .filter((entry) => isNotNull(entry))
    .map((entry) => mapEntryToTranscriptTurn(entry))
    .filter((turn) => isNotNull(turn));
};

const filterMmTurns = (turns) => {
  if (!Array.isArray(turns)) {
    throw new Error("turns must be an array");
  }

  let skipAssistantAfterMm = false;
  const filteredTurns = [];

  turns.forEach((turn) => {
    const isUserMmCommand =
      turn.role === "user" && typeof turn.content === "string" && turn.content.startsWith("/mm");

    if (isUserMmCommand) {
      skipAssistantAfterMm = true;
      return;
    }

    if (skipAssistantAfterMm && turn.role === "assistant") {
      skipAssistantAfterMm = false;
      return;
    }

    if (skipAssistantAfterMm && turn.role !== "assistant") {
      skipAssistantAfterMm = false;
    }

    filteredTurns.push(turn);
  });

  return filteredTurns;
};

const selectRecentTurns = (turns, maxTurns) => {
  if (!Array.isArray(turns)) {
    throw new Error("turns must be an array");
  }

  assertPositiveInteger("maxTurns", maxTurns);

  if (turns.length <= maxTurns) {
    return turns.slice();
  }

  return turns.slice(turns.length - maxTurns);
};

const renderTurnsAsMarkdown = (turns) => {
  if (!Array.isArray(turns) || turns.length === 0) {
    throw new Error("turns must be a non-empty array");
  }

  const markdownLines = turns.map((turn, index) => {
    if (turn === null || typeof turn !== "object" || Array.isArray(turn)) {
      throw new Error(`turn at index ${index} must be an object`);
    }

    if (turn.role !== "user" && turn.role !== "assistant") {
      throw new Error(`turn at index ${index} has invalid role`);
    }

    if (typeof turn.content !== "string" || turn.content === "") {
      throw new Error(`turn at index ${index} must have non-empty content`);
    }

    const label = turn.role === "user" ? "User" : "Assistant";
    return `**${label}:** ${turn.content}\n`;
  });

  return markdownLines.join("\n");
};

const buildFullTranscript = (content) => {
  if (content === "") {
    return {
      markdown: "",
      turnCount: 0,
    };
  }

  const turns = parseJsonlTranscript(content);

  if (turns.length === 0) {
    return {
      markdown: "",
      turnCount: 0,
    };
  }

  return {
    markdown: renderTurnsAsMarkdown(turns),
    turnCount: turns.length,
  };
};

const buildTranscriptExcerpt = (content, maxTurns, maxChars) => {
  assertPositiveInteger("maxTurns", maxTurns);
  assertPositiveInteger("maxChars", maxChars);

  const turns = parseJsonlTranscript(content);
  const recentTurns = selectRecentTurns(turns, maxTurns);

  if (recentTurns.length === 0) {
    return {
      markdown: "",
      turnCount: 0,
    };
  }

  const markdown = renderTurnsAsMarkdown(recentTurns);
  const truncatedMarkdown = truncateContext(markdown, maxChars);

  return {
    markdown: truncatedMarkdown,
    turnCount: recentTurns.length,
  };
};

module.exports = {
  extractTagText,
  stripAnsiEscapeSequences,
  normalizeTranscriptText,
  parseJsonlTranscript,
  filterMmTurns,
  selectRecentTurns,
  renderTurnsAsMarkdown,
  buildFullTranscript,
  buildTranscriptExcerpt,
};
