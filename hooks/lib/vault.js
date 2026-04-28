'use strict';

const path = require('path');
const { assertNonEmptyString } = require('./config');

const assertString = (name, value) => {
  if (typeof value !== 'string') {
    throw new Error(name + ' must be a string');
  }
  return value;
};

const assertPositiveInteger = (name, value) => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(name + ' must be a positive integer');
  }
  return value;
};

const buildKnowledgeIndexPath = (vaultPath, subfolder) => {
  const safeVaultPath = assertNonEmptyString('vaultPath', vaultPath);
  const safeSubfolder = assertNonEmptyString('subfolder', subfolder);
  return path.join(safeVaultPath, safeSubfolder, 'knowledge', 'index.md');
};

const buildDailyFilePath = (vaultPath, subfolder, dateIso) => {
  const safeVaultPath = assertNonEmptyString('vaultPath', vaultPath);
  const safeSubfolder = assertNonEmptyString('subfolder', subfolder);
  const safeDateIso = assertNonEmptyString('dateIso', dateIso);
  return path.join(safeVaultPath, safeSubfolder, 'daily', safeDateIso + '.md');
};

const buildDailyHeader = (dateIso) => {
  const safeDateIso = assertNonEmptyString('dateIso', dateIso);
  return '# Daily Log: ' + safeDateIso + '\n\n## Sessions\n\n';
};

const takeLastLines = (text, maxLines) => {
  const safeText = assertString('text', text);
  assertPositiveInteger('maxLines', maxLines);
  if (safeText === '') {
    return '';
  }
  return safeText.split('\n').slice(-maxLines).join('\n');
};

const buildAdditionalContext = (indexText, recentLogText) => {
  const safeIndexText = assertString('indexText', indexText);
  const safeRecentLogText = assertString('recentLogText', recentLogText);
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });
  const renderedIndex = safeIndexText === '' ? '(empty - no articles compiled yet)' : safeIndexText;
  const renderedRecentLog = safeRecentLogText === '' ? '(no recent daily log)' : safeRecentLogText;
  return (
    '## Today\n' +
    today +
    '\n\n---\n\n## Knowledge Base Index\n\n' +
    renderedIndex +
    '\n\n---\n\n## Recent Daily Log\n\n' +
    renderedRecentLog
  );
};

const truncateContext = (text, maxChars) => {
  const safeText = assertString('text', text);
  assertPositiveInteger('maxChars', maxChars);
  if (safeText.length <= maxChars) {
    return safeText;
  }
  return safeText.slice(0, maxChars) + '\n\n...(truncated)';
};

const buildDailyEntry = (toolName, resultText, timestamp) => {
  const safeToolName = assertNonEmptyString('toolName', toolName);
  const safeResultText = assertString('resultText', resultText);
  const safeTimestamp = assertNonEmptyString('timestamp', timestamp);
  if (!/^\d{2}:\d{2}:\d{2}$/.test(safeTimestamp)) {
    throw new Error('timestamp must be in HH:MM:SS format');
  }
  const truncatedResult = safeResultText.length > 500 ? safeResultText.slice(0, 500) : safeResultText;
  return '\n**[' + safeTimestamp + '] ' + safeToolName + '**\n' + truncatedResult + '\n';
};

const buildSessionHeader = (sessionId, source, timestamp) => {
  const safeSessionId = assertString('sessionId', sessionId);
  const safeSource = assertString('source', source);
  const safeTimestamp = assertNonEmptyString('timestamp', timestamp);
  const renderedSessionId = safeSessionId === '' ? 'unknown' : safeSessionId;
  const renderedSource = safeSource === '' ? 'unknown' : safeSource;
  return '\n## Session [' + safeTimestamp + '] ' + renderedSessionId + ' / ' + renderedSource + '\n\n';
};

module.exports = {
  buildKnowledgeIndexPath,
  buildDailyFilePath,
  buildDailyHeader,
  takeLastLines,
  buildAdditionalContext,
  truncateContext,
  buildDailyEntry,
  buildSessionHeader
};