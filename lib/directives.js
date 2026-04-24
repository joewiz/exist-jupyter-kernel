/**
 * Parse xqdoc-style directives from XQuery cell code.
 *
 * Looks for an xqdoc comment block at the start of the cell:
 *
 *   (:~ @output indent=yes method=xml :)
 *
 * Only the @output directive is recognized; other xqdoc tags
 * (@see, @author, @version, @param, @return, etc.) are ignored.
 *
 * @see https://xqdoc.org/xqdoc_comments_doc.html
 */

/**
 * Parse @output directives from an xqdoc comment block.
 *
 * @param {string} code - XQuery cell source
 * @returns {{ serialization: object|null, code: string }}
 *   serialization: parsed key=value pairs from @output, or null if none
 *   code: the original code (unchanged — the comment is valid XQuery)
 */
export function parseDirectives(code) {
  const trimmed = code.trimStart();

  // Match an xqdoc comment block: (:~ ... :)
  // The block must start at the beginning of the cell (ignoring whitespace)
  const match = trimmed.match(/^\(:~([\s\S]*?):\)/);
  if (!match) {
    return { serialization: null, code };
  }

  const body = match[1];
  const serialization = {};
  let hasOutput = false;

  // Split into lines and look for @output directives
  for (const line of body.split("\n")) {
    const stripped = line.trim().replace(/^\*\s*/, ""); // strip leading * from formatted xqdoc

    // Match @output followed by key=value pairs
    const outputMatch = stripped.match(/^@output\s+(.*)/);
    if (!outputMatch) continue;

    hasOutput = true;
    // Parse key=value pairs from the rest of the line
    const pairs = outputMatch[1];
    const pairRegex = /([a-zA-Z][a-zA-Z0-9_-]*)=(\S+)/g;
    let m;
    while ((m = pairRegex.exec(pairs)) !== null) {
      serialization[m[1]] = m[2];
    }
  }

  return {
    serialization: hasOutput ? serialization : null,
    code, // pass through unchanged — xqdoc comment is valid XQuery
  };
}

/**
 * Merge serialization options with priority:
 *   cell directive > cell metadata > notebook metadata > default
 *
 * @param {object|null} directive - from parseDirectives
 * @param {object|null} cellMeta - from cell metadata.exist.serialization
 * @param {object|null} notebookMeta - from notebook metadata.exist.serialization
 * @returns {object} merged serialization options
 */
export function mergeSerialization(directive, cellMeta, notebookMeta) {
  const base = { method: "adaptive" };
  return { ...base, ...notebookMeta, ...cellMeta, ...directive };
}
