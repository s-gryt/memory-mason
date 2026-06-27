/**
 * This module handles coaching insights logic.
 */
"use strict";

const {
  assertObjectRecord,
  assertNonNegativeInteger,
  isObjectRecord,
} = require("../shared/assert");
const { COACHING_NAG_THRESHOLD } = require("../capture/constants");

const selectTopCoachingInsights = (state, limit) => {
  assertObjectRecord("state", state);
  assertNonNegativeInteger("limit", limit);

  if (!isObjectRecord(state.coachingState)) {
    return [];
  }

  if (!isObjectRecord(state.coachingState.promptHashCounts)) {
    return [];
  }

  const counts = state.coachingState.promptHashCounts;

  const items = Object.keys(counts)
    .map((hash) => {
      const entry = counts[hash];
      return {
        hash,
        count: isObjectRecord(entry) ? entry.count : 0,
        firstSeenIso: isObjectRecord(entry) ? entry.firstSeenIso : "",
        lastSeenIso: isObjectRecord(entry) ? entry.lastSeenIso : "",
        kind: "prompt-repeat",
      };
    })
    .filter((item) => item.count >= COACHING_NAG_THRESHOLD)
    .sort((a, b) => {
      if (b.count !== a.count) {
        return b.count - a.count;
      }
      if (b.lastSeenIso < a.lastSeenIso) {
        return -1;
      }
      if (b.lastSeenIso > a.lastSeenIso) {
        return 1;
      }
      return 0;
    });

  return items.slice(0, limit);
};

const formatCoachingAdditionalContext = (insights) => {
  if (!Array.isArray(insights)) {
    throw new TypeError("insights must be an array");
  }

  if (insights.length === 0) {
    return "";
  }

  const lines = insights
    .filter((item) => isObjectRecord(item))
    .map(
      (item) =>
        `- **${item.count}x** \`${item.hash}\` — kind: ${item.kind} — first: ${item.firstSeenIso}, last: ${item.lastSeenIso}`,
    );

  return `## Workflow Coaching\n\n${lines.join("\n")}`;
};

module.exports = {
  selectTopCoachingInsights,
  formatCoachingAdditionalContext,
};
