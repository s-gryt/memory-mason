"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { assertNonEmptyString } = require("./config");

const isObjectRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

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

const assertObjectRecord = (name, value) => {
  if (!isObjectRecord(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value;
};

const assertBoolean = (name, value) => {
  if (typeof value !== "boolean") {
    throw new Error(`${name} must be a boolean`);
  }
  return value;
};

const defaultCaptureState = () => ({
  lastCapture: null,
  mmSuppressed: false,
});

const resolveCaptureStatePath = (vaultPath, subfolder) => {
  const safeVaultPath = assertNonEmptyString("vaultPath", vaultPath);
  const safeSubfolder = assertNonEmptyString("subfolder", subfolder);
  return path.join(safeVaultPath, safeSubfolder, ".memory-mason-last-capture.json");
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

  if (!fs.existsSync(statePath)) {
    return defaultCaptureState();
  }

  const rawState = fs.readFileSync(statePath, "utf-8");

  try {
    const parsedState = JSON.parse(rawState);
    return mergeWithDefaults(parsedState);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return defaultCaptureState();
    }
    throw error;
  }
};

const saveCaptureState = (vaultPath, subfolder, state) => {
  if (!isObjectRecord(state)) {
    throw new Error("state must be an object");
  }

  const statePath = resolveCaptureStatePath(vaultPath, subfolder);
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
};

const hashCaptureContent = (content) =>
  crypto
    .createHash("sha256")
    .update(assertString("content", content), "utf-8")
    .digest("hex")
    .slice(0, 16);

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

const getTranscriptTurnCount = (state, sessionId) => {
  const safeState = isObjectRecord(state) ? state : defaultCaptureState();
  const counts = isObjectRecord(safeState.transcriptTurnCounts)
    ? safeState.transcriptTurnCounts
    : {};
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
  const safeState = isObjectRecord(state) ? state : defaultCaptureState();
  const counts = isObjectRecord(safeState.transcriptTurnCounts)
    ? safeState.transcriptTurnCounts
    : {};
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
