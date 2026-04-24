#!/usr/bin/env node

/**
 * CLI for exist-jupyter-kernel.
 *
 * Commands:
 *   install   — Install the kernel spec into Jupyter's kernel directory
 *   uninstall — Remove the kernel spec
 *   (default) — Launch the kernel (called by Jupyter with connection file)
 */

import { mkdir, writeFile, rm } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { homedir, platform } from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const KERNEL_DIR_NAME = "xquery-exist";

function getKernelDir() {
  const plat = platform();
  if (plat === "darwin") {
    return join(homedir(), "Library", "Jupyter", "kernels", KERNEL_DIR_NAME);
  } else if (plat === "win32") {
    return join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "jupyter", "kernels", KERNEL_DIR_NAME);
  } else {
    return join(homedir(), ".local", "share", "jupyter", "kernels", KERNEL_DIR_NAME);
  }
}

function getKernelSpec() {
  const kernelJs = resolve(__dirname, "..", "lib", "kernel.js");
  return {
    argv: ["node", kernelJs, "{connection_file}"],
    display_name: "XQuery (eXist-db)",
    language: "xquery",
    metadata: {
      debugger: false,
    },
  };
}

async function install() {
  const dir = getKernelDir();
  await mkdir(dir, { recursive: true });

  const spec = getKernelSpec();
  const specPath = join(dir, "kernel.json");
  await writeFile(specPath, JSON.stringify(spec, null, 2) + "\n");

  console.log(`Kernel spec installed to: ${dir}`);
  console.log(`Display name: ${spec.display_name}`);
  console.log(`Kernel entry: ${spec.argv[1]}`);
  console.log("\nYou can now select 'XQuery (eXist-db)' as a kernel in Jupyter or VS Code.");
}

async function uninstall() {
  const dir = getKernelDir();
  try {
    await rm(dir, { recursive: true });
    console.log(`Kernel spec removed from: ${dir}`);
  } catch (err) {
    if (err.code === "ENOENT") {
      console.log("Kernel spec not found — nothing to remove.");
    } else {
      throw err;
    }
  }
}

const command = process.argv[2];

switch (command) {
  case "install":
    install().catch((err) => {
      console.error("Install failed:", err);
      process.exit(1);
    });
    break;
  case "uninstall":
    uninstall().catch((err) => {
      console.error("Uninstall failed:", err);
      process.exit(1);
    });
    break;
  default:
    // If called with a connection file, launch the kernel
    if (command && !command.startsWith("-")) {
      // Re-exec as kernel
      const { execFileSync } = await import("node:child_process");
      const kernelJs = resolve(__dirname, "..", "lib", "kernel.js");
      try {
        execFileSync("node", [kernelJs, command], { stdio: "inherit" });
      } catch {
        process.exit(1);
      }
    } else {
      console.log("exist-jupyter-kernel — XQuery kernel for Jupyter\n");
      console.log("Commands:");
      console.log("  install     Install the kernel spec into Jupyter");
      console.log("  uninstall   Remove the kernel spec from Jupyter");
      console.log("\nUsage:");
      console.log("  npx exist-jupyter-kernel install");
      console.log("  npx exist-jupyter-kernel uninstall");
    }
}
