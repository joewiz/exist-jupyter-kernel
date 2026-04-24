/**
 * Parse xqdoc-style directives from XQuery cell code.
 *
 * Looks for an xqdoc comment block at the start of the cell:
 *
 *   (:~ @name books @output indent=yes method=xml :)
 *
 * Recognized directives:
 *   @name <identifier>      — name this cell's result (becomes $name in later cells)
 *   @data xml|json|text     — treat cell content as data, not executable XQuery
 *   @silent                 — suppress output (useful for data-only cells)
 *   @output key=value       — serialization parameters
 *
 * Other xqdoc tags (@see, @author, @version, etc.) are ignored.
 *
 * @see https://xqdoc.org/xqdoc_comments_doc.html
 */

/**
 * Parse @name, @data, and @output directives from an xqdoc comment block.
 *
 * @param {string} code - XQuery cell source
 * @returns {{ name: string|null, dataFormat: string|null, silent: boolean, serialization: object|null, code: string }}
 *   name: cell name from @name directive, or null
 *   dataFormat: "xml", "json", or "text" from @data directive, or null
 *   silent: true if @silent directive is present
 *   serialization: parsed key=value pairs from @output, or null if none
 *   code: the original code (unchanged — the comment is valid XQuery)
 */
export function parseDirectives(code) {
  const trimmed = code.trimStart();

  // Match an xqdoc comment block: (:~ ... :)
  // The block must start at the beginning of the cell (ignoring whitespace)
  const match = trimmed.match(/^\(:~([\s\S]*?):\)/);
  if (!match) {
    return { name: null, dataFormat: null, silent: false, serialization: null, code };
  }

  const body = match[1];
  const serialization = {};
  let hasOutput = false;
  let name = null;
  let dataFormat = null;
  let silent = false;

  // Split into lines and look for directives
  for (const line of body.split("\n")) {
    const stripped = line.trim().replace(/^[*:]\s?/, ""); // strip leading * or : from xqdoc

    // Match @name followed by an identifier
    const nameMatch = stripped.match(/^@name\s+([a-zA-Z_][a-zA-Z0-9_-]*)/);
    if (nameMatch) {
      name = nameMatch[1];
      continue;
    }

    // Match @data followed by a format (xml, json, text)
    const dataMatch = stripped.match(/^@data\s+(xml|json|text)\b/i);
    if (dataMatch) {
      dataFormat = dataMatch[1].toLowerCase();
      continue;
    }

    // Match @silent
    if (/^@silent\b/.test(stripped)) {
      silent = true;
      continue;
    }

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
    name,
    dataFormat,
    silent,
    serialization: hasOutput ? serialization : null,
    code, // pass through unchanged — the comment is valid XQuery
  };
}

/**
 * Wrap data cell content as executable XQuery.
 *
 * For @data cells, the content after the xqdoc comment is raw data (not XQuery).
 * This function wraps it so eXist-db can evaluate it:
 *   - xml:  passed through as-is (XML literals are valid XQuery)
 *   - json: wrapped in parse-json('...')
 *   - text: wrapped in a string literal
 *
 * @param {string} code - full cell source including the xqdoc comment
 * @param {string} dataFormat - "xml", "json", or "text"
 * @returns {string} executable XQuery
 */
export function wrapDataCell(code, dataFormat) {
  // Strip the xqdoc comment to get the raw data content
  const content = code.replace(/^\s*\(:~[\s\S]*?:\)\s*/, "");

  switch (dataFormat) {
    case "json": {
      // Escape single quotes for XQuery string literal
      const escaped = content.replace(/'/g, "''");
      return `parse-json('${escaped}')`;
    }
    case "text": {
      const escaped = content.replace(/'/g, "''");
      return `'${escaped}'`;
    }
    case "xml":
    default:
      // XML literals are valid XQuery — just return the content
      return content;
  }
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
