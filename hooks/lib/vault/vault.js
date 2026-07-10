/**
 * This module handles vault logic.
 */
"use strict";

const path = require("node:path");
const {
  MAX_DAILY_CHUNK_COUNT,
  CHUNK_ID_WIDTH,
  SESSION_CHUNK_TIME_WIDTH,
  SESSION_ID_SHORT_LENGTH,
  NO_SESSION_SID,
} = require("./constants");
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

const SESSION_HEADING_PREFIX = "Session";
const LEGACY_PARTS_HEADING = "Legacy";
const SID_SANITIZE_PATTERN = /[^a-z0-9]/g;
const TIME_PREFIX_PATTERN = new RegExp(`^\\d{${SESSION_CHUNK_TIME_WIDTH}}$`);

const padTwo = (n) => String(n).padStart(2, "0");

const assertTimestamp = (timestamp) => {
  if (!/^\d{2}:\d{2}:\d{2}$/.test(timestamp)) {
    throw new Error("timestamp must be in HH:MM:SS format");
  }
};

const assertTimePrefix = (timePrefix) => {
  if (!TIME_PREFIX_PATTERN.test(timePrefix)) {
    throw new Error("timePrefix must be in HHMMSS format");
  }
  return timePrefix;
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

const buildSessionSid = (sessionId) => {
  const safeSessionId = assertString("sessionId", sessionId);
  const sanitized = safeSessionId
    .toLowerCase()
    .replace(SID_SANITIZE_PATTERN, "")
    .slice(0, SESSION_ID_SHORT_LENGTH);
  return sanitized === "" ? NO_SESSION_SID : sanitized;
};

const buildSessionContext = (sessionId, platform, cwd) => {
  const safeSessionId = assertString("sessionId", sessionId);
  return {
    sessionId: safeSessionId,
    sid8: buildSessionSid(safeSessionId),
    platform: assertString("platform", platform),
    cwd: assertString("cwd", cwd),
  };
};

const defaultSessionContext = () => buildSessionContext("", "", "");

const assertSessionContext = (session) => {
  if (session === null || typeof session !== "object" || Array.isArray(session)) {
    throw new TypeError("session must be an object");
  }
  return {
    sessionId: assertString("session.sessionId", session.sessionId),
    sid8: assertNonEmptyString("session.sid8", session.sid8),
    platform: assertString("session.platform", session.platform),
    cwd: assertString("session.cwd", session.cwd),
  };
};

const buildDailyRawFilePath = (vaultPath, subfolder, dateIso, fileName) => {
  const safeFileName = assertNonEmptyString("fileName", fileName);
  return buildDailyRawPath(vaultPath, subfolder, dateIso, safeFileName);
};

const buildSessionChunkFileName = (timePrefix, sid8, chunkNum) => {
  const safeTimePrefix = assertTimePrefix(assertNonEmptyString("timePrefix", timePrefix));
  const safeSid8 = assertNonEmptyString("sid8", sid8);
  const safeChunkNum = assertChunkOrdinal("chunkNum", chunkNum);
  return `${safeTimePrefix}-${safeSid8}-${String(safeChunkNum).padStart(CHUNK_ID_WIDTH, "0")}.md`;
};

const buildSessionChunkHeader = (dateIso, sid8, chunkNum) => {
  const safeDateIso = assertNonEmptyString("dateIso", dateIso);
  const safeSid8 = assertNonEmptyString("sid8", sid8);
  const safeChunkNum = assertChunkOrdinal("chunkNum", chunkNum);
  return `# ${DAILY_LOG_HEADING_PREFIX}${safeDateIso} (${SESSION_HEADING_PREFIX} ${safeSid8}, Part ${safeChunkNum})\n\n`;
};

const buildSessionHeaderBlock = (session, startedIso) => {
  const safeSession = assertSessionContext(session);
  const safeStartedIso = assertNonEmptyString("startedIso", startedIso);
  const renderedSessionId = safeSession.sessionId === "" ? UNKNOWN_LABEL : safeSession.sessionId;
  const renderedPlatform = safeSession.platform === "" ? UNKNOWN_LABEL : safeSession.platform;
  const renderedCwd = safeSession.cwd === "" ? UNKNOWN_LABEL : safeSession.cwd;
  return `## ${SESSION_HEADING_PREFIX} ${safeSession.sid8}\n\n**session_id:** ${renderedSessionId}\n**source:** ${renderedPlatform}\n**project:** ${renderedCwd}\n**started:** ${safeStartedIso}\n\n`;
};

const assertIndexChunk = (chunk) => {
  if (chunk === null || typeof chunk !== "object" || Array.isArray(chunk)) {
    throw new Error("chunk must be an object");
  }
  const safeFile = assertNonEmptyString("chunk.file", chunk.file);
  const partNum = Number(chunk.id);
  assertChunkOrdinal("chunk.id", partNum);
  if (typeof chunk.sid8 === "string") {
    return {
      file: safeFile,
      partNum,
      sid8: assertNonEmptyString("chunk.sid8", chunk.sid8),
    };
  }
  return {
    file: safeFile,
    partNum,
    sid8: "",
  };
};

const buildChunkIndexContent = (subfolder, dateIso, chunks) => {
  const safeSubfolder = assertNonEmptyString("subfolder", subfolder);
  const safeDateIso = assertNonEmptyString("dateIso", dateIso);
  if (!Array.isArray(chunks) || chunks.length === 0) {
    throw new Error("chunks must be a non-empty array");
  }
  const sections = [];
  const sectionsByHeading = new Map();
  chunks.forEach((chunk) => {
    const safeChunk = assertIndexChunk(chunk);
    const heading =
      safeChunk.sid8 === "" ? LEGACY_PARTS_HEADING : `${SESSION_HEADING_PREFIX} ${safeChunk.sid8}`;
    const fileSansExt = safeChunk.file.replace(/\.md$/, "");
    const bullet = `- [[${safeSubfolder}/${VAULT_RAW_DIR_NAME}/${safeDateIso}/${fileSansExt}|Part ${safeChunk.partNum}]]`;
    if (!sectionsByHeading.has(heading)) {
      const section = { heading, bullets: [] };
      sectionsByHeading.set(heading, section);
      sections.push(section);
    }
    sectionsByHeading.get(heading).bullets.push(bullet);
  });
  const body = sections
    .map((section) => `### ${section.heading}\n\n${section.bullets.join("\n")}`)
    .join("\n\n");
  return `# ${DAILY_LOG_HEADING_PREFIX}${safeDateIso}\n\n## ${PARTS_HEADING}\n\n${body}\n`;
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
  buildDailyRawFilePath,
  buildChunkHeader,
  buildSessionSid,
  buildSessionContext,
  defaultSessionContext,
  assertSessionContext,
  buildSessionChunkFileName,
  buildSessionChunkHeader,
  buildSessionHeaderBlock,
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
