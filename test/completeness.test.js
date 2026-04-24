import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkComplete } from "../lib/completeness.js";

describe("checkComplete", () => {
  it("returns incomplete for empty input", () => {
    assert.deepStrictEqual(checkComplete(""), { status: "incomplete", indent: "" });
    assert.deepStrictEqual(checkComplete("   "), { status: "incomplete", indent: "" });
  });

  it("returns complete for simple expressions", () => {
    assert.deepStrictEqual(checkComplete("1 + 2"), { status: "complete" });
    assert.deepStrictEqual(checkComplete('"hello"'), { status: "complete" });
    assert.deepStrictEqual(checkComplete("fn:count(1 to 10)"), { status: "complete" });
  });

  it("returns incomplete for unclosed parentheses", () => {
    const result = checkComplete("fn:count(");
    assert.equal(result.status, "incomplete");
  });

  it("returns incomplete for unclosed braces", () => {
    const result = checkComplete("if (true()) then {");
    assert.equal(result.status, "incomplete");
  });

  it("returns incomplete for unclosed brackets", () => {
    const result = checkComplete("$x[");
    assert.equal(result.status, "incomplete");
  });

  it("returns complete for balanced nesting", () => {
    assert.deepStrictEqual(
      checkComplete("for $x in (1, 2, 3) return $x * 2"),
      { status: "complete" }
    );
  });

  it("returns complete for balanced braces", () => {
    assert.deepStrictEqual(
      checkComplete('element foo { "bar" }'),
      { status: "complete" }
    );
  });

  it("returns incomplete for unclosed string", () => {
    const result = checkComplete('"hello');
    assert.equal(result.status, "incomplete");
  });

  it("handles escaped quotes in strings", () => {
    assert.deepStrictEqual(
      checkComplete('"he said ""hello""" '),
      { status: "complete" }
    );
  });

  it("returns incomplete for unclosed XQuery comment", () => {
    const result = checkComplete("1 + 2 (: this is");
    assert.equal(result.status, "incomplete");
  });

  it("returns complete with closed XQuery comment", () => {
    assert.deepStrictEqual(
      checkComplete("(: comment :) 1 + 2"),
      { status: "complete" }
    );
  });

  it("handles FLWOR expressions", () => {
    assert.deepStrictEqual(
      checkComplete(`
        for $x in (1, 2, 3)
        let $y := $x * 2
        where $y > 2
        return $y
      `),
      { status: "complete" }
    );
  });

  it("returns incomplete for FLWOR with unclosed braces", () => {
    const result = checkComplete(`
      for $x in (1, 2, 3)
      return element item {
    `);
    assert.equal(result.status, "incomplete");
  });
});
