/**
 * This module handles migrate daily logic.
 */
"use strict";

const path = require("node:path");
const {
  DEFAULT_DAILY_CHUNK_CAP_BYTES,
  MAX_DAILY_CHUNK_COUNT,
  CHUNK_ID_WIDTH,
} = require("../vault/constants");
const { UTF8_ENCODING } = require("../shared/constants");
const {
  assertString,
  assertNonEmptyString,
  assertPositiveInteger,
  assertBoolean,
  isPlainObject,
  assertSyncFsApi,
} = require("../shared/assert");
const {
  assertDailyPathArgs,
  buildDailyFilePath,
  buildDailyFolderPath,
  buildDailyIndexPath,
  buildDailyMetaPath,
  buildDailyHeader,
  buildDailyChunkPath,
  buildChunkHeader,
  buildChunkIndexContent,
} = require("../vault/vault");

const SESSION_HEADER_PATTERN =
  /^## Session \[[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?(?:Z)?\] .+ \/ .+$/;
const FENCE_MARKER_PATTERN = /^```(?!`)/;

const splitDailyBodyIntoBlocks = (bodyText) => {
  const safeBodyText = assertString("bodyText", bodyText);

  if (safeBodyText === "") {
    return [""];
  }

  const lines = safeBodyText.split("\n");
  let insideFence = false;
  let currentBlock = "";
  const blocks = [];

  lines.forEach((line, index) => {
    const lineWithNewline = index < lines.length - 1 ? `${line}\n` : line;
    const shouldSplit = !insideFence && SESSION_HEADER_PATTERN.test(line);

    if (shouldSplit) {
      blocks.push(currentBlock);
      currentBlock = lineWithNewline;
    } else {
      currentBlock = currentBlock + lineWithNewline;
    }

    if (FENCE_MARKER_PATTERN.test(line.trim())) {
      insideFence = !insideFence;
    }
  });

  return blocks.concat([currentBlock]);
};

const appendBlockToBody = (currentBody, nextBlock) => currentBody + nextBlock;

const calculateChunkSizeWithNextBlock = (dateIso, chunkNum, currentBody, nextBlock) =>
  Buffer.byteLength(
    buildChunkHeader(dateIso, chunkNum) + appendBlockToBody(currentBody, nextBlock),
    UTF8_ENCODING,
  );

const shouldRotateChunk = (currentBody, nextSize, capBytes) =>
  currentBody !== "" && nextSize > capBytes;

const carryForwardToNextChunk = (state, nextBlock) => {
  const nextChunkNum = state.chunkNum + 1;
  if (nextChunkNum > MAX_DAILY_CHUNK_COUNT) {
    throw new Error("chunk count exceeds 999");
  }

  return {
    chunkNum: nextChunkNum,
    currentBody: nextBlock,
    chunkBodies: state.chunkBodies.concat([state.currentBody]),
  };
};

const groupBlocksIntoChunkBodies = (blocks, dateIso, capBytes) => {
  if (
    !Array.isArray(blocks) ||
    blocks.length === 0 ||
    !blocks.every((block) => typeof block === "string")
  ) {
    throw new Error("blocks must be a non-empty array of strings");
  }

  const safeDateIso = assertNonEmptyString("dateIso", dateIso);
  const safeCapBytes = assertPositiveInteger("capBytes", capBytes);

  const finalState = blocks.reduce(
    (state, nextBlock) => {
      const nextSize = calculateChunkSizeWithNextBlock(
        safeDateIso,
        state.chunkNum,
        state.currentBody,
        nextBlock,
      );

      if (shouldRotateChunk(state.currentBody, nextSize, safeCapBytes)) {
        return carryForwardToNextChunk(state, nextBlock);
      }

      return {
        chunkNum: state.chunkNum,
        currentBody: appendBlockToBody(state.currentBody, nextBlock),
        chunkBodies: state.chunkBodies,
      };
    },
    {
      chunkNum: 1,
      currentBody: "",
      chunkBodies: [],
    },
  );

  return finalState.chunkBodies.concat([finalState.currentBody]);
};

const assertFlatSourceFile = (fsApi, flatPath) => {
  if (!fsApi.existsSync(flatPath)) {
    throw new Error(`source daily file does not exist: ${flatPath}`);
  }

  if (!fsApi.statSync(flatPath).isFile()) {
    throw new Error(`source daily file is not a regular file: ${flatPath}`);
  }
};

