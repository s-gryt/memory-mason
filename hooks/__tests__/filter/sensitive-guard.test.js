"use strict";

const { detectSensitiveContent } = require("../../lib/filter/sensitive-guard");

const ZERO = 0;
const ONE = 1;
const TWO = 2;
const FOUR = 4;
const NON_STRING_NUMBER_INPUT = 123;

const FILE_NAME_ENV = "file-name:.env";
const FILE_NAME_NETRC = "file-name:.netrc";
const FILE_NAME_CREDENTIALS = "file-name:credentials";
const FILE_NAME_PASSWORDS = "file-name:passwords";
const FILE_NAME_PEM = "file-name:.pem";
const FILE_NAME_CRT = "file-name:.crt";
const FILE_NAME_JKS = "file-name:.jks";
const FILE_NAME_ID_RSA = "file-name:id_rsa";
const FILE_NAME_ID_DSA = "file-name:id_dsa";
const FILE_NAME_ID_ECDSA = "file-name:id_ecdsa";
const FILE_NAME_AUTHORIZED_KEYS = "file-name:authorized_keys";
const FILE_NAME_KNOWN_HOSTS = "file-name:known_hosts";

const PATH_SEGMENT_SSH = "path-segment:.ssh/";
const PATH_SEGMENT_AWS = "path-segment:.aws/";
const PATH_SEGMENT_GNUPG = "path-segment:.gnupg/";

const CONTENT_PATTERN_RSA_PRIVATE_KEY = "content-pattern:BEGIN RSA PRIVATE KEY";
const CONTENT_PATTERN_API_KEY = "content-pattern:API_KEY=";
const CONTENT_PATTERN_PASSWORD = "content-pattern:password=";

describe("sensitive guard", () => {
  it("detects .env filename", () => {
    const result = detectSensitiveContent("I read .env file");

    expect(result.isSensitive).toBe(true);
    expect(result.reasons).toContain(FILE_NAME_ENV);
  });

  it("detects .netrc filename", () => {
    const result = detectSensitiveContent("Found .netrc in home directory");

    expect(result.isSensitive).toBe(true);
    expect(result.reasons).toContain(FILE_NAME_NETRC);
  });

  it("detects credentials filename", () => {
    const result = detectSensitiveContent("Loaded credentials from disk");

    expect(result.isSensitive).toBe(true);
    expect(result.reasons).toContain(FILE_NAME_CREDENTIALS);
  });

  it("detects additional sensitive filename patterns", () => {
    const result = detectSensitiveContent(
      "passwords.txt cert.crt truststore.jks id_dsa id_ecdsa authorized_keys known_hosts",
    );

    expect(result.isSensitive).toBe(true);
    expect(result.reasons).toContain(FILE_NAME_PASSWORDS);
    expect(result.reasons).toContain(FILE_NAME_CRT);
    expect(result.reasons).toContain(FILE_NAME_JKS);
    expect(result.reasons).toContain(FILE_NAME_ID_DSA);
    expect(result.reasons).toContain(FILE_NAME_ID_ECDSA);
    expect(result.reasons).toContain(FILE_NAME_AUTHORIZED_KEYS);
    expect(result.reasons).toContain(FILE_NAME_KNOWN_HOSTS);
  });

  it("detects .pem filename", () => {
    const result = detectSensitiveContent("certificate.pem was parsed");

    expect(result.isSensitive).toBe(true);
    expect(result.reasons).toContain(FILE_NAME_PEM);
  });

  it("detects id_rsa filename", () => {
    const result = detectSensitiveContent("Using id_rsa for auth");

    expect(result.isSensitive).toBe(true);
    expect(result.reasons).toContain(FILE_NAME_ID_RSA);
  });

  it("detects .ssh path segment", () => {
    const result = detectSensitiveContent("Path: /home/user/.ssh/id_rsa");

    expect(result.isSensitive).toBe(true);
    expect(result.reasons).toContain(PATH_SEGMENT_SSH);
  });

  it("detects .aws path segment after backslash normalization and credentials filename", () => {
    const result = detectSensitiveContent("C:\\Users\\user\\.aws\\credentials");

    expect(result.isSensitive).toBe(true);
    expect(result.reasons).toContain(PATH_SEGMENT_AWS);
    expect(result.reasons).toContain(FILE_NAME_CREDENTIALS);
  });

  it("detects .gnupg path segment", () => {
    const result = detectSensitiveContent("/home/user/.gnupg/private-keys-v1.d");

    expect(result.isSensitive).toBe(true);
    expect(result.reasons).toContain(PATH_SEGMENT_GNUPG);
  });

  it("detects BEGIN RSA PRIVATE KEY marker", () => {
    const result = detectSensitiveContent("-----BEGIN RSA PRIVATE KEY-----");

    expect(result.isSensitive).toBe(true);
    expect(result.reasons).toContain(CONTENT_PATTERN_RSA_PRIVATE_KEY);
  });

  it("detects API_KEY marker", () => {
    const result = detectSensitiveContent("API_KEY=secret_value");

    expect(result.isSensitive).toBe(true);
    expect(result.reasons).toContain(CONTENT_PATTERN_API_KEY);
  });

  it("detects password marker", () => {
    const result = detectSensitiveContent("password=hunter2");

    expect(result.isSensitive).toBe(true);
    expect(result.reasons).toContain(CONTENT_PATTERN_PASSWORD);
  });

  it("returns multiple distinct reasons when multiple patterns match", () => {
    const result = detectSensitiveContent(
      "Secrets in .env at /home/user/.ssh/id_rsa with API_KEY=123",
    );

    expect(result.isSensitive).toBe(true);
    expect(result.reasons).toEqual([
      FILE_NAME_ENV,
      FILE_NAME_ID_RSA,
      PATH_SEGMENT_SSH,
      CONTENT_PATTERN_API_KEY,
    ]);
    expect(result.reasons).toHaveLength(FOUR);
  });

  it("returns a clean result for non-sensitive content", () => {
    const result = detectSensitiveContent("Regular project notes and plain text");

    expect(result).toEqual({ isSensitive: false, reasons: [] });
    expect(result.reasons).toHaveLength(ZERO);
  });

  it("deduplicates repeated matches while preserving first-hit order", () => {
    const result = detectSensitiveContent(".env appears twice .env and API_KEY=a API_KEY=b");

    expect(result.reasons).toEqual([FILE_NAME_ENV, CONTENT_PATTERN_API_KEY]);
    expect(result.reasons).toHaveLength(TWO);
  });

  it("throws TypeError on non-string input", () => {
    expect(() => detectSensitiveContent(null)).toThrow(TypeError);
    expect(() => detectSensitiveContent(NON_STRING_NUMBER_INPUT)).toThrow(TypeError);
  });

  it("detects .ssh path segment when source uses backslashes", () => {
    const result = detectSensitiveContent("C:\\Users\\.ssh\\config");

    expect(result.isSensitive).toBe(true);
    expect(result.reasons).toContain(PATH_SEGMENT_SSH);
    expect(result.reasons).toHaveLength(ONE);
  });
});
