/**
 * This module handles capture state logic.
 */
"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const {
  CAPTURE_HASH_ALGORITHM,
  CAPTURE_HASH_PREFIX_LENGTH,
  COACHING_NAG_THRESHOLD,
  COACHING_NAG_SESSION_MEMORY,
  COACHING_HASH_COUNTS_MAX,
  COACHING_LRU_LOW_USE_FLOOR,
} = require("./constants");
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
  coachingState: { promptHashCounts: {} },
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

const sanitizeCoachingState = (raw) => {
  const empty = { promptHashCounts: {} };
  if (!isObjectRecord(raw)) {
    return empty;
  }
  if (!isObjectRecord(raw.promptHashCounts)) {
    return empty;
  }
  const sanitizedCounts = Object.fromEntries(
    Object.entries(raw.promptHashCounts)
      .filter(([_key, entry]) => {
        if (!isObjectRecord(entry)) return false;
        if (!Number.isInteger(entry.count) || entry.count < 1) return false;
        if (typeof entry.firstSeenIso !== "string" || Number.isNaN(Date.parse(entry.firstSeenIso)))
          return false;
        if (typeof entry.lastSeenIso !== "string" || Number.isNaN(Date.parse(entry.lastSeenIso)))
          return false;
        if (!Array.isArray(entry.nagSessions)) return false;
        return true;
      })
      .map(([key, entry]) => [
        key,
        {
          ...entry,
          nagSessions: entry.nagSessions
            .filter((s) => typeof s === "string")
            .slice(0, COACHING_NAG_SESSION_MEMORY),
        },
      ]),
  );
  return { promptHashCounts: sanitizedCounts };
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
    coachingState: sanitizeCoachingState(state.coachingState),
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

const readPromptHashCounts = (state) =>
  isObjectRecord(state.coachingState) && isObjectRecord(state.coachingState.promptHashCounts)
    ? state.coachingState.promptHashCounts
    : {};

const compareCoachingEntriesForEviction = ([, a], [, b]) => {
  const aEvict = a.count < COACHING_LRU_LOW_USE_FLOOR ? 0 : 1;
  const bEvict = b.count < COACHING_LRU_LOW_USE_FLOOR ? 0 : 1;
  if (aEvict !== bEvict) {
    return aEvict - bEvict;
  }
  if (a.lastSeenIso < b.lastSeenIso) {
    return -1;
  }
  if (a.lastSeenIso > b.lastSeenIso) {
    return 1;
  }
  return 0;
};

const evictCoachingCounts = (counts) => {
  const entries = Object.entries(counts).sort(compareCoachingEntriesForEviction);
  return Object.fromEntries(entries.slice(entries.length - COACHING_HASH_COUNTS_MAX));
};

const readCoachingEntry = (state, hash, sessionId) => {
  assertObjectRecord("state", state);
  assertNonEmptyString("hash", hash);
  assertNonEmptyString("sessionId", sessionId);
  const counts = readPromptHashCounts(state);
  return { counts, entry: counts[hash] };
};

const normalizeCoachingPromptText = (text) => {
  if (typeof text !== "string") {
    throw new Error("text must be a string");
  }
  const normalized = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (normalized === "") {
    throw new Error("text must not be blank after normalization");
  }
  return normalized;
};

const hashCoachingPrompt = (text) => hashCaptureContent(normalizeCoachingPromptText(text));

const recordCoachingHit = (state, hash, sessionId, nowIso) => {
  assertObjectRecord("state", state);
  assertNonEmptyString("hash", hash);
  assertNonEmptyString("sessionId", sessionId);
  assertNonEmptyString("nowIso", nowIso);

  const counts = readPromptHashCounts(state);

  const existing = counts[hash];
  const updatedEntry = isObjectRecord(existing)
    ? { ...existing, count: existing.count + 1, lastSeenIso: nowIso }
    : { count: 1, firstSeenIso: nowIso, lastSeenIso: nowIso, nagSessions: [] };

  const updatedCounts = { ...counts, [hash]: updatedEntry };

  const finalCounts =
    Object.keys(updatedCounts).length > COACHING_HASH_COUNTS_MAX
      ? evictCoachingCounts(updatedCounts)
      : updatedCounts;

  return {
    ...state,
    coachingState: { ...state.coachingState, promptHashCounts: finalCounts },
  };
};

const shouldEmitCoachingNag = (state, hash, sessionId) => {
  const { entry } = readCoachingEntry(state, hash, sessionId);
  if (!isObjectRecord(entry)) {
    return false;
  }
  if (!Number.isInteger(entry.count) || entry.count < COACHING_NAG_THRESHOLD) {
    return false;
  }
  if (!Array.isArray(entry.nagSessions)) {
    return true;
  }
  return !entry.nagSessions.includes(sessionId);
};

const markCoachingNagged = (state, hash, sessionId) => {
  const { counts, entry } = readCoachingEntry(state, hash, sessionId);
  if (!isObjectRecord(entry)) {
    throw new Error(`no coaching entry exists for hash: ${hash}`);
  }

  const existingSessions = Array.isArray(entry.nagSessions) ? entry.nagSessions : [];
  const updatedEntry = {
    ...entry,
    nagSessions: [sessionId, ...existingSessions].slice(0, COACHING_NAG_SESSION_MEMORY),
  };

  return {
    ...state,
    coachingState: {
      ...state.coachingState,
      promptHashCounts: { ...counts, [hash]: updatedEntry },
    },
  };
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
  normalizeCoachingPromptText,
  hashCoachingPrompt,
  recordCoachingHit,
  shouldEmitCoachingNag,
  markCoachingNagged,
};
