/**
 * This module handles chunk writer logic.
 */
"use strict";

const path = require("node:path");
const {
  DEFAULT_DAILY_CHUNK_CAP_BYTES,
  DAILY_CHUNK_HARD_CAP_BYTES,
  MAX_DAILY_CHUNK_COUNT,
  CHUNK_ID_WIDTH,
  SESSION_CHUNK_TIME_WIDTH,
  SESSION_ID_SHORT_LENGTH,
  NO_SESSION_SID,
  DAILY_META_SCHEMA_VERSION,
  CONTINUED_CALLOUT_LINE,
} = require("./constants");
const { UTF8_ENCODING } = require("../shared/constants");
const { DAILY_META_FILE_NAME } = require("./vault-paths");
const {
  assertNonEmptyString,
  assertNonNegativeInteger,
  assertPositiveInteger,
  assertBoolean,
  isPlainObject,
  assertSyncFsApi,
} = require("../shared/assert");
const {
  assertDailyPathArgs,
  buildDailyFolderPath,
  buildDailyIndexPath,
  buildDailyRawFilePath,
  buildSessionChunkFileName,
  buildSessionChunkHeader,
  buildSessionHeaderBlock,
  defaultSessionContext,
  assertSessionContext,
  buildChunkIndexContent,
  localNow,
} = require("./vault");

const SESSION_SID_MAX_LENGTH = Math.max(SESSION_ID_SHORT_LENGTH, NO_SESSION_SID.length);
const CHUNK_ID_PATTERN = new RegExp(`^\\d{${CHUNK_ID_WIDTH}}$`);
const CHUNK_FILE_PATTERN = new RegExp(`^\\d{${CHUNK_ID_WIDTH}}\\.md$`);
const SESSION_SID_PATTERN = new RegExp(`^[a-z0-9]{1,${SESSION_SID_MAX_LENGTH}}$`);
const SESSION_CHUNK_FILE_PATTERN = new RegExp(
  `^\\d{${SESSION_CHUNK_TIME_WIDTH}}-[a-z0-9]{1,${SESSION_SID_MAX_LENGTH}}-\\d{${CHUNK_ID_WIDTH}}\\.md$`,
);
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const LEGACY_CHUNK_GROUP_KEY = "legacy";

const assertMetaShape = (meta) => {
  if (!isPlainObject(meta) || !Array.isArray(meta.chunks)) {
    throw new Error("meta.json must contain an object with chunks array");
  }
  return meta;
};

const isSessionChunkEntry = (chunk) => isPlainObject(chunk) && typeof chunk.sid8 === "string";

const validateChunkCommonFields = (sizeBytes, createdAt) => {
  if (!Number.isInteger(sizeBytes) || sizeBytes < 0) {
    throw new Error("chunk sizeBytes must be a non-negative integer");
  }

  if (typeof createdAt !== "string" || !ISO_TIMESTAMP_PATTERN.test(createdAt)) {
    throw new Error("chunk createdAt must be a valid ISO timestamp");
  }
};

const validateChunkIdentityFields = (safeChunk, fileErrorMessage) => {
  const { id, file, sizeBytes, createdAt } = safeChunk;

  if (!CHUNK_ID_PATTERN.test(id)) {
    throw new Error("chunk id must match 3-digit format");
  }

  if (!fileErrorMessage.pattern.test(file)) {
    throw new Error(fileErrorMessage.invalid);
  }

  validateChunkCommonFields(sizeBytes, createdAt);

  return { id, file, sizeBytes, createdAt };
};

const validateLegacyChunk = (chunk) => {
  const safeChunk = isPlainObject(chunk) ? chunk : {};
  const { id, file, sizeBytes, createdAt } = validateChunkIdentityFields(safeChunk, {
    pattern: CHUNK_FILE_PATTERN,
    invalid: "chunk file must match 3-digit .md format",
  });

  if (file !== `${id}.md`) {
    throw new Error("chunk file must match chunk id");
  }

  return {
    id,
    file,
    sizeBytes,
    createdAt,
  };
};

const validateSessionChunk = (chunk) => {
  const { id, file, sizeBytes, createdAt } = validateChunkIdentityFields(chunk, {
    pattern: SESSION_CHUNK_FILE_PATTERN,
    invalid: "chunk file must match HHMMSS-sid8-NNN.md format",
  });
  const { sessionId, sid8 } = chunk;

  if (!SESSION_SID_PATTERN.test(sid8)) {
    throw new Error("chunk sid8 must be lowercase alphanumeric");
  }

  if (typeof sessionId !== "string") {
    throw new Error("chunk sessionId must be a string");
  }

  if (!file.endsWith(`-${sid8}-${id}.md`)) {
    throw new Error("chunk file must match chunk sid8 and id");
  }

  return {
    id,
    file,
    sizeBytes,
    createdAt,
    sessionId,
    sid8,
  };
};

