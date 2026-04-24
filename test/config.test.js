import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../lib/config.js";

describe("loadConfig", () => {
  const origEnv = { ...process.env };

  afterEach(() => {
    // Restore env
    delete process.env.EXIST_URL;
    delete process.env.EXIST_USER;
    delete process.env.EXIST_PASSWORD;
    delete process.env.EXIST_TIMEOUT;
  });

  it("returns defaults when no env or config file", async () => {
    const config = await loadConfig();
    assert.equal(config.server, "http://localhost:8080/exist");
    assert.equal(config.user, "admin");
    assert.equal(config.password, "");
    assert.equal(config.timeout, 30000);
  });

  it("env vars override defaults", async () => {
    process.env.EXIST_URL = "http://remote:9090/exist";
    process.env.EXIST_USER = "tester";
    process.env.EXIST_PASSWORD = "secret";
    process.env.EXIST_TIMEOUT = "5000";

    const config = await loadConfig();
    assert.equal(config.server, "http://remote:9090/exist");
    assert.equal(config.user, "tester");
    assert.equal(config.password, "secret");
    assert.equal(config.timeout, 5000);
  });
});
