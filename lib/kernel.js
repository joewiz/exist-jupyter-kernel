#!/usr/bin/env node

/**
 * eXist-db XQuery Jupyter Kernel — main entry point.
 *
 * Usage: node lib/kernel.js <connection_file>
 *
 * The connection file is provided by Jupyter and contains ZeroMQ
 * port/address info plus the HMAC key.
 */

import { readFile, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { JupyterKernel } from "./wire.js";
import { ExistClient } from "./exist-client.js";
import { loadConfig } from "./config.js";
import { checkComplete } from "./completeness.js";
import { parseDirectives, mergeSerialization } from "./directives.js";

const LOG_FILE = join(homedir(), "workspace", "exist-jupyter-kernel", "kernel.log");

async function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  process.stderr.write(line);
  await appendFile(LOG_FILE, line).catch(() => {});
}

const VERSION = "0.1.0";

async function main() {
  const connectionFile = process.argv[2];
  if (!connectionFile) {
    console.error("Usage: exist-jupyter-kernel <connection_file>");
    process.exit(1);
  }

  // Read connection info from Jupyter
  const connectionInfo = JSON.parse(await readFile(connectionFile, "utf-8"));

  // Load eXist-db config
  const existConfig = await loadConfig();
  const client = new ExistClient(existConfig);

  await log(`eXist-db XQuery Kernel v${VERSION}`);
  await log(`Connecting to eXist-db at ${existConfig.server}`);
  await log(`Connection: ${JSON.stringify(connectionInfo)}`);

  const handlers = {
    kernelInfo() {
      log("kernel_info_request received");
      return {
        status: "ok",
        protocol_version: "5.3",
        implementation: "exist-jupyter-kernel",
        implementation_version: VERSION,
        language_info: {
          name: "xquery",
          version: "4.0",
          mimetype: "application/xquery",
          file_extension: ".xq",
        },
        banner: `eXist-db XQuery Kernel v${VERSION}\nConnected to ${existConfig.server}`,
        help_links: [
          {
            text: "eXist-db Documentation",
            url: "https://exist-db.org/exist/apps/doc/",
          },
          {
            text: "XQuery 4.0 Specification",
            url: "https://qt4cg.org/specifications/xquery-40/",
          },
        ],
      };
    },

    async execute(content, executionCount, jupyterSession) {
      const code = content.code;
      await log(`execute_request #${executionCount}: ${JSON.stringify(code).slice(0, 200)}`);

      // Skip empty cells
      if (!code.trim()) {
        return { data: { "text/plain": "" }, metadata: {} };
      }

      // Parse xqdoc directives (@name, @output)
      const { name: directiveName, serialization: directive } = parseDirectives(code);

      // Cell name: @name directive takes priority, fall back to cell metadata
      const cellName = directiveName || content.metadata?.exist?.name || null;

      const cellSerialization = content.metadata?.exist?.serialization || null;
      // notebookMeta would come from notebook-level metadata; not available
      // in execute_request, so null here — the kernel could be extended to
      // read it from kernel_info or a separate config mechanism
      const serialization = mergeSerialization(directive, cellSerialization, null);

      const result = await client.execute(code, jupyterSession, cellName, serialization);
      await log(`execute_result #${executionCount}: ${JSON.stringify(result).slice(0, 200)}`);
      return result;
    },

    isComplete(code) {
      return checkComplete(code);
    },
  };

  const kernel = new JupyterKernel(connectionInfo, handlers);
  await kernel.start();

  await log("Kernel started and listening");

  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    await kernel.close();
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    await kernel.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Kernel failed to start:", err);
  process.exit(1);
});
