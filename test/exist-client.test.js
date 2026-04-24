import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ExistClient, buildMimeBundle, csvToHtmlTable } from "../lib/exist-client.js";

describe("ExistClient", () => {
  describe("cell cache", () => {
    let client;

    beforeEach(() => {
      client = new ExistClient({ server: "http://localhost:8080/exist" });
    });

    it("starts with empty cache", () => {
      assert.deepStrictEqual(client._getContext("session1"), []);
    });

    it("adds cells to cache", () => {
      client._addToCache("s1", "x", "1 + 2");
      client._addToCache("s1", "y", "3 + 4");
      assert.deepStrictEqual(client._getContext("s1"), [
        { name: "x", query: "1 + 2" },
        { name: "y", query: "3 + 4" },
      ]);
    });

    it("replaces cell with same name", () => {
      client._addToCache("s1", "x", "1");
      client._addToCache("s1", "x", "2");
      assert.deepStrictEqual(client._getContext("s1"), [
        { name: "x", query: "2" },
      ]);
    });

    it("isolates sessions", () => {
      client._addToCache("s1", "a", "1");
      client._addToCache("s2", "b", "2");
      assert.deepStrictEqual(client._getContext("s1"), [{ name: "a", query: "1" }]);
      assert.deepStrictEqual(client._getContext("s2"), [{ name: "b", query: "2" }]);
    });

    it("clears a session", () => {
      client._addToCache("s1", "a", "1");
      client.clearSession("s1");
      assert.deepStrictEqual(client._getContext("s1"), []);
    });
  });

  describe("buildMimeBundle", () => {
    it("returns text/plain for empty text", () => {
      const data = buildMimeBundle("", "adaptive", {});
      assert.deepStrictEqual(data, { "text/plain": "" });
    });

    it("adds markdown code fence for adaptive output", () => {
      const data = buildMimeBundle("42", "adaptive", {});
      assert.equal(data["text/plain"], "42");
      assert.equal(data["text/markdown"], "```xquery\n42\n```");
    });

    it("adds markdown code fence for xml output", () => {
      const data = buildMimeBundle("<root/>", "xml", {});
      assert.equal(data["text/markdown"], "```xml\n<root/>\n```");
    });

    it("adds markdown code fence for json output", () => {
      const data = buildMimeBundle("{}", "json", {});
      assert.equal(data["text/markdown"], "```json\n{}\n```");
    });

    it("renders HTML when media-type=text/html", () => {
      const html = "<h1>Hello</h1>";
      const data = buildMimeBundle(html, "html", { "media-type": "text/html" });
      assert.equal(data["text/html"], html);
      assert.equal(data["text/markdown"], undefined);
    });

    it("shows HTML source when no media-type", () => {
      const html = "<h1>Hello</h1>";
      const data = buildMimeBundle(html, "html", {});
      assert.equal(data["text/html"], undefined);
      assert.equal(data["text/markdown"], "```html\n<h1>Hello</h1>\n```");
    });

    it("renders CSV as table when media-type=text/html", () => {
      const csv = "name,age\nAlice,30\nBob,25";
      const data = buildMimeBundle(csv, "csv", { "media-type": "text/html" });
      assert.ok(data["text/html"].includes("<table"));
      assert.ok(data["text/html"].includes("Alice"));
      assert.ok(data["text/html"].includes("Bob"));
    });

    it("returns plain text only for method=text (no highlighting)", () => {
      const data = buildMimeBundle("hello world", "text", { method: "text" });
      assert.deepStrictEqual(data, { "text/plain": "hello world" });
    });

    it("shows CSV as plain text when no media-type", () => {
      const csv = "name,age\nAlice,30";
      const data = buildMimeBundle(csv, "csv", {});
      assert.equal(data["text/html"], undefined);
      assert.equal(data["text/markdown"], undefined);
    });
  });

  describe("csvToHtmlTable", () => {
    it("converts simple CSV to HTML table", () => {
      const html = csvToHtmlTable("a,b\n1,2\n3,4");
      assert.ok(html.includes("<th"));
      assert.ok(html.includes(">a<"));
      assert.ok(html.includes(">b<"));
      assert.ok(html.includes(">1<"));
      assert.ok(html.includes(">4<"));
    });

    it("handles quoted fields with commas", () => {
      const html = csvToHtmlTable('name,bio\n"Doe, Jane","age 30"');
      assert.ok(html.includes("Doe, Jane"));
    });

    it("handles escaped quotes", () => {
      const html = csvToHtmlTable('val\n"said ""hello"""');
      assert.ok(html.includes("said &quot;hello&quot;"));
    });

    it("escapes HTML entities in cell values", () => {
      const html = csvToHtmlTable("val\n<script>alert(1)</script>");
      assert.ok(html.includes("&lt;script&gt;"));
      assert.ok(!html.includes("<script>"));
    });

    it("returns empty string for empty input", () => {
      assert.equal(csvToHtmlTable(""), "");
    });

    it("handles tab-delimited (TSV) with field-delimiter", () => {
      const html = csvToHtmlTable("Name\tAge\nAlice\t30", { "field-delimiter": "\t" });
      assert.ok(html.includes("Name"));
      assert.ok(html.includes("Alice"));
      assert.ok(html.includes("30"));
    });

    it("handles pipe-delimited with field-delimiter", () => {
      const html = csvToHtmlTable("a|b|c\n1|2|3", { "field-delimiter": "|" });
      assert.ok(html.includes(">a<"));
      assert.ok(html.includes(">1<"));
      assert.ok(html.includes(">3<"));
    });

    it("handles custom quote-character", () => {
      const html = csvToHtmlTable("a,b\n'hello, world',2", { "quote-character": "'" });
      assert.ok(html.includes("hello, world"));
    });
  });
});
