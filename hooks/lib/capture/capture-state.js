/**
 * This module handles capture state logic.
 */
"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const { CAPTURE_HASH_ALGORITHM, CAPTURE_HASH_PREFIX_LENGTH } = require("./constants");
const { UTF8_ENCODING } = require("../shared/constants");
const {
  assertNonEmptyString,
  isObjectRecord,
  assertString,
  assertPositiveInteger,
  assertObjectRecord,
  assertBoolean,
} = require("../shared/assert");
const { loadJson, saveJson } = require("../state/json-state");
const { CAPTURE_STATE_FILE_NAME } = require("../vault/vault-paths");

const defaultCaptureState = () => ({
  lastCapture: null,
  mmSuppressed: false,
});

const resolveCaptureStatePath = (vaultPath, subfolder) => {
  const safeVaultPath = assertNonEmptyString("vaultPath", vaultPath);
  const safeSubfolder = assertNonEmptyString("subfolder", subfolder);
  return path.join(safeVaultPath, safeSubfolder, CAPTURE_STATE_FILE_NAME);
};

const sanitizeCaptureRecord = (record) => {
  if (!isObjectRecord(record)) {
    return null;
  }

  const sessionId = typeof record.sessionId === "string" ? record.sessionId : "";
  const source = typeof record.source === "string" ? record.source : "";
  const contentHash = typeof record.contentHash === "string" ? record.contentHash : "";
  const timestampMs = Number.isInteger(record.timestampMs) ? record.timestampMs : 0;

  if (sessionId === "" || source === "" || contentHash === "" || timestampMs <= 0) {
    return null;
  }

  return {
    sessionId,
    source,
    contentHash,
    timestampMs,
  };
};

const sanitizeTranscriptTurnCounts = (raw) => {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(raw).filter(([_key, value]) => Number.isInteger(value) && value >= 0),
  );
};

const mergeWithDefaults = (state) => {
  if (!isObjectRecord(state)) {
    return defaultCaptureState();
  }

  const sanitizedState = {
    ...state,
    lastCapture: sanitizeCaptureRecord(state.lastCapture),
    mmSuppressed: typeof state.mmSuppressed === "boolean" ? state.mmSuppressed : false,
  };
  const sanitizedTranscriptTurnCounts = sanitizeTranscriptTurnCounts(state.transcriptTurnCounts);

  return Object.keys(sanitizedTranscriptTurnCounts).length > 0
    ? {
        ...sanitizedState,
        transcriptTurnCounts: sanitizedTranscriptTurnCounts,
      }
    : sanitizedState;
};

const loadCaptureState = (vaultPath, subfolder) => {
  const statePath = resolveCaptureStatePath(vaultPath, subfolder);
  const loadedState = loadJson(statePath, defaultCaptureState());
  return mergeWithDefaults(loadedState);
};

const saveCaptureState = (vaultPath, subfolder, state) => {
  const safeState = assertObjectRecord("state", state);
  const statePath = resolveCaptureStatePath(vaultPath, subfolder);
  saveJson(statePath, safeState);
};

const hashCaptureContent = (content) =>
  crypto
    .createHash(CAPTURE_HASH_ALGORITHM)
    .update(assertString("content", content), UTF8_ENCODING)
    .digest("hex")
    .slice(0, CAPTURE_HASH_PREFIX_LENGTH);

const buildCaptureRecord = (sessionId, source, content, timestampMs) => ({
  sessionId: assertNonEmptyString("sessionId", sessionId),
  source: assertNonEmptyString("source", source),
  contentHash: hashCaptureContent(content),
  timestampMs: assertPositiveInteger("timestampMs", timestampMs),
});

const isDuplicateCapture = (previousCapture, nextCapture, windowMs) => {
  const safePreviousCapture = sanitizeCaptureRecord(previousCapture);
  const safeNextCapture = sanitizeCaptureRecord(nextCapture);
  const safeWindowMs = assertPositiveInteger("windowMs", windowMs);

  if (safeNextCapture === null) {
    throw new Error("nextCapture must be a valid capture record");
  }

  if (safePreviousCapture === null) {
    return false;
  }

  return (
    safePreviousCapture.sessionId === safeNextCapture.sessionId &&
    safePreviousCapture.contentHash === safeNextCapture.contentHash &&
    safeNextCapture.timestampMs >= safePreviousCapture.timestampMs &&
    safeNextCapture.timestampMs - safePreviousCapture.timestampMs <= safeWindowMs
  );
};

const resolveStateCounts = (state) => {
  const safeState = isObjectRecord(state) ? state : defaultCaptureState();
  return {
    safeState,
    counts: isObjectRecord(safeState.transcriptTurnCounts) ? safeState.transcriptTurnCounts : {},
  };
};

const getTranscriptTurnCount = (state, sessionId) => {
  const { counts } = resolveStateCounts(state);
  const count = typeof sessionId === "string" && sessionId !== "" ? counts[sessionId] : undefined;
  return Number.isInteger(count) && count >= 0 ? count : 0;
};

const setTranscriptTurnCount = (state, sessionId, count) => {
  if (typeof sessionId !== "string" || sessionId === "") {
    throw new Error("sessionId must be a non-empty string");
  }
  if (!Number.isInteger(count) || count < 0) {
    throw new Error("count must be a non-negative integer");
  }
  const { safeState, counts } = resolveStateCounts(state);
  return {
    ...safeState,
    transcriptTurnCounts: {
      ...counts,
      [sessionId]: count,
    },
  };
};

const getMmSuppressed = (state) => {
  assertObjectRecord("state", state);
  return state.mmSuppressed === true;
};

const setMmSuppressed = (state, suppressed) => {
  assertObjectRecord("state", state);
  assertBoolean("suppressed", suppressed);
  return { ...state, mmSuppressed: suppressed };
};

module.exports = {
  defaultCaptureState,
  resolveCaptureStatePath,
  loadCaptureState,
  saveCaptureState,
  buildCaptureRecord,
  isDuplicateCapture,
  getTranscriptTurnCount,
  setTranscriptTurnCount,
  getMmSuppressed,
  setMmSuppressed,
};
