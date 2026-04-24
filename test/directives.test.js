import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseDirectives, mergeSerialization } from "../lib/directives.js";

describe("parseDirectives", () => {
  it("returns nulls when no xqdoc comment", () => {
    const result = parseDirectives("1 + 1");
    assert.equal(result.name, null);
    assert.equal(result.serialization, null);
    assert.equal(result.code, "1 + 1");
  });

  it("returns nulls for regular XQuery comments (not xqdoc)", () => {
    const result = parseDirectives("(: just a comment :)\n1 + 1");
    assert.equal(result.name, null);
    assert.equal(result.serialization, null);
  });

  it("parses a single @output directive", () => {
    const code = '(:~ @output indent=yes :)\n<root><child/></root>';
    const result = parseDirectives(code);
    assert.equal(result.name, null);
    assert.deepStrictEqual(result.serialization, { indent: "yes" });
    assert.equal(result.code, code);
  });

  it("parses multiple key=value pairs on one @output line", () => {
    const code = "(:~ @output method=xml indent=yes media-type=text/xml :)\n<root/>";
    const result = parseDirectives(code);
    assert.deepStrictEqual(result.serialization, {
      method: "xml",
      indent: "yes",
      "media-type": "text/xml",
    });
  });

  it("ignores other xqdoc directives", () => {
    const code = `(:~
 * Description of this cell.
 * @author Joe
 * @version 1.0
 * @see https://example.com
 * @output indent=yes method=json
 :)
 fn:current-dateTime()`;
    const result = parseDirectives(code);
    assert.equal(result.name, null);
    assert.deepStrictEqual(result.serialization, {
      indent: "yes",
      method: "json",
    });
  });

  it("handles xqdoc with leading asterisks", () => {
    const code = `(:~
 * @output indent=no
 :)
<data/>`;
    const result = parseDirectives(code);
    assert.deepStrictEqual(result.serialization, { indent: "no" });
  });

  it("handles leading whitespace before the xqdoc block", () => {
    const code = "  (:~ @output method=adaptive :)\n$data";
    const result = parseDirectives(code);
    assert.deepStrictEqual(result.serialization, { method: "adaptive" });
  });

  it("returns nulls when xqdoc has no recognized directives", () => {
    const code = "(:~ @author Joe :)\n1";
    const result = parseDirectives(code);
    assert.equal(result.name, null);
    assert.equal(result.serialization, null);
  });

  it("parses CSV parameters", () => {
    const code = "(:~ @output method=csv header=true field-delimiter=| :)\n$data";
    const result = parseDirectives(code);
    assert.deepStrictEqual(result.serialization, {
      "method": "csv",
      "header": "true",
      "field-delimiter": "|",
    });
  });

  it("parses @name directive", () => {
    const code = "(:~ @name books :)\n<catalog><book/></catalog>";
    const result = parseDirectives(code);
    assert.equal(result.name, "books");
    assert.equal(result.serialization, null);
  });

  it("parses @name and @output together", () => {
    const code = `(:~
 * @name results
 * @output method=xml indent=yes
 :)
collection("/db/data")`;
    const result = parseDirectives(code);
    assert.equal(result.name, "results");
    assert.deepStrictEqual(result.serialization, {
      method: "xml",
      indent: "yes",
    });
  });

  it("parses @name with hyphens and underscores", () => {
    const code = "(:~ @name my_data-set :)\n1";
    const result = parseDirectives(code);
    assert.equal(result.name, "my_data-set");
  });

  it("parses @name and @output on separate lines", () => {
    const code = "(:~ @name x\n @output method=json :)\n{}";
    const result = parseDirectives(code);
    assert.equal(result.name, "x");
    assert.deepStrictEqual(result.serialization, { method: "json" });
  });
});

describe("mergeSerialization", () => {
  it("returns default when all sources are null", () => {
    const result = mergeSerialization(null, null, null);
    assert.deepStrictEqual(result, { method: "adaptive" });
  });

  it("notebook metadata overrides default", () => {
    const result = mergeSerialization(null, null, { method: "xml" });
    assert.deepStrictEqual(result, { method: "xml" });
  });

  it("cell metadata overrides notebook", () => {
    const result = mergeSerialization(null, { indent: "yes" }, { method: "xml" });
    assert.deepStrictEqual(result, { method: "xml", indent: "yes" });
  });

  it("directive overrides all", () => {
    const result = mergeSerialization(
      { indent: "no", method: "json" },
      { indent: "yes" },
      { method: "xml" }
    );
    assert.deepStrictEqual(result, { method: "json", indent: "no" });
  });
});
