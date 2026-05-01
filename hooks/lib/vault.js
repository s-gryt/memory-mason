"use strict";

const path = require("node:path");
const { assertNonEmptyString } = require("./config");

const assertString = (name, value) => {
  if (typeof value !== "string") {
    throw new Error(`${name} must be a string`);
  }
  return value;
};

const assertPositiveInteger = (name, value) => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
};

const buildKnowledgeIndexPath = (vaultPath, subfolder) => {
  const safeVaultPath = assertNonEmptyString("vaultPath", vaultPath);
  const safeSubfolder = assertNonEmptyString("subfolder", subfolder);
  return path.join(safeVaultPath, safeSubfolder, "knowledge", "index.md");
};

const buildHotCachePath = (vaultPath, subfolder) => {
  const safeVaultPath = assertNonEmptyString("vaultPath", vaultPath);
  const safeSubfolder = assertNonEmptyString("subfolder", subfolder);
  return path.join(safeVaultPath, safeSubfolder, "hot.md");
};

const buildDailyFilePath = (vaultPath, subfolder, dateIso) => {
  const safeVaultPath = assertNonEmptyString("vaultPath", vaultPath);
  const safeSubfolder = assertNonEmptyString("subfolder", subfolder);
  const safeDateIso = assertNonEmptyString("dateIso", dateIso);
  return path.join(safeVaultPath, safeSubfolder, "daily", `${safeDateIso}.md`);
};

const buildDailyHeader = (dateIso) => {
  const safeDateIso = assertNonEmptyString("dateIso", dateIso);
  return `# Daily Log: ${safeDateIso}\n\n## Sessions\n\n`;
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
  primarySectionHeading = "Knowledge Base Index",
  primaryPlaceholderText = "(empty - no articles compiled yet)",
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
  const renderedRecentLog = renderWithPlaceholder(safeRecentLogText, "(no recent daily log)");
  return (
    "## Today\n" +
    today +
    "\n\n---\n\n## " +
    safePrimarySectionHeading +
    "\n\n" +
    renderedIndex +
    "\n\n---\n\n## Recent Daily Log\n\n" +
    renderedRecentLog
  );
};

const truncateContext = (text, maxChars) => {
  const safeText = assertString("text", text);
  assertPositiveInteger("maxChars", maxChars);
  if (safeText.length <= maxChars) {
    return safeText;
  }
  return `${safeText.slice(0, maxChars)}\n\n...(truncated)`;
};

const buildDailyEntry = (toolName, resultText, timestamp) => {
  const safeToolName = assertNonEmptyString("toolName", toolName);
  const safeResultText = assertString("resultText", resultText);
  const safeTimestamp = assertNonEmptyString("timestamp", timestamp);
  if (!/^\d{2}:\d{2}:\d{2}$/.test(safeTimestamp)) {
    throw new Error("timestamp must be in HH:MM:SS format");
  }
  return `\n**[${safeTimestamp}] ${safeToolName}**\n${safeResultText}\n`;
};

const buildAssistantReplyEntry = (content, timestamp) => {
  const safeContent = assertString("content", content);
  const safeTimestamp = assertNonEmptyString("timestamp", timestamp);
  if (!/^\d{2}:\d{2}:\d{2}$/.test(safeTimestamp)) {
    throw new Error("timestamp must be in HH:MM:SS format");
  }
  return `\n**[${safeTimestamp}] AssistantReply**\n${safeContent}\n`;
};

const buildSessionHeader = (sessionId, source, timestamp) => {
  const safeSessionId = assertString("sessionId", sessionId);
  const safeSource = assertString("source", source);
  const safeTimestamp = assertNonEmptyString("timestamp", timestamp);
  const renderedSessionId = safeSessionId === "" ? "unknown" : safeSessionId;
  const renderedSource = safeSource === "" ? "unknown" : safeSource;
  return `\n## Session [${safeTimestamp}] ${renderedSessionId} / ${renderedSource}\n\n`;
};

const localNow = () => {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return {
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`,
  };
};

const localYesterday = () => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const pad = (n) => String(n).padStart(2, "0");
  return `${yesterday.getFullYear()}-${pad(yesterday.getMonth() + 1)}-${pad(yesterday.getDate())}`;
};

const buildDailyFolderPath = (vaultPath, subfolder, dateIso) => {
  const safeVaultPath = assertNonEmptyString("vaultPath", vaultPath);
  const safeSubfolder = assertNonEmptyString("subfolder", subfolder);
  const safeDateIso = assertNonEmptyString("dateIso", dateIso);
  return path.join(safeVaultPath, safeSubfolder, "daily", safeDateIso);
};

const buildDailyChunkPath = (vaultPath, subfolder, dateIso, chunkNum) => {
  const safeVaultPath = assertNonEmptyString("vaultPath", vaultPath);
  const safeSubfolder = assertNonEmptyString("subfolder", subfolder);
  const safeDateIso = assertNonEmptyString("dateIso", dateIso);
  if (!Number.isInteger(chunkNum) || chunkNum <= 0) {
    throw new Error("chunkNum must be a positive integer");
  }
  if (chunkNum > 999) {
    throw new Error("chunkNum must be less than or equal to 999");
  }
  return path.join(
    safeVaultPath,
    safeSubfolder,
    "daily",
    safeDateIso,
    `${String(chunkNum).padStart(3, "0")}.md`,
  );
};

const buildDailyIndexPath = (vaultPath, subfolder, dateIso) => {
  const safeVaultPath = assertNonEmptyString("vaultPath", vaultPath);
  const safeSubfolder = assertNonEmptyString("subfolder", subfolder);
  const safeDateIso = assertNonEmptyString("dateIso", dateIso);
  return path.join(safeVaultPath, safeSubfolder, "daily", safeDateIso, "index.md");
};

const buildDailyMetaPath = (vaultPath, subfolder, dateIso) => {
  const safeVaultPath = assertNonEmptyString("vaultPath", vaultPath);
  const safeSubfolder = assertNonEmptyString("subfolder", subfolder);
  const safeDateIso = assertNonEmptyString("dateIso", dateIso);
  return path.join(safeVaultPath, safeSubfolder, "daily", safeDateIso, "meta.json");
};

const buildChunkHeader = (dateIso, chunkNum) => {
  const safeDateIso = assertNonEmptyString("dateIso", dateIso);
  if (!Number.isInteger(chunkNum) || chunkNum <= 0) {
    throw new Error("chunkNum must be a positive integer");
  }
  if (chunkNum > 999) {
    throw new Error("chunkNum must be less than or equal to 999");
  }
  return `# Daily Log: ${safeDateIso} (Part ${chunkNum})\n\n## Sessions\n\n`;
};

const buildChunkIndexContent = (dateIso, chunkCount) => {
  const safeDateIso = assertNonEmptyString("dateIso", dateIso);
  if (!Number.isInteger(chunkCount) || chunkCount <= 0) {
    throw new Error("chunkCount must be a positive integer");
  }
  if (chunkCount > 999) {
    throw new Error("chunkCount must be less than or equal to 999");
  }
  const bullets = Array.from({ length: chunkCount }, (_, index) => {
    const chunkNum = index + 1;
    const padded = String(chunkNum).padStart(3, "0");
    return `- [[daily/${safeDateIso}/${padded}|Part ${chunkNum}]]`;
  });
  return `# Daily Log: ${safeDateIso}\n\n## Parts\n\n${bullets.join("\n")}\n`;
};

module.exports = {
  buildKnowledgeIndexPath,
  buildHotCachePath,
  buildDailyFilePath,
  buildDailyHeader,
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
