"use strict";

const path = require("node:path");
const {
  buildDailyFolderPath,
  buildDailyChunkPath,
  buildDailyIndexPath,
  buildChunkHeader,
  buildChunkIndexContent,
} = require("./vault");

const CHUNK_ID_PATTERN = /^\d{3}$/;
const CHUNK_FILE_PATTERN = /^\d{3}\.md$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const assertNonEmptyString = (name, value) => {
  if (typeof value !== "string" || value === "") {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
};

const assertNonNegativeInteger = (name, value) => {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return value;
};

const assertPositiveInteger = (name, value) => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
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

const assertMetaShape = (meta) => {
  if (!isPlainObject(meta) || !Array.isArray(meta.chunks)) {
    throw new Error("meta.json must contain an object with chunks array");
  }
  return meta;
};

const validateChunk = (chunk) => {
  const safeChunk = isPlainObject(chunk) ? chunk : {};
  const { id, file, sizeBytes, createdAt } = safeChunk;

  if (!CHUNK_ID_PATTERN.test(id)) {
    throw new Error("chunk id must match 3-digit format");
  }

  if (!CHUNK_FILE_PATTERN.test(file)) {
    throw new Error("chunk file must match 3-digit .md format");
  }

  if (file !== `${id}.md`) {
    throw new Error("chunk file must match chunk id");
  }

  if (!Number.isInteger(sizeBytes) || sizeBytes < 0) {
    throw new Error("chunk sizeBytes must be a non-negative integer");
  }

  if (typeof createdAt !== "string" || !ISO_TIMESTAMP_PATTERN.test(createdAt)) {
    throw new Error("chunk createdAt must be a valid ISO timestamp");
  }

  return {
    id,
    file,
    sizeBytes,
    createdAt,
  };
};

const validateContiguousChunkIds = (chunks) => {
  const isContiguous = chunks.every(
    (chunk, index) => chunk.id === String(index + 1).padStart(3, "0"),
  );
  if (!isContiguous) {
    throw new Error("chunk ids must be contiguous starting at 001");
  }
};

const validateMeta = (meta) => {
  const safeMeta = assertMetaShape(meta);
  const validatedChunks = safeMeta.chunks.map((chunk) => validateChunk(chunk));
  validateContiguousChunkIds(validatedChunks);
  return {
    chunks: validatedChunks.map((chunk) => ({ ...chunk })),
  };
};

const loadMeta = (folderPath, fsApi = require("node:fs")) => {
  const safeFolderPath = assertNonEmptyString("folderPath", folderPath);
  const metaPath = path.join(safeFolderPath, "meta.json");
  const rawMeta = (() => {
    try {
      return fsApi.readFileSync(metaPath, "utf-8");
    } catch (error) {
      if (error !== null && typeof error === "object" && error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  })();

  if (rawMeta === null) {
    return { chunks: [] };
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
    return { chunks: [] };
  }

  return validateMeta(parsedMeta);
};

const saveMeta = (folderPath, meta, fsApi = require("node:fs")) => {
  const safeFolderPath = assertNonEmptyString("folderPath", folderPath);
  const safeMeta = validateMeta(meta);
  fsApi.mkdirSync(safeFolderPath, { recursive: true });
  fsApi.writeFileSync(
    path.join(safeFolderPath, "meta.json"),
    JSON.stringify(safeMeta, null, 2),
    "utf-8",
  );
};

const getCurrentChunk = (meta) => {
  const safeMeta = assertMetaShape(meta);
  if (safeMeta.chunks.length === 0) {
    return null;
  }
  return safeMeta.chunks[safeMeta.chunks.length - 1];
};

const needsNewChunk = (currentChunk, contentByteLength, capBytes) => {
  const safeContentByteLength = assertNonNegativeInteger("contentByteLength", contentByteLength);
  const safeCapBytes = assertPositiveInteger("capBytes", capBytes);
  if (currentChunk === null) {
    return true;
  }
  return currentChunk.sizeBytes + safeContentByteLength > safeCapBytes;
};

const nextChunkNum = (meta) => {
  const safeMeta = assertMetaShape(meta);
  if (safeMeta.chunks.length >= 999) {
    throw new Error("chunk count exceeds 999");
  }
  return safeMeta.chunks.length + 1;
};

const buildChunkEntry = (chunkNum, sizeBytes) => {
  if (!Number.isInteger(chunkNum) || chunkNum < 1 || chunkNum > 999) {
    throw new Error("chunkNum must be an integer from 1 to 999");
  }

  const safeSizeBytes = assertNonNegativeInteger("sizeBytes", sizeBytes);
  const id = String(chunkNum).padStart(3, "0");
  return {
    id,
    file: `${id}.md`,
    sizeBytes: safeSizeBytes,
    createdAt: new Date().toISOString(),
  };
};

const assertFsApiShape = (fsApi) => {
  const requiredMethods = [
    "existsSync",
    "statSync",
    "readdirSync",
    "mkdirSync",
    "readFileSync",
    "writeFileSync",
    "appendFileSync",
  ];

  const hasAllMethods =
    fsApi !== null &&
    typeof fsApi === "object" &&
    requiredMethods.every((methodName) => typeof fsApi[methodName] === "function");

  if (!hasAllMethods) {
    throw new Error("fsApi must provide required sync methods");
  }
  return fsApi;
};

const appendToChunked = (vaultPath, subfolder, today, content, options = {}) => {
  const safeVaultPath = assertNonEmptyString("vaultPath", vaultPath);
  const safeSubfolder = assertNonEmptyString("subfolder", subfolder);
  const safeToday = assertNonEmptyString("today", today);

  if (typeof content !== "string") {
    throw new Error("content must be a string");
  }

  const safeOptions = options !== null && typeof options === "object" ? options : {};
  const capBytes = typeof safeOptions.capBytes === "undefined" ? 512000 : safeOptions.capBytes;
  const fsApi = typeof safeOptions.fsApi === "undefined" ? require("node:fs") : safeOptions.fsApi;
  const safeCapBytes = assertPositiveInteger("capBytes", capBytes);
  const safeFsApi = assertFsApiShape(fsApi);

  const folderPath = buildDailyFolderPath(safeVaultPath, safeSubfolder, safeToday);
  const indexPath = buildDailyIndexPath(safeVaultPath, safeSubfolder, safeToday);

  const folderExistedBefore = (() => {
    if (safeFsApi.existsSync(folderPath)) {
      if (!safeFsApi.statSync(folderPath).isDirectory()) {
        throw new Error(`daily folder path is not a directory: ${folderPath}`);
      }
      return true;
    }

    safeFsApi.mkdirSync(folderPath, { recursive: true });
    return false;
  })();

  const meta = loadMeta(folderPath, safeFsApi);

  if (folderExistedBefore && meta.chunks.length === 0) {
    const filesInFolder = safeFsApi.readdirSync(folderPath);
    const hasChunkArtifacts = filesInFolder.some(
      (fileName) => /^\d{3}\.md$/.test(fileName) || fileName === "index.md",
    );
    if (hasChunkArtifacts) {
      throw new Error(`meta.json missing for existing chunk folder: ${folderPath}`);
    }
  }

  const currentChunk = getCurrentChunk(meta);
  const contentByteLength = Buffer.byteLength(content, "utf-8");
  const rotate = needsNewChunk(currentChunk, contentByteLength, safeCapBytes);

  const nextMeta = (() => {
    if (rotate) {
      const chunkNum = nextChunkNum(meta);
      const chunkPath = buildDailyChunkPath(safeVaultPath, safeSubfolder, safeToday, chunkNum);

      if (safeFsApi.existsSync(chunkPath)) {
        throw new Error(`chunk file already exists: ${chunkPath}`);
      }

      const chunkHeader = buildChunkHeader(safeToday, chunkNum);
      const chunkText = chunkHeader + content;
      const chunkSizeBytes = Buffer.byteLength(chunkText, "utf-8");

      safeFsApi.writeFileSync(chunkPath, chunkText, "utf-8");

      const newChunk = buildChunkEntry(chunkNum, chunkSizeBytes);
      return {
        chunks: meta.chunks.concat([newChunk]),
      };
    }

    const chunkNum = Number(currentChunk.id);
    const chunkPath = buildDailyChunkPath(safeVaultPath, safeSubfolder, safeToday, chunkNum);

    if (!safeFsApi.existsSync(chunkPath)) {
      throw new Error(`current chunk file is missing: ${chunkPath}`);
    }

    if (!safeFsApi.statSync(chunkPath).isFile()) {
      throw new Error(`current chunk path is not a file: ${chunkPath}`);
    }

    safeFsApi.appendFileSync(chunkPath, content, "utf-8");

    const updatedChunk = {
      ...currentChunk,
      sizeBytes: currentChunk.sizeBytes + contentByteLength,
    };

    return {
      chunks: meta.chunks.slice(0, -1).concat([updatedChunk]),
    };
  })();

  saveMeta(folderPath, nextMeta, safeFsApi);

  const indexContent = buildChunkIndexContent(safeToday, nextMeta.chunks.length);
  safeFsApi.writeFileSync(indexPath, indexContent, "utf-8");

  return undefined;
};

module.exports = {
  loadMeta,
  saveMeta,
  getCurrentChunk,
  needsNewChunk,
  nextChunkNum,
  buildChunkEntry,
  appendToChunked,
};