const validateChunk = (chunk) =>
  isSessionChunkEntry(chunk) ? validateSessionChunk(chunk) : validateLegacyChunk(chunk);

const resolveChunkGroupKey = (chunk) =>
  isSessionChunkEntry(chunk) ? `session:${chunk.sid8}:${chunk.sessionId}` : LEGACY_CHUNK_GROUP_KEY;

const validateContiguousChunkIds = (chunks) => {
  const countsByGroup = new Map();
  chunks.forEach((chunk) => {
    const groupKey = resolveChunkGroupKey(chunk);
    const previousCount = countsByGroup.has(groupKey) ? countsByGroup.get(groupKey) : 0;
    const nextCount = previousCount + 1;
    if (chunk.id !== String(nextCount).padStart(CHUNK_ID_WIDTH, "0")) {
      throw new Error("chunk ids must be contiguous starting at 001 per session");
    }
    countsByGroup.set(groupKey, nextCount);
  });
};

const validateMeta = (meta) => {
  const safeMeta = assertMetaShape(meta);
  if (
    typeof safeMeta.schemaVersion !== "undefined" &&
    (!Number.isInteger(safeMeta.schemaVersion) ||
      safeMeta.schemaVersion < DAILY_META_SCHEMA_VERSION)
  ) {
    throw new Error("meta schemaVersion must be >= 2 when present");
  }
  const validatedChunks = safeMeta.chunks.map((chunk) => validateChunk(chunk));
  validateContiguousChunkIds(validatedChunks);
  return {
    schemaVersion:
      typeof safeMeta.schemaVersion !== "undefined"
        ? safeMeta.schemaVersion
        : DAILY_META_SCHEMA_VERSION,
    chunks: validatedChunks.map((chunk) => ({ ...chunk })),
  };
};

