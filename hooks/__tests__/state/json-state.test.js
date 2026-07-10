"use strict";

const { loadJson, saveJson } = require("../../lib/state/json-state");

const FILE_PATH = "/vault/.meta/state.json";
const DIR_PATH = "/vault/.meta";
const TEMP_PATH_PATTERN = /[\\/]state\.json\.tmp-\d+-\d+-\d+$/;
const DATA = { key: "value" };
const DEFAULT_VALUE = { default: true };

const makeFsApi = (overrides = {}) => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
  unlinkSync: vi.fn(),
  ...overrides,
});

describe("loadJson", () => {
  it("returns defaultValue when file does not exist", () => {
    const fsApi = makeFsApi({ existsSync: vi.fn().mockReturnValue(false) });

    expect(loadJson(FILE_PATH, DEFAULT_VALUE, fsApi)).toBe(DEFAULT_VALUE);
    expect(fsApi.readFileSync).not.toHaveBeenCalled();
  });

  it("returns parsed object when file contains valid JSON", () => {
    const fsApi = makeFsApi({
      existsSync: vi.fn().mockReturnValue(true),
      readFileSync: vi.fn().mockReturnValue(JSON.stringify(DATA)),
    });

    expect(loadJson(FILE_PATH, DEFAULT_VALUE, fsApi)).toEqual(DATA);
    expect(fsApi.readFileSync).toHaveBeenCalledWith(FILE_PATH, "utf-8");
  });

  it("returns defaultValue when file contains malformed JSON (SyntaxError)", () => {
    const fsApi = makeFsApi({
      existsSync: vi.fn().mockReturnValue(true),
      readFileSync: vi.fn().mockReturnValue("{not valid json"),
    });

    expect(loadJson(FILE_PATH, DEFAULT_VALUE, fsApi)).toBe(DEFAULT_VALUE);
  });

  it("rethrows non-SyntaxError thrown by readFileSync", () => {
    const ioError = new TypeError("disk failure");
    const fsApi = makeFsApi({
      existsSync: vi.fn().mockReturnValue(true),
      readFileSync: vi.fn().mockImplementation(() => {
        throw ioError;
      }),
    });

    expect(() => loadJson(FILE_PATH, DEFAULT_VALUE, fsApi)).toThrow(ioError);
  });
});

describe("saveJson", () => {
  it("calls mkdirSync, writeFileSync, and renameSync with expected args on happy path", () => {
    const fsApi = makeFsApi();
    let capturedTempPath;
    fsApi.writeFileSync.mockImplementation((tempPath) => {
      capturedTempPath = tempPath;
    });
    fsApi.renameSync.mockImplementation(() => {});

    saveJson(FILE_PATH, DATA, fsApi);

    expect(fsApi.mkdirSync).toHaveBeenCalledWith(DIR_PATH, { recursive: true });
    expect(TEMP_PATH_PATTERN.test(capturedTempPath)).toBe(true);
    expect(fsApi.writeFileSync).toHaveBeenCalledWith(
      capturedTempPath,
      JSON.stringify(DATA, null, 2),
      "utf-8",
    );
    expect(fsApi.renameSync).toHaveBeenCalledWith(capturedTempPath, FILE_PATH);
  });

  it("temp path is unique across two successive calls (monotonic counter)", () => {
    const tempPaths = [];
    const makeCapturingFsApi = () =>
      makeFsApi({
        writeFileSync: vi.fn().mockImplementation((p) => {
          tempPaths.push(p);
        }),
      });

    saveJson(FILE_PATH, DATA, makeCapturingFsApi());
    saveJson(FILE_PATH, DATA, makeCapturingFsApi());

    expect(tempPaths[0]).not.toBe(tempPaths[1]);
  });

  it("calls unlinkSync with the temp path and rethrows when renameSync throws and existsSync returns true", () => {
    const renameError = new Error("rename failed");
    let capturedTempPath;
    const fsApi = makeFsApi({
      writeFileSync: vi.fn().mockImplementation((p) => {
        capturedTempPath = p;
      }),
      renameSync: vi.fn().mockImplementation(() => {
        throw renameError;
      }),
      existsSync: vi.fn().mockReturnValue(true),
    });

    expect(() => saveJson(FILE_PATH, DATA, fsApi)).toThrow(renameError);
    expect(fsApi.unlinkSync).toHaveBeenCalledWith(capturedTempPath);
  });

  it("does not call unlinkSync and still rethrows when existsSync returns false", () => {
    const renameError = new Error("rename failed");
    const fsApi = makeFsApi({
      renameSync: vi.fn().mockImplementation(() => {
        throw renameError;
      }),
      existsSync: vi.fn().mockReturnValue(false),
    });

    expect(() => saveJson(FILE_PATH, DATA, fsApi)).toThrow(renameError);
    expect(fsApi.unlinkSync).not.toHaveBeenCalled();
  });

  it("skips cleanup and rethrows when fsApi lacks unlinkSync", () => {
    const renameError = new Error("rename failed");
    const fsApi = {
      existsSync: vi.fn().mockReturnValue(true),
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn(),
      renameSync: vi.fn().mockImplementation(() => {
        throw renameError;
      }),
    };

    expect(() => saveJson(FILE_PATH, DATA, fsApi)).toThrow(renameError);
  });
});
