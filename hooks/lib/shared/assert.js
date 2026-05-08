/**
 * This module handles assert logic.
 */
"use strict";

const assertNonEmptyString = (name, value) => {
  if (typeof value !== "string" || value === "") {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value;
};

const assertString = (name, value) => {
  if (typeof value !== "string") {
    throw new TypeError(`${name} must be a string`);
  }
  return value;
};

const assertPositiveInteger = (name, value) => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
  return value;
};

const assertNonNegativeInteger = (name, value) => {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer`);
  }
  return value;
};

const assertBoolean = (name, value) => {
  if (typeof value !== "boolean") {
    throw new TypeError(`${name} must be a boolean`);
  }
  return value;
};

const isObjectRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const assertObjectRecord = (name, value) => {
  if (!isObjectRecord(value)) {
    throw new TypeError(`${name} must be an object`);
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

const assertSyncFsApi = (fsApi, requiredMethods) => {
  const safeRequiredMethods = Array.isArray(requiredMethods) ? requiredMethods : [];
  const hasAllMethods =
    fsApi !== null &&
    typeof fsApi === "object" &&
    safeRequiredMethods.every((methodName) => typeof fsApi[methodName] === "function");

  if (!hasAllMethods) {
    throw new TypeError("fsApi must provide required sync methods");
  }

  return fsApi;
};

module.exports = {
  assertNonEmptyString,
  assertString,
  assertPositiveInteger,
  assertNonNegativeInteger,
  assertBoolean,
  isObjectRecord,
  assertObjectRecord,
  isPlainObject,
  assertSyncFsApi,
};
