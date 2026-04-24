import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseMessage, buildMessage, makeHeader } from "../lib/wire.js";

describe("makeHeader", () => {
  it("creates a header with required fields", () => {
    const header = makeHeader("execute_request", "session-123");
    assert.equal(header.msg_type, "execute_request");
    assert.equal(header.session, "session-123");
    assert.equal(header.username, "kernel");
    assert.equal(header.version, "5.3");
    assert.ok(header.msg_id);
    assert.ok(header.date);
  });
});

describe("buildMessage / parseMessage roundtrip", () => {
  it("roundtrips a message without HMAC", () => {
    const idents = [Buffer.from("ident1")];
    const header = makeHeader("execute_request", "sess");
    const parentHeader = {};
    const metadata = { foo: "bar" };
    const content = { code: "1 + 2" };

    const frames = buildMessage(idents, header, parentHeader, metadata, content, "");
    // Convert string frames to Buffers for parseMessage
    const bufFrames = frames.map((f) => Buffer.from(typeof f === "string" ? f : f));

    const parsed = parseMessage(bufFrames, "");
    assert.deepStrictEqual(parsed.header, header);
    assert.deepStrictEqual(parsed.parentHeader, parentHeader);
    assert.deepStrictEqual(parsed.metadata, metadata);
    assert.deepStrictEqual(parsed.content, content);
  });

  it("roundtrips a message with HMAC", () => {
    const key = "test-secret-key";
    const idents = [Buffer.from("id")];
    const header = makeHeader("kernel_info_request", "s1");
    const parentHeader = {};
    const metadata = {};
    const content = {};

    const frames = buildMessage(idents, header, parentHeader, metadata, content, key);
    const bufFrames = frames.map((f) => Buffer.from(typeof f === "string" ? f : f));

    const parsed = parseMessage(bufFrames, key);
    assert.deepStrictEqual(parsed.header, header);
  });

  it("throws on HMAC mismatch", () => {
    const idents = [Buffer.from("id")];
    const header = makeHeader("test", "s1");
    const frames = buildMessage(idents, header, {}, {}, {}, "key1");
    const bufFrames = frames.map((f) => Buffer.from(typeof f === "string" ? f : f));

    assert.throws(() => parseMessage(bufFrames, "wrong-key"), /HMAC signature mismatch/);
  });
});
