/**
 * This module handles vault logic.
 */
"use strict";

const path = require("node:path");
const { MAX_DAILY_CHUNK_COUNT, CHUNK_ID_WIDTH } = require("./constants");
const {
  DAILY_LOG_HEADING_PREFIX,
  SESSIONS_HEADING,
  PARTS_HEADING,
  TODAY_HEADING,
  KNOWLEDGE_BASE_INDEX_HEADING,
  RECENT_DAILY_LOG_HEADING,
  ASSISTANT_REPLY_ENTRY_NAME,
  PLACEHOLDER_NO_ARTICLES,
  PLACEHOLDER_NO_RECENT_DAILY_LOG,
  UNKNOWN_LABEL,
  TRUNCATION_MARKER,
} = require("./markdown-labels");
const {
  VAULT_RAW_DIR_NAME,
  VAULT_META_DIR_NAME,
  ROOT_INDEX_FILE_NAME,
  SESSION_CONTEXT_FILE_NAME,
  DAILY_META_FILE_NAME,
} = require("./vault-paths");
const { assertNonEmptyString, assertString, assertPositiveInteger } = require("../shared/assert");

const padTwo = (n) => String(n).padStart(2, "0");

const assertTimestamp = (timestamp) => {
  if (!/^\d{2}:\d{2}:\d{2}$/.test(timestamp)) {
    throw new Error("timestamp must be in HH:MM:SS format");
  }
};

const assertDailyPathArgs = (vaultPath, subfolder, dateIso) => ({
  safeVaultPath: assertNonEmptyString("vaultPath", vaultPath),
  safeSubfolder: assertNonEmptyString("subfolder", subfolder),
  safeDateIso: assertNonEmptyString("dateIso", dateIso),
});

const buildDailyRawPath = (vaultPath, subfolder, dateIso, ...tail) => {
  const { safeVaultPath, safeSubfolder, safeDateIso } = assertDailyPathArgs(
    vaultPath,
    subfolder,
    dateIso,
  );
  return path.join(safeVaultPath, safeSubfolder, VAULT_RAW_DIR_NAME, safeDateIso, ...tail);
};

const assertChunkOrdinal = (name, value) => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  if (value > MAX_DAILY_CHUNK_COUNT) {
    throw new Error(`${name} must be less than or equal to 999`);
  }
  return value;
};

const buildRootIndexPath = (vaultPath, subfolder) => {
  const safeVaultPath = assertNonEmptyString("vaultPath", vaultPath);
  const safeSubfolder = assertNonEmptyString("subfolder", subfolder);
  return path.join(safeVaultPath, safeSubfolder, ROOT_INDEX_FILE_NAME);
};

const buildSessionContextPath = (vaultPath, subfolder) => {
  const safeVaultPath = assertNonEmptyString("vaultPath", vaultPath);
  const safeSubfolder = assertNonEmptyString("subfolder", subfolder);
  return path.join(safeVaultPath, safeSubfolder, VAULT_META_DIR_NAME, SESSION_CONTEXT_FILE_NAME);
};

const buildKnowledgeIndexPath = buildRootIndexPath;
const buildHotCachePath = buildSessionContextPath;

const buildDailyFilePath = (vaultPath, subfolder, dateIso) => {
  const safeVaultPath = assertNonEmptyString("vaultPath", vaultPath);
  const safeSubfolder = assertNonEmptyString("subfolder", subfolder);
  const safeDateIso = assertNonEmptyString("dateIso", dateIso);
  return path.join(safeVaultPath, safeSubfolder, VAULT_RAW_DIR_NAME, `${safeDateIso}.md`);
};

const buildDailyHeader = (dateIso) => {
  const safeDateIso = assertNonEmptyString("dateIso", dateIso);
  return `# ${DAILY_LOG_HEADING_PREFIX}${safeDateIso}\n\n## ${SESSIONS_HEADING}\n\n`;
};

const takeLastLines = (text, maxLines) => {
  const safeText = assertString("text", text);
  assertPositiveInteger("maxLines", maxLines);
  if (safeText === "") {
    return "";
  }
  return safeText.split("\n").slice(-maxLines).join("\n");
};

const renderWithPlaceholder = (valueText, placeholderText) => {
  const safeValueText = assertString("valueText", valueText);
  const safePlaceholderText = assertNonEmptyString("placeholderText", placeholderText);
  if (safeValueText === "") {
    return safePlaceholderText;
  }
  return safeValueText;
};

const buildAdditionalContext = (
  indexText,
  recentLogText,
  primarySectionHeading = KNOWLEDGE_BASE_INDEX_HEADING,
  primaryPlaceholderText = PLACEHOLDER_NO_ARTICLES,
) => {
  const safeIndexText = assertString("indexText", indexText);
  const safeRecentLogText = assertString("recentLogText", recentLogText);
  const safePrimarySectionHeading = assertNonEmptyString(
    "primarySectionHeading",
    primarySectionHeading,
  );
  const safePrimaryPlaceholderText = assertNonEmptyString(
    "primaryPlaceholderText",
    primaryPlaceholderText,
  );
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const renderedIndex = renderWithPlaceholder(safeIndexText, safePrimaryPlaceholderText);
  const renderedRecentLog = renderWithPlaceholder(
    safeRecentLogText,
    PLACEHOLDER_NO_RECENT_DAILY_LOG,
  );
  return `## ${TODAY_HEADING}\n${today}\n\n---\n\n## ${safePrimarySectionHeading}\n\n${renderedIndex}\n\n---\n\n## ${RECENT_DAILY_LOG_HEADING}\n\n${renderedRecentLog}`;
};

