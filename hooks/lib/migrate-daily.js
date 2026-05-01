"use strict";

const path = require("node:path");
const {
  buildDailyFilePath,
  buildDailyFolderPath,
  buildDailyIndexPath,
  buildDailyMetaPath,
  buildDailyHeader,
  buildDailyChunkPath,
  buildChunkHeader,
  buildChunkIndexContent,
} = require("./vault");

const SESSION_HEADER_PATTERN =
  /^## Session \[[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?(?:Z)?\] .+ \/ .+$/;
const FENCE_MARKER_PATTERN = /^```(?!`)/;

const assertString = (name, value) => {
  if (typeof value !== "string") {
    throw new Error(`${name} must be a string`);
  }
  return value;
};

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

const assertBoolean = (name, value) => {
  if (typeof value !== "boolean") {
    throw new Error(`${name} must be a boolean`);
  }
  return value;
};

const isPlainObject = (value) => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const assertFsApiShape = (fsApi) => {
  const requiredMethods = ["existsSync", "statSync", "readFileSync", "mkdirSync", "writeFileSync"];

  const hasAllMethods =
    fsApi !== null &&
    typeof fsApi === "object" &&
    requiredMethods.every((methodName) => typeof fsApi[methodName] === "function");

  if (!hasAllMethods) {
    throw new Error("fsApi must provide required sync methods");
  }

  return fsApi;
};

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

  let chunkNum = 1;
  let currentBody = "";
  const chunkBodies = [];

  blocks.forEach((nextBlock) => {
    const nextSize = Buffer.byteLength(
      buildChunkHeader(safeDateIso, chunkNum) + currentBody + nextBlock,
      "utf-8",
    );

    if (currentBody === "") {
      currentBody = currentBody + nextBlock;
      return;
    }

    if (nextSize > safeCapBytes) {
      chunkBodies.push(currentBody);
      chunkNum += 1;
      if (chunkNum > 999) {
        throw new Error("chunk count exceeds 999");
      }
      currentBody = nextBlock;
      return;
    }

    currentBody = currentBody + nextBlock;
  });

  return chunkBodies.concat([currentBody]);
};

const migrateFlatToChunked = (vaultPath, subfolder, dateIso, options = {}) => {
  const safeVaultPath = assertNonEmptyString("vaultPath", vaultPath);
  const safeSubfolder = assertNonEmptyString("subfolder", subfolder);
  const safeDateIso = assertNonEmptyString("dateIso", dateIso);

  if (!isPlainObject(options)) {
    throw new Error("options must be a plain object");
  }

  const commit = typeof options.commit === "undefined" ? false : options.commit;
  const capBytes = typeof options.capBytes === "undefined" ? 512000 : options.capBytes;
  const fsApi = typeof options.fsApi === "undefined" ? require("node:fs") : options.fsApi;

  const safeCommit = assertBoolean("options.commit", commit);
  const safeCapBytes = assertPositiveInteger("capBytes", capBytes);
  const safeFsApi = assertFsApiShape(fsApi);

  const flatPath = buildDailyFilePath(safeVaultPath, safeSubfolder, safeDateIso);
  const folderPath = buildDailyFolderPath(safeVaultPath, safeSubfolder, safeDateIso);
  const dryRun = safeCommit !== true;

  if (!safeFsApi.existsSync(flatPath)) {
    throw new Error(`source daily file does not exist: ${flatPath}`);
  }

  if (!safeFsApi.statSync(flatPath).isFile()) {
    throw new Error(`source daily file is not a regular file: ${flatPath}`);
  }

  const sourceText = safeFsApi.readFileSync(flatPath, "utf-8");
  const bytesProcessed = Buffer.byteLength(sourceText, "utf-8");
  const standardHeader = buildDailyHeader(safeDateIso);
  const bodyText = sourceText.startsWith(standardHeader)
    ? sourceText.slice(standardHeader.length)
    : sourceText;
  const blocks = splitDailyBodyIntoBlocks(bodyText);
  const chunkBodies = groupBlocksIntoChunkBodies(blocks, safeDateIso, safeCapBytes);

  const result = {
    chunksCreated: chunkBodies.length,
    bytesProcessed,
    originalPath: flatPath,
    folderPath,
    dryRun,
  };

  if (dryRun) {
    return result;
  }

  if (safeFsApi.existsSync(folderPath)) {
    throw new Error(`chunked daily folder already exists: ${folderPath}`);
  }

  safeFsApi.mkdirSync(folderPath, { recursive: true });

  const entries = [];
  chunkBodies.forEach((chunkBody, index) => {
    const chunkNum = index + 1;
    const chunkPath = buildDailyChunkPath(safeVaultPath, safeSubfolder, safeDateIso, chunkNum);
    const chunkText = buildChunkHeader(safeDateIso, chunkNum) + chunkBody;
    safeFsApi.writeFileSync(chunkPath, chunkText, "utf-8");

    const chunkSizeBytes = Buffer.byteLength(chunkText, "utf-8");
    const padded = String(chunkNum).padStart(3, "0");
    entries.push({
      id: padded,
      file: path.basename(chunkPath),
      sizeBytes: chunkSizeBytes,
      createdAt: new Date().toISOString(),
    });
  });

  const metaPath = buildDailyMetaPath(safeVaultPath, safeSubfolder, safeDateIso);
  safeFsApi.writeFileSync(metaPath, JSON.stringify({ chunks: entries }, null, 2), "utf-8");

  const indexPath = buildDailyIndexPath(safeVaultPath, safeSubfolder, safeDateIso);
  safeFsApi.writeFileSync(indexPath, buildChunkIndexContent(safeDateIso, entries.length), "utf-8");

  return result;
};

module.exports = { migrateFlatToChunked };