const loadMeta = (folderPath, fsApi = require("node:fs")) => {
  const safeFolderPath = assertNonEmptyString("folderPath", folderPath);
  const metaPath = path.join(safeFolderPath, DAILY_META_FILE_NAME);
  const rawMeta = (() => {
    try {
      return fsApi.readFileSync(metaPath, UTF8_ENCODING);
    } catch (error) {
      if (error !== null && typeof error === "object" && error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  })();

  if (rawMeta === null) {
    return { schemaVersion: DAILY_META_SCHEMA_VERSION, chunks: [] };
  }

  const parsedMeta = (() => {
    try {
      return JSON.parse(rawMeta);
    } catch (error) {
      if (error instanceof SyntaxError) {
        return null;
      }
      throw error;
    }
  })();

  if (parsedMeta === null) {
    return { schemaVersion: DAILY_META_SCHEMA_VERSION, chunks: [] };
  }

  return validateMeta(parsedMeta);
};

const saveMeta = (folderPath, meta, fsApi = require("node:fs")) => {
  const safeFolderPath = assertNonEmptyString("folderPath", folderPath);
  const safeMeta = validateMeta(meta);
  const safeFsApi = assertSyncFsApi(fsApi, ["mkdirSync", "writeFileSync", "renameSync"]);
  const metaPath = path.join(safeFolderPath, DAILY_META_FILE_NAME);
  const tempMetaPath = path.join(
    safeFolderPath,
    `${DAILY_META_FILE_NAME}.tmp-${process.pid}-${Date.now()}`,
  );

  safeFsApi.mkdirSync(safeFolderPath, { recursive: true });
  safeFsApi.writeFileSync(tempMetaPath, JSON.stringify(safeMeta, null, 2), UTF8_ENCODING);
  safeFsApi.renameSync(tempMetaPath, metaPath);
};

const getCurrentChunk = (meta) => {
  const safeMeta = assertMetaShape(meta);
  if (safeMeta.chunks.length === 0) {
    return null;
  }
  return safeMeta.chunks[safeMeta.chunks.length - 1];
};

const filterSessionChunks = (meta, session) => {
  const safeMeta = assertMetaShape(meta);
  const safeSession = assertSessionContext(session);
  return safeMeta.chunks.filter(
    (chunk) =>
      isSessionChunkEntry(chunk) &&
      chunk.sid8 === safeSession.sid8 &&
      chunk.sessionId === safeSession.sessionId,
  );
};

const getCurrentSessionChunk = (meta, session) => {
  const sessionChunks = filterSessionChunks(meta, session);
  if (sessionChunks.length === 0) {
    return null;
  }
  return sessionChunks[sessionChunks.length - 1];
};

const needsNewChunk = (currentChunk, contentByteLength, capBytes) => {
  const safeContentByteLength = assertNonNegativeInteger("contentByteLength", contentByteLength);
  const safeCapBytes = assertPositiveInteger("capBytes", capBytes);
  if (currentChunk === null) {
    return true;
  }
  return currentChunk.sizeBytes + safeContentByteLength > safeCapBytes;
};

const assertHardCapExceedsCap = (capBytes, hardCapBytes) => {
  if (hardCapBytes <= capBytes) {
    throw new Error("hardCapBytes must be greater than capBytes");
  }
};

const resolveRotationDecision = (
  currentChunk,
  contentByteLength,
  capBytes,
  hardCapBytes,
  exchangeOpen,
) => {
  const safeContentByteLength = assertNonNegativeInteger("contentByteLength", contentByteLength);
  const safeCapBytes = assertPositiveInteger("capBytes", capBytes);
  const safeHardCapBytes = assertPositiveInteger("hardCapBytes", hardCapBytes);
  assertHardCapExceedsCap(safeCapBytes, safeHardCapBytes);
  const safeExchangeOpen = assertBoolean("exchangeOpen", exchangeOpen);

  if (currentChunk === null) {
    return { rotate: true, continued: false };
  }

  const projectedBytes = currentChunk.sizeBytes + safeContentByteLength;

  if (projectedBytes > safeHardCapBytes) {
    return { rotate: true, continued: safeExchangeOpen };
  }

  if (safeExchangeOpen) {
    return { rotate: false, continued: false };
  }

  return { rotate: projectedBytes > safeCapBytes, continued: false };
};

const nextChunkNum = (meta) => {
  const safeMeta = assertMetaShape(meta);
  if (safeMeta.chunks.length >= MAX_DAILY_CHUNK_COUNT) {
    throw new Error("chunk count exceeds 999");
  }
  return safeMeta.chunks.length + 1;
};

const nextSessionChunkNum = (meta, session) => {
  const sessionChunks = filterSessionChunks(meta, session);
  if (sessionChunks.length >= MAX_DAILY_CHUNK_COUNT) {
    throw new Error("session chunk count exceeds 999");
  }
  return sessionChunks.length + 1;
};

const resolveSessionTimePrefix = (meta, session) => {
  const sessionChunks = filterSessionChunks(meta, session);
  if (sessionChunks.length > 0) {
    return sessionChunks[0].file.slice(0, SESSION_CHUNK_TIME_WIDTH);
  }
  return localNow().time.split(":").join("");
};

const assertChunkNum = (chunkNum) => {
  if (!Number.isInteger(chunkNum) || chunkNum < 1 || chunkNum > MAX_DAILY_CHUNK_COUNT) {
    throw new Error("chunkNum must be an integer from 1 to 999");
  }
  return chunkNum;
};

const buildChunkEntry = (chunkNum, sizeBytes) => {
  const safeChunkNum = assertChunkNum(chunkNum);

  const safeSizeBytes = assertNonNegativeInteger("sizeBytes", sizeBytes);
  const id = String(safeChunkNum).padStart(CHUNK_ID_WIDTH, "0");
  return {
    id,
    file: `${id}.md`,
    sizeBytes: safeSizeBytes,
    createdAt: new Date().toISOString(),
  };
};

const buildSessionChunkEntry = (chunkNum, fileName, sizeBytes, session) => {
  const safeChunkNum = assertChunkNum(chunkNum);
  const safeFileName = assertNonEmptyString("fileName", fileName);
  const safeSizeBytes = assertNonNegativeInteger("sizeBytes", sizeBytes);
  const safeSession = assertSessionContext(session);
  return {
    id: String(safeChunkNum).padStart(CHUNK_ID_WIDTH, "0"),
    file: safeFileName,
    sizeBytes: safeSizeBytes,
    createdAt: new Date().toISOString(),
    sessionId: safeSession.sessionId,
    sid8: safeSession.sid8,
  };
};

const ensureDailyFolder = (fsApi, folderPath) => {
  if (fsApi.existsSync(folderPath)) {
    if (!fsApi.statSync(folderPath).isDirectory()) {
      throw new Error(`daily folder path is not a directory: ${folderPath}`);
    }
    return true;
  }

  fsApi.mkdirSync(folderPath, { recursive: true });
  return false;
};

const assertChunkFolderMetaState = (fsApi, folderPath, folderExistedBefore, meta) => {
  if (!folderExistedBefore || meta.chunks.length !== 0) {
    return;
  }

  const filesInFolder = fsApi.readdirSync(folderPath);
  const hasChunkArtifacts = filesInFolder.some(
    (fileName) =>
      CHUNK_FILE_PATTERN.test(fileName) ||
      SESSION_CHUNK_FILE_PATTERN.test(fileName) ||
      fileName === "index.md",
  );

  if (hasChunkArtifacts) {
    throw new Error(`meta.json missing for existing chunk folder: ${folderPath}`);
  }
};

const markChunkContinued = (vaultPath, subfolder, today, currentChunk, meta, fsApi) => {
  const chunkPath = buildDailyRawFilePath(vaultPath, subfolder, today, currentChunk.file);

  if (!fsApi.existsSync(chunkPath) || !fsApi.statSync(chunkPath).isFile()) {
    throw new Error(`current chunk file is missing: ${chunkPath}`);
  }

  const markerText = `\n${CONTINUED_CALLOUT_LINE}\n`;
  fsApi.appendFileSync(chunkPath, markerText, UTF8_ENCODING);

  const markerByteLength = Buffer.byteLength(markerText, UTF8_ENCODING);
  return {
    ...meta,
    chunks: meta.chunks.map((chunk) =>
      chunk.file === currentChunk.file
        ? { ...chunk, sizeBytes: chunk.sizeBytes + markerByteLength }
        : chunk,
    ),
  };
};

const tryRollbackContinuedMarker = (vaultPath, subfolder, today, currentChunk, fsApi) => {
  try {
    const markerText = `\n${CONTINUED_CALLOUT_LINE}\n`;
    const chunkFilePath = buildDailyRawFilePath(vaultPath, subfolder, today, currentChunk.file);
    const currentContent = fsApi.readFileSync(chunkFilePath, UTF8_ENCODING);
    if (currentContent.endsWith(markerText)) {
      fsApi.writeFileSync(
        chunkFilePath,
        currentContent.slice(0, currentContent.length - markerText.length),
        UTF8_ENCODING,
      );
    }
    return true;
  } catch (_rollbackError) {
    return false;
  }
};

const trySaveMetaBestEffort = (folderPath, markedMeta, fsApi) => {
  try {
    saveMeta(folderPath, markedMeta, fsApi);
  } catch (_saveMetaError) {
    process.stderr.write("[memory-mason] failed to persist chunk meta after rotate failure\n");
  }
};

const rotateToNewSessionChunk = (
  vaultPath,
  subfolder,
  today,
  content,
  meta,
  session,
  continued,
  fsApi,
) => {
  const chunkNum = nextSessionChunkNum(meta, session);
  const timePrefix = resolveSessionTimePrefix(meta, session);
  const fileName = buildSessionChunkFileName(timePrefix, session.sid8, chunkNum);
  const chunkPath = buildDailyRawFilePath(vaultPath, subfolder, today, fileName);

  if (fsApi.existsSync(chunkPath)) {
    throw new Error(`chunk file already exists: ${chunkPath}`);
  }

  const sessionHeaderBlock =
    chunkNum === 1 ? buildSessionHeaderBlock(session, new Date().toISOString()) : "";
  const continuedMarker = continued ? `${CONTINUED_CALLOUT_LINE}\n\n` : "";
  const chunkText =
    buildSessionChunkHeader(today, session.sid8, chunkNum) +
    sessionHeaderBlock +
    continuedMarker +
    content;
  const chunkSizeBytes = Buffer.byteLength(chunkText, UTF8_ENCODING);

  fsApi.writeFileSync(chunkPath, chunkText, UTF8_ENCODING);

  const newChunk = buildSessionChunkEntry(chunkNum, fileName, chunkSizeBytes, session);
  return {
    ...meta,
    chunks: meta.chunks.concat([newChunk]),
  };
};

const appendToExistingChunk = (
  vaultPath,
  subfolder,
  today,
  content,
  contentByteLength,
  currentChunk,
  meta,
  fsApi,
) => {
  const chunkPath = buildDailyRawFilePath(vaultPath, subfolder, today, currentChunk.file);

  if (!fsApi.existsSync(chunkPath)) {
    throw new Error(`current chunk file is missing: ${chunkPath}`);
  }

  if (!fsApi.statSync(chunkPath).isFile()) {
    throw new Error(`current chunk path is not a file: ${chunkPath}`);
  }

  fsApi.appendFileSync(chunkPath, content, UTF8_ENCODING);

  const updatedChunk = {
    ...currentChunk,
    sizeBytes: currentChunk.sizeBytes + contentByteLength,
  };

  return {
    ...meta,
    chunks: meta.chunks.map((chunk) => (chunk.file === currentChunk.file ? updatedChunk : chunk)),
  };
};

const appendToChunked = (vaultPath, subfolder, today, content, options = {}) => {
  const safeToday = assertNonEmptyString("today", today);
  const { safeVaultPath, safeSubfolder } = assertDailyPathArgs(vaultPath, subfolder, safeToday);

  if (typeof content !== "string") {
    throw new Error("content must be a string");
  }

  const safeOptions = options !== null && typeof options === "object" ? options : {};
  const capBytes =
    typeof safeOptions.capBytes === "undefined"
      ? DEFAULT_DAILY_CHUNK_CAP_BYTES
      : safeOptions.capBytes;
  const hardCapBytes =
    typeof safeOptions.hardCapBytes === "undefined"
      ? DAILY_CHUNK_HARD_CAP_BYTES
      : safeOptions.hardCapBytes;
  const session = assertSessionContext(
    typeof safeOptions.session === "undefined" ? defaultSessionContext() : safeOptions.session,
  );
  const exchangeOpen = safeOptions.exchangeOpen === true;
  const fsApi = typeof safeOptions.fsApi === "undefined" ? require("node:fs") : safeOptions.fsApi;
  const safeCapBytes = assertPositiveInteger("capBytes", capBytes);
  const safeHardCapBytes = assertPositiveInteger("hardCapBytes", hardCapBytes);
  assertHardCapExceedsCap(safeCapBytes, safeHardCapBytes);
  const safeFsApi = assertSyncFsApi(fsApi, [
    "existsSync",
    "statSync",
    "readdirSync",
    "mkdirSync",
    "readFileSync",
    "writeFileSync",
    "appendFileSync",
    "renameSync",
  ]);

  const folderPath = buildDailyFolderPath(safeVaultPath, safeSubfolder, safeToday);
  const indexPath = buildDailyIndexPath(safeVaultPath, safeSubfolder, safeToday);

  const folderExistedBefore = ensureDailyFolder(safeFsApi, folderPath);

  const meta = loadMeta(folderPath, safeFsApi);
  assertChunkFolderMetaState(safeFsApi, folderPath, folderExistedBefore, meta);

  const currentChunk = getCurrentSessionChunk(meta, session);
  const contentByteLength = Buffer.byteLength(content, UTF8_ENCODING);
  const decision = resolveRotationDecision(
    currentChunk,
    contentByteLength,
    safeCapBytes,
    safeHardCapBytes,
    exchangeOpen,
  );

  const markedMeta = decision.continued
    ? markChunkContinued(safeVaultPath, safeSubfolder, safeToday, currentChunk, meta, safeFsApi)
    : meta;

  let nextMeta;
  try {
    nextMeta = decision.rotate
      ? rotateToNewSessionChunk(
          safeVaultPath,
          safeSubfolder,
          safeToday,
          content,
          markedMeta,
          session,
          decision.continued,
          safeFsApi,
        )
      : appendToExistingChunk(
          safeVaultPath,
          safeSubfolder,
          safeToday,
          content,
          contentByteLength,
          currentChunk,
          markedMeta,
          safeFsApi,
        );
  } catch (rotateError) {
    if (
      decision.continued &&
      !tryRollbackContinuedMarker(safeVaultPath, safeSubfolder, safeToday, currentChunk, safeFsApi)
    ) {
      trySaveMetaBestEffort(folderPath, markedMeta, safeFsApi);
    }
    throw rotateError;
  }

  saveMeta(folderPath, nextMeta, safeFsApi);

  const indexContent = buildChunkIndexContent(safeSubfolder, safeToday, nextMeta.chunks);
  safeFsApi.writeFileSync(indexPath, indexContent, UTF8_ENCODING);

  return undefined;
};

module.exports = {
  loadMeta,
  saveMeta,
  getCurrentChunk,
  getCurrentSessionChunk,
  needsNewChunk,
  resolveRotationDecision,
  nextChunkNum,
  nextSessionChunkNum,
  resolveSessionTimePrefix,
  buildChunkEntry,
  buildSessionChunkEntry,
  appendToChunked,
};
