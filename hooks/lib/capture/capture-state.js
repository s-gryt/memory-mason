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
  COACHING_DECAY_MS,
  COACHING_DECAY_NAGGED_WINDOW_MS,
  COACHING_KIND_PROMPT_REPEAT,
  COACHING_KIND_ERROR_REPEAT,
  EXCHANGE_STALE_OPEN_MS,
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

const MAX_COACHING_ERROR_TEXT_LENGTH = 200;
const MAX_COACHING_SNIPPET_LENGTH = 80;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?$/;

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
      .map(([key, entry]) => {
        const { snippet, ...rest } = entry;
        return [
          key,
          {
            ...rest,
            nagSessions: entry.nagSessions
              .filter((s) => typeof s === "string")
              .slice(0, COACHING_NAG_SESSION_MEMORY),
            ...(typeof snippet === "string" ? { snippet } : {}),
          },
        ];
      }),
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

const resolveExchanges = (state) =>
  isObjectRecord(state) && isObjectRecord(state.exchanges) ? state.exchanges : {};

const sweepStaleExchanges = (state, nowMs = Date.now()) => {
  const exchanges = resolveExchanges(state);
  const activeEntries = Object.entries(exchanges).filter(([, entry]) => {
    if (!isObjectRecord(entry) || entry.open !== true || typeof entry.openedAtIso !== "string") {
      return false;
    }
    const openedMs = Date.parse(entry.openedAtIso);
    return !Number.isNaN(openedMs) && nowMs - openedMs < EXCHANGE_STALE_OPEN_MS;
  });

  if (activeEntries.length === 0) {
    const { exchanges: _removed, ...stateWithoutExchanges } = state;
    return stateWithoutExchanges;
  }

  return {
    ...state,
    exchanges: Object.fromEntries(activeEntries),
  };
};

const saveCaptureState = (vaultPath, subfolder, state) => {
  const safeState = assertObjectRecord("state", state);
  const statePath = resolveCaptureStatePath(vaultPath, subfolder);
  saveJson(statePath, sweepStaleExchanges(safeState));
};

const assertIsoTimestamp = (name, value) => {
  const safeValue = assertNonEmptyString(name, value);
  if (!ISO_TIMESTAMP_PATTERN.test(safeValue) || Number.isNaN(Date.parse(safeValue))) {
    throw new Error(`${name} must be a valid ISO timestamp`);
  }
  return safeValue;
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

const hashCoachingPrompt = (text) =>
  hashCaptureContent(`prompt:${normalizeCoachingPromptText(text)}`);

const normalizeCoachingErrorText = (text) => {
  if (typeof text !== "string") {
    throw new Error("text must be a string");
  }
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const matchedLine = lines.find((line) => /error|fail/i.test(line));
  const fallbackLine = lines.length > 0 ? lines[0] : "";
  const signalLine = matchedLine === undefined ? fallbackLine : matchedLine;
  const normalized = signalLine
    .toLowerCase()
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .slice(0, MAX_COACHING_ERROR_TEXT_LENGTH)
    .trim();
  if (normalized === "") {
    throw new Error("text must not be blank after normalization");
  }
  return normalized;
};

const hashCoachingError = (text) => hashCaptureContent(`error:${normalizeCoachingErrorText(text)}`);

const buildCoachingSnippet = (kind, text) => {
  const normalized =
    kind === COACHING_KIND_ERROR_REPEAT
      ? normalizeCoachingErrorText(text)
      : normalizeCoachingPromptText(text);
  return normalized.slice(0, MAX_COACHING_SNIPPET_LENGTH);
};

const decayCoachingCounts = (counts, nowMs) =>
  Object.fromEntries(
    Object.entries(counts).filter(([, entry]) => {
      const lastSeenMs = Date.parse(entry.lastSeenIso);
      if (Number.isNaN(lastSeenMs)) {
        return false;
      }
      const decayWindowMs =
        entry.count >= COACHING_NAG_THRESHOLD ? COACHING_DECAY_NAGGED_WINDOW_MS : COACHING_DECAY_MS;
      return nowMs - lastSeenMs < decayWindowMs;
    }),
  );

const recordCoachingHit = (
  state,
  hash,
  sessionId,
  nowIso,
  kind = COACHING_KIND_PROMPT_REPEAT,
  snippet = "",
) => {
  assertObjectRecord("state", state);
  assertNonEmptyString("hash", hash);
  assertNonEmptyString("sessionId", sessionId);
  const safeNowIso = assertIsoTimestamp("nowIso", nowIso);
  assertNonEmptyString("kind", kind);
  assertString("snippet", snippet);

  const counts = decayCoachingCounts(readPromptHashCounts(state), Date.parse(safeNowIso));

  const existing = counts[hash];
  const nextSnippet = snippet !== "" ? snippet : undefined;
  const updatedEntry = isObjectRecord(existing)
    ? {
        ...existing,
        count: existing.count + 1,
        lastSeenIso: safeNowIso,
        kind: typeof existing.kind === "string" && existing.kind !== "" ? existing.kind : kind,
        ...(nextSnippet !== undefined ? { snippet: nextSnippet } : {}),
      }
    : {
        count: 1,
        firstSeenIso: safeNowIso,
        lastSeenIso: safeNowIso,
        nagSessions: [],
        kind,
        ...(nextSnippet !== undefined ? { snippet: nextSnippet } : {}),
      };

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

const isExchangeOpen = (state, sessionId, nowMs = Date.now()) => {
  assertObjectRecord("state", state);
  assertNonEmptyString("sessionId", sessionId);
  const exchanges = resolveExchanges(state);
  const entry = exchanges[sessionId];
  if (!isObjectRecord(entry) || entry.open !== true) {
    return false;
  }
  if (typeof entry.openedAtIso !== "string") {
    return false;
  }
  const openedMs = Date.parse(entry.openedAtIso);
  if (Number.isNaN(openedMs)) {
    return false;
  }
  return nowMs - openedMs < EXCHANGE_STALE_OPEN_MS;
};

const openExchange = (state, sessionId, nowIso) => {
  assertObjectRecord("state", state);
  assertNonEmptyString("sessionId", sessionId);
  const safeNowIso = assertIsoTimestamp("nowIso", nowIso);
  const exchanges = resolveExchanges(state);
  return {
    ...state,
    exchanges: {
      ...exchanges,
      [sessionId]: { open: true, openedAtIso: safeNowIso },
    },
  };
};

const closeExchange = (state, sessionId) => {
  assertObjectRecord("state", state);
  assertNonEmptyString("sessionId", sessionId);
  const exchanges = resolveExchanges(state);
  if (!isObjectRecord(exchanges[sessionId])) {
    return state;
  }
  const { [sessionId]: _removed, ...remainingExchanges } = exchanges;
  return {
    ...state,
    exchanges: remainingExchanges,
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
  normalizeCoachingErrorText,
  hashCoachingError,
  buildCoachingSnippet,
  compareCoachingEntriesForEviction,
  recordCoachingHit,
  shouldEmitCoachingNag,
  markCoachingNagged,
  isExchangeOpen,
  openExchange,
  closeExchange,
};