const truncateContext = (text, maxChars) => {
  const safeText = assertString("text", text);
  assertPositiveInteger("maxChars", maxChars);
  if (safeText.length <= maxChars) {
    return safeText;
  }
  return `${safeText.slice(0, maxChars)}\n\n${TRUNCATION_MARKER}`;
};

const buildDailyEntry = (toolName, resultText, timestamp) => {
  const safeToolName = assertNonEmptyString("toolName", toolName);
  const safeResultText = assertString("resultText", resultText);
  const safeTimestamp = assertNonEmptyString("timestamp", timestamp);
  assertTimestamp(safeTimestamp);
  return `\n**[${safeTimestamp}] ${safeToolName}**\n${safeResultText}\n`;
};

const buildAssistantReplyEntry = (content, timestamp) => {
  const safeContent = assertString("content", content);
  const safeTimestamp = assertNonEmptyString("timestamp", timestamp);
  assertTimestamp(safeTimestamp);
  return `\n**[${safeTimestamp}] ${ASSISTANT_REPLY_ENTRY_NAME}**\n${safeContent}\n`;
};

const buildSessionHeader = (sessionId, source, timestamp) => {
  const safeSessionId = assertString("sessionId", sessionId);
  const safeSource = assertString("source", source);
  const safeTimestamp = assertNonEmptyString("timestamp", timestamp);
  const renderedSessionId = safeSessionId === "" ? UNKNOWN_LABEL : safeSessionId;
  const renderedSource = safeSource === "" ? UNKNOWN_LABEL : safeSource;
  return `\n## Session [${safeTimestamp}] ${renderedSessionId} / ${renderedSource}\n\n`;
};

const localNow = () => {
  const now = new Date();
  return {
    date: `${now.getFullYear()}-${padTwo(now.getMonth() + 1)}-${padTwo(now.getDate())}`,
    time: `${padTwo(now.getHours())}:${padTwo(now.getMinutes())}:${padTwo(now.getSeconds())}`,
  };
};

const localYesterday = () => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return `${yesterday.getFullYear()}-${padTwo(yesterday.getMonth() + 1)}-${padTwo(yesterday.getDate())}`;
};

const buildDailyFolderPath = (vaultPath, subfolder, dateIso) => {
  return buildDailyRawPath(vaultPath, subfolder, dateIso);
};

const buildDailyChunkPath = (vaultPath, subfolder, dateIso, chunkNum) => {
  const safeChunkNum = assertChunkOrdinal("chunkNum", chunkNum);
  return buildDailyRawPath(
    vaultPath,
    subfolder,
    dateIso,
    `${String(safeChunkNum).padStart(CHUNK_ID_WIDTH, "0")}.md`,
  );
};

const buildDailyIndexPath = (vaultPath, subfolder, dateIso) => {
  return buildDailyRawPath(vaultPath, subfolder, dateIso, ROOT_INDEX_FILE_NAME);
};

const buildDailyMetaPath = (vaultPath, subfolder, dateIso) => {
  return buildDailyRawPath(vaultPath, subfolder, dateIso, DAILY_META_FILE_NAME);
};

const buildChunkHeader = (dateIso, chunkNum) => {
  const safeDateIso = assertNonEmptyString("dateIso", dateIso);
  const safeChunkNum = assertChunkOrdinal("chunkNum", chunkNum);
  return `# ${DAILY_LOG_HEADING_PREFIX}${safeDateIso} (Part ${safeChunkNum})\n\n## ${SESSIONS_HEADING}\n\n`;
};

const buildChunkIndexContent = (dateIso, chunkCount) => {
  const safeDateIso = assertNonEmptyString("dateIso", dateIso);
  const safeChunkCount = assertChunkOrdinal("chunkCount", chunkCount);
  const bullets = Array.from({ length: safeChunkCount }, (_, index) => {
    const chunkNum = index + 1;
    const padded = String(chunkNum).padStart(CHUNK_ID_WIDTH, "0");
    return `- [[${VAULT_RAW_DIR_NAME}/${safeDateIso}/${padded}|Part ${chunkNum}]]`;
  });
  return `# ${DAILY_LOG_HEADING_PREFIX}${safeDateIso}\n\n## ${PARTS_HEADING}\n\n${bullets.join("\n")}\n`;
};

module.exports = {
  buildRootIndexPath,
  buildSessionContextPath,
  buildKnowledgeIndexPath,
  buildHotCachePath,
  buildDailyFilePath,
  buildDailyHeader,
  assertDailyPathArgs,
  buildDailyFolderPath,
  buildDailyChunkPath,
  buildDailyIndexPath,
  buildDailyMetaPath,
  buildChunkHeader,
  buildChunkIndexContent,
  takeLastLines,
  buildAdditionalContext,
  truncateContext,
  buildDailyEntry,
  buildAssistantReplyEntry,
  buildSessionHeader,
  localNow,
  localYesterday,
};