const buildMigrationResult = (chunkBodiesLength, bytesProcessed, flatPath, folderPath, dryRun) => ({
  chunksCreated: chunkBodiesLength,
  bytesProcessed,
  originalPath: flatPath,
  folderPath,
  dryRun,
});

const writeChunkArtifacts = (fsApi, vaultPath, subfolder, dateIso, chunkBodies) => {
  const entries = [];

  chunkBodies.forEach((chunkBody, index) => {
    const chunkNum = index + 1;
    const chunkPath = buildDailyChunkPath(vaultPath, subfolder, dateIso, chunkNum);
    const chunkText = buildChunkHeader(dateIso, chunkNum) + chunkBody;
    fsApi.writeFileSync(chunkPath, chunkText, UTF8_ENCODING);

    const chunkSizeBytes = Buffer.byteLength(chunkText, UTF8_ENCODING);
    const padded = String(chunkNum).padStart(CHUNK_ID_WIDTH, "0");
    entries.push({
      id: padded,
      file: path.basename(chunkPath),
      sizeBytes: chunkSizeBytes,
      createdAt: new Date().toISOString(),
    });
  });

  return entries;
};

const migrateFlatToChunked = (vaultPath, subfolder, dateIso, options = {}) => {
  const { safeVaultPath, safeSubfolder, safeDateIso } = assertDailyPathArgs(
    vaultPath,
    subfolder,
    dateIso,
  );

  if (!isPlainObject(options)) {
    throw new Error("options must be a plain object");
  }

  const commit = typeof options.commit === "undefined" ? false : options.commit;
  const capBytes =
    typeof options.capBytes === "undefined" ? DEFAULT_DAILY_CHUNK_CAP_BYTES : options.capBytes;
  const fsApi = typeof options.fsApi === "undefined" ? require("node:fs") : options.fsApi;

  const safeCommit = assertBoolean("options.commit", commit);
  const safeCapBytes = assertPositiveInteger("capBytes", capBytes);
  const safeFsApi = assertSyncFsApi(fsApi, [
    "existsSync",
    "statSync",
    "readFileSync",
    "mkdirSync",
    "writeFileSync",
  ]);

  const flatPath = buildDailyFilePath(safeVaultPath, safeSubfolder, safeDateIso);
  const folderPath = buildDailyFolderPath(safeVaultPath, safeSubfolder, safeDateIso);
  const dryRun = safeCommit !== true;
  assertFlatSourceFile(safeFsApi, flatPath);

  const sourceText = safeFsApi.readFileSync(flatPath, UTF8_ENCODING);
  const bytesProcessed = Buffer.byteLength(sourceText, UTF8_ENCODING);
  const standardHeader = buildDailyHeader(safeDateIso);
  const bodyText = sourceText.startsWith(standardHeader)
    ? sourceText.slice(standardHeader.length)
    : sourceText;
  const blocks = splitDailyBodyIntoBlocks(bodyText);
  const chunkBodies = groupBlocksIntoChunkBodies(blocks, safeDateIso, safeCapBytes);
  const result = buildMigrationResult(
    chunkBodies.length,
    bytesProcessed,
    flatPath,
    folderPath,
    dryRun,
  );

  if (dryRun) {
    return result;
  }

  if (safeFsApi.existsSync(folderPath)) {
    throw new Error(`chunked daily folder already exists: ${folderPath}`);
  }

  safeFsApi.mkdirSync(folderPath, { recursive: true });

  const entries = writeChunkArtifacts(
    safeFsApi,
    safeVaultPath,
    safeSubfolder,
    safeDateIso,
    chunkBodies,
  );

  const metaPath = buildDailyMetaPath(safeVaultPath, safeSubfolder, safeDateIso);
  safeFsApi.writeFileSync(metaPath, JSON.stringify({ chunks: entries }, null, 2), UTF8_ENCODING);

  const indexPath = buildDailyIndexPath(safeVaultPath, safeSubfolder, safeDateIso);
  safeFsApi.writeFileSync(
    indexPath,
    buildChunkIndexContent(safeDateIso, entries.length),
    UTF8_ENCODING,
  );

  return result;
};

module.exports = { migrateFlatToChunked };
