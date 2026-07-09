import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatElapsedSeconds, formatError, sanitizeProcessArgs } from "../lib/process-runner";

describe("formatElapsedSeconds", () => {
  it("formats sub-10s with one decimal", () => {
    assert.equal(formatElapsedSeconds(5432), "5.4s");
  });

  it("formats 10s+ without decimal", () => {
    assert.equal(formatElapsedSeconds(12345), "12s");
  });

  it("clamps negative to zero", () => {
    assert.equal(formatElapsedSeconds(-100), "0.0s");
  });
});

describe("formatError", () => {
  it("formats Error instances with name and message", () => {
    const err = new TypeError("bad input");
    assert.equal(formatError(err), "TypeError: bad input");
  });

  it("stringifies non-Error values", () => {
    assert.equal(formatError("oops"), "oops");
    assert.equal(formatError(42), "42");
  });
});

describe("sanitizeProcessArgs", () => {
  it("keeps short args unchanged", () => {
    assert.deepEqual(sanitizeProcessArgs(["--flag", "value"]), ["--flag", "value"]);
  });

  it("truncates long args at 180 chars", () => {
    const longArg = "x".repeat(200);
    const result = sanitizeProcessArgs([longArg]);
    assert.equal(result[0].length, 183);
    assert.ok(result[0].endsWith("..."));
  });
});
