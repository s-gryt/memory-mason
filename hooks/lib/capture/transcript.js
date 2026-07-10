/**
 * This module handles transcript logic.
 */
"use strict";

const { getMmCommandToken, isMmCommand } = require("../prompt/prompt");
const { truncateContext } = require("../vault/vault");
const { CAPTURE_MODE_LITE, DEFAULT_CAPTURE_MODE } = require("../config/constants");
const {
  TRANSCRIPT_ROLE_USER,
  TRANSCRIPT_ROLE_ASSISTANT,
  TRANSCRIPT_BLOCK_TYPE_TEXT,
  TRANSCRIPT_TYPE_USER_MESSAGE,
  TRANSCRIPT_TYPE_ASSISTANT_MESSAGE,
} = require("./transcript-labels");
const { assertNonEmptyString, assertPositiveInteger } = require("../shared/assert");

const ANSI_ESCAPE_CHAR_CODE = 27;
const ASCII_ZERO_CHAR_CODE = 48;
const ASCII_NINE_CHAR_CODE = 57;

const extractTagText = (content, tagName) => {
  if (typeof content !== "string" || typeof tagName !== "string" || tagName === "") {
    return "";
  }

  const match = content.match(new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`));
  return Array.isArray(match) && typeof match[1] === "string" ? match[1] : "";
};

const isAsciiDigitCode = (code) => code >= ASCII_ZERO_CHAR_CODE && code <= ASCII_NINE_CHAR_CODE;

const findAnsiCsiEndIndex = (content, startIndex) => {
  const isEscape = content.charCodeAt(startIndex) === ANSI_ESCAPE_CHAR_CODE;
  const hasCsiPrefix = content[startIndex + 1] === "[";

  if (!isEscape || !hasCsiPrefix) {
    return -1;
  }

  let probe = startIndex + 2;

  while (probe < content.length) {
    const code = content.charCodeAt(probe);
    const isSemicolon = content[probe] === ";";
    if (!isAsciiDigitCode(code) && !isSemicolon) {
      break;
    }
    probe += 1;
  }

  if (probe < content.length && content[probe] === "m") {
    return probe;
  }

  return -1;
};

const stripAnsiEscapeSequences = (content) => {
  if (typeof content !== "string") {
    return "";
  }

  let index = 0;
  let result = "";

  while (index < content.length) {
    const csiEndIndex = findAnsiCsiEndIndex(content, index);

    if (csiEndIndex !== -1) {
      index = csiEndIndex + 1;
      continue;
    }

    result += content[index];
    index += 1;
  }

  return result;
};

const normalizeTranscriptText = (content, _captureMode = DEFAULT_CAPTURE_MODE) => {
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
    const normalizedMmCommand = getMmCommandToken(commandName);
    const renderedCommandName = normalizedMmCommand !== "" ? normalizedMmCommand : commandName;
    return [renderedCommandName, commandArgs].filter((part) => part !== "").join(" ");
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

  if (
    entry.type === TRANSCRIPT_TYPE_USER_MESSAGE ||
    entry.type === TRANSCRIPT_TYPE_ASSISTANT_MESSAGE
  ) {
    const role =
      entry.type === TRANSCRIPT_TYPE_USER_MESSAGE
        ? TRANSCRIPT_ROLE_USER
        : TRANSCRIPT_ROLE_ASSISTANT;
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
  block.type === TRANSCRIPT_BLOCK_TYPE_TEXT &&
  typeof block.text === "string";

const extractTextContentFromString = (rawContent, captureMode = DEFAULT_CAPTURE_MODE) => {
  if (typeof rawContent !== "string") {
    return "";
  }

  return normalizeTranscriptText(rawContent, captureMode);
};

const extractTextContentFromBlockArray = (rawContent, captureMode = DEFAULT_CAPTURE_MODE) => {
  if (!Array.isArray(rawContent)) {
    return "";
  }

  return normalizeTranscriptText(
    rawContent
      .filter((block) => isTranscriptTextBlock(block))
      .map((block) => block.text)
      .join("\n"),
    captureMode,
  );
};

const extractTextContent = (rawContent, captureMode = DEFAULT_CAPTURE_MODE) => {
  const extractionStrategies = [extractTextContentFromString, extractTextContentFromBlockArray];
  const extractedContent = extractionStrategies
    .map((extractContent) => extractContent(rawContent, captureMode))
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

const isSupportedTranscriptRole = (role) =>
  role === TRANSCRIPT_ROLE_USER || role === TRANSCRIPT_ROLE_ASSISTANT;

const mapEntryToTranscriptTurn = (entry, captureMode = DEFAULT_CAPTURE_MODE) => {
  const payload = extractEntryPayload(entry);
  if (!isSupportedTranscriptRole(payload.role)) {
    return null;
  }

  const textContent = extractTextContent(payload.content, captureMode);
  if (textContent.trim() === "") {
    return null;
  }

  return {
    role: payload.role,
    content: textContent,
  };
};

const isNotNull = (value) => value !== null;

const buildRoleRuns = (turns) => {
  return turns.reduce((runs, turn) => {
    const lastRun = runs[runs.length - 1];

    if (typeof lastRun === "undefined" || lastRun.role !== turn.role) {
      return runs.concat([{ role: turn.role, turns: [turn] }]);
    }

    return runs.slice(0, -1).concat([
      {
        role: lastRun.role,
        turns: lastRun.turns.concat([turn]),
      },
    ]);
  }, []);
};

const collapseAssistantRuns = (runs) => {
  return runs.flatMap((run) => {
    if (run.role !== TRANSCRIPT_ROLE_ASSISTANT) {
      return run.turns;
    }

    return run.turns.length === 0 ? [] : [run.turns[run.turns.length - 1]];
  });
};

const collapseIntermediateAssistants = (turns) => {
  if (!Array.isArray(turns)) {
    throw new Error("turns must be an array");
  }

  const roleRuns = buildRoleRuns(turns);
  return collapseAssistantRuns(roleRuns);
};

const parseJsonlTranscript = (content, captureMode = DEFAULT_CAPTURE_MODE) => {
  assertNonEmptyString("content", content);

  const turns = content
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => parseJsonlLine(line))
    .filter((entry) => isNotNull(entry))
    .map((entry) => mapEntryToTranscriptTurn(entry, captureMode))
    .filter((turn) => isNotNull(turn));

  return captureMode === CAPTURE_MODE_LITE ? collapseIntermediateAssistants(turns) : turns;
};

const filterMmTurns = (turns) => {
  if (!Array.isArray(turns)) {
    throw new Error("turns must be an array");
  }

  const transitionMmFilterState = (state, turn) => {
    const isUserMmCommand = turn.role === TRANSCRIPT_ROLE_USER && isMmCommand(turn.content);

    if (isUserMmCommand) {
      return {
        skipAssistantAfterMm: true,
        includeTurn: false,
      };
    }

    if (state.skipAssistantAfterMm && turn.role === TRANSCRIPT_ROLE_ASSISTANT) {
      return {
        skipAssistantAfterMm: true,
        includeTurn: false,
      };
    }

    return {
      skipAssistantAfterMm: false,
      includeTurn: true,
    };
  };

  const finalState = turns.reduce(
    (state, turn) => {
      const nextState = transitionMmFilterState(state, turn);
      const nextTurns = nextState.includeTurn ? state.turns.concat([turn]) : state.turns;
      return {
        skipAssistantAfterMm: nextState.skipAssistantAfterMm,
        turns: nextTurns,
      };
    },
    {
      skipAssistantAfterMm: false,
      turns: [],
    },
  );

  return finalState.turns;
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

  const assertRenderableTurn = (turn, index) => {
    if (turn === null || typeof turn !== "object" || Array.isArray(turn)) {
      throw new Error(`turn at index ${index} must be an object`);
    }

    if (turn.role !== TRANSCRIPT_ROLE_USER && turn.role !== TRANSCRIPT_ROLE_ASSISTANT) {
      throw new Error(`turn at index ${index} has invalid role`);
    }

    if (typeof turn.content !== "string" || turn.content === "") {
      throw new Error(`turn at index ${index} must have non-empty content`);
    }
  };

  const markdownLines = turns.map((turn, index) => {
    assertRenderableTurn(turn, index);

    const label = turn.role === TRANSCRIPT_ROLE_USER ? "User" : "Assistant";
    return `**${label}:** ${turn.content}\n`;
  });

  return markdownLines.join("\n");
};

const buildFullTranscript = (content, captureMode = DEFAULT_CAPTURE_MODE) => {
  if (content === "") {
    return {
      markdown: "",
      turnCount: 0,
    };
  }

  const turns = parseJsonlTranscript(content, captureMode);

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

const buildTranscriptExcerpt = (
  content,
  maxTurns,
  maxChars,
  captureMode = DEFAULT_CAPTURE_MODE,
) => {
  assertPositiveInteger("maxTurns", maxTurns);
  assertPositiveInteger("maxChars", maxChars);

  const turns = parseJsonlTranscript(content, captureMode);
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
  collapseIntermediateAssistants,
  parseJsonlTranscript,
  filterMmTurns,
  selectRecentTurns,
  renderTurnsAsMarkdown,
  buildFullTranscript,
  buildTranscriptExcerpt,
};
