/**
 * This module handles constants logic.
 */
"use strict";

const DUPLICATE_CAPTURE_WINDOW_MS = 60000;
const CAPTURE_HASH_ALGORITHM = "sha256";
const CAPTURE_HASH_PREFIX_LENGTH = 16;

module.exports = {
  DUPLICATE_CAPTURE_WINDOW_MS,
  CAPTURE_HASH_ALGORITHM,
  CAPTURE_HASH_PREFIX_LENGTH,
};
