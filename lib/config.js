/**
 * Configuration loader.
 *
 * Priority: environment variables > config file (~/.exist-jupyter.json)
 *
 * Notebook-level metadata is handled separately by the kernel
 * when processing execute_request messages.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

const CONFIG_FILE = join(homedir(), ".exist-jupyter.json");

const DEFAULTS = {
  server: "http://localhost:8080/exist",
  user: "admin",
  password: "",
  timeout: 30000,
};

export async function loadConfig() {
  let fileConfig = {};

  try {
    const raw = await readFile(CONFIG_FILE, "utf-8");
    fileConfig = JSON.parse(raw);
  } catch {
    // No config file — that's fine
  }

  return {
    server: process.env.EXIST_URL || fileConfig.server || DEFAULTS.server,
    user: process.env.EXIST_USER || fileConfig.user || DEFAULTS.user,
    password: process.env.EXIST_PASSWORD ?? fileConfig.password ?? DEFAULTS.password,
    timeout: parseInt(process.env.EXIST_TIMEOUT || fileConfig.timeout || DEFAULTS.timeout, 10),
  };
}
