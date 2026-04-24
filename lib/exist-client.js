/**
 * HTTP client for eXist-db's notebook eval API.
 *
 * Handles XQuery evaluation, cell chaining context, and error mapping.
 */

/**
 * Map eXist serialization type to a code fence language for syntax highlighting.
 */
function serializationToLanguage(type) {
  switch (type) {
    case "xml":
      return "xml";
    case "json":
      return "json";
    case "html":
    case "html5":
    case "xhtml":
      return "html";
    case "adaptive":
      return "xquery";
    case "text":
    default:
      return null; // no highlighting
  }
}

/**
 * Check whether media-type requests rendered HTML output.
 *
 * When `media-type=text/html` is present in the @output directive, the kernel
 * renders the output as HTML in the notebook:
 *   - HTML/XHTML output → passed through as text/html
 *   - CSV output → converted to an HTML table by the kernel
 *   - Other types → no rendered form (falls back to source view)
 *
 * Without `media-type`, all output is shown as syntax-highlighted source.
 */
function wantsRenderedHtml(mediaType) {
  if (!mediaType) return false;
  const normalized = mediaType.toLowerCase().trim();
  return normalized === "text/html" || normalized === "application/xhtml+xml";
}

/**
 * Parse CSV text into an HTML table.
 *
 * Respects CSV serialization parameters (unprefixed, following BaseX convention):
 *   - field-delimiter (default: ",")
 *   - quote-character (default: '"')
 *   - header — when "true"/"yes", the first row is treated as a header
 *
 * @param {string} csv - CSV text
 * @param {object} [opts] - serialization options
 */
function csvToHtmlTable(csv, opts) {
  const delimiter = opts?.["field-delimiter"] || ",";
  const quote = opts?.["quote-character"] || '"';
  const hasHeader = opts?.["header"] === "true" || opts?.["header"] === "yes";

  const lines = parseCsvLines(csv.trim(), delimiter, quote);
  if (lines.length === 0) return "";

  const rows = lines.map((fields) =>
    fields.map((f) => escapeHtml(f))
  );

  // If csv.header is set, the first row was explicitly requested as a header.
  // Otherwise, still treat the first row as a header for display purposes —
  // the first row of a CSV table is almost always column names.
  const [header, ...body] = rows;
  let html = '<table style="border-collapse:collapse;border:1px solid #ccc;font-size:13px;">\n<thead><tr>';
  for (const cell of header) {
    html += `<th style="border:1px solid #ccc;padding:4px 8px;background:#f5f5f5;text-align:left;">${cell}</th>`;
  }
  html += "</tr></thead>\n<tbody>\n";
  for (const row of body) {
    html += "<tr>";
    for (const cell of row) {
      html += `<td style="border:1px solid #ccc;padding:4px 8px;">${cell}</td>`;
    }
    html += "</tr>\n";
  }
  html += "</tbody></table>";
  return html;
}

function parseCsvLines(text, delimiter, quote) {
  const lines = [];
  let pos = 0;
  while (pos < text.length) {
    const { fields, nextPos } = parseCsvRow(text, pos, delimiter, quote);
    lines.push(fields);
    pos = nextPos;
  }
  return lines;
}

function parseCsvRow(text, start, delimiter, quote) {
  const fields = [];
  let pos = start;

  while (pos < text.length) {
    if (text[pos] === quote) {
      // Quoted field
      let val = "";
      pos++; // skip opening quote
      while (pos < text.length) {
        if (text[pos] === quote) {
          if (text[pos + 1] === quote) {
            val += quote;
            pos += 2;
          } else {
            pos++; // skip closing quote
            break;
          }
        } else {
          val += text[pos];
          pos++;
        }
      }
      fields.push(val);
      // Skip delimiter or newline after field
      if (text.startsWith(delimiter, pos)) { pos += delimiter.length; }
      else if (text[pos] === "\r") { pos++; if (text[pos] === "\n") pos++; return { fields, nextPos: pos }; }
      else if (text[pos] === "\n") { pos++; return { fields, nextPos: pos }; }
    } else {
      // Unquoted field — scan until delimiter or newline
      let end = pos;
      while (end < text.length && !text.startsWith(delimiter, end) && text[end] !== "\n" && text[end] !== "\r") end++;
      fields.push(text.slice(pos, end));
      pos = end;
      if (text.startsWith(delimiter, pos)) { pos += delimiter.length; }
      else if (text[pos] === "\r") { pos++; if (text[pos] === "\n") pos++; return { fields, nextPos: pos }; }
      else if (text[pos] === "\n") { pos++; return { fields, nextPos: pos }; }
    }
  }
  return { fields, nextPos: pos };
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Build the MIME bundle for a cell result.
 *
 * Rendering is driven by the `media-type` serialization parameter:
 *   - `media-type=text/html`  → rendered HTML via text/html MIME type
 *   - `media-type=text/csv`   → rendered HTML table via text/html MIME type
 *   - absent or other values  → syntax-highlighted source via text/markdown code fence
 *
 * @param {string} text - serialized result text
 * @param {string} type - serialization type from eXist (xml, json, html, csv, adaptive, text)
 * @param {object} serialization - merged serialization options
 * @returns {object} MIME bundle ({ "text/plain": ..., "text/html"?: ..., "text/markdown"?: ... })
 */
function buildMimeBundle(text, type, serialization) {
  const data = { "text/plain": text };
  if (!text) return data;

  if (wantsRenderedHtml(serialization?.["media-type"])) {
    if (type === "csv") {
      data["text/html"] = csvToHtmlTable(text, serialization);
    } else {
      data["text/html"] = text;
    }
  } else {
    // Source mode: syntax-highlighted code fence
    const lang = serializationToLanguage(type);
    if (lang) {
      data["text/markdown"] = "```" + lang + "\n" + text + "\n```";
    }
  }

  return data;
}

// Exported for testing
export { buildMimeBundle, csvToHtmlTable };

export class ExistClient {
  constructor(config) {
    this.serverUrl = config.server || "http://localhost:8080/exist";
    this.user = config.user || "admin";
    this.password = config.password || "";
    this.timeout = config.timeout || 30000;

    // Session-scoped cell cache: session -> [{name, query}]
    this.cellCache = new Map();
  }

  /**
   * Execute an XQuery expression against eXist-db.
   *
   * @param {string} code - XQuery code to evaluate
   * @param {string} session - Jupyter session ID
   * @param {string} [cellName] - Optional name for this cell's result
   * @returns {object} - { data, metadata } on success, { error, ename, evalue, traceback } on failure
   */
  async execute(code, session, cellName, serialization) {
    const context = this._getContext(session);

    const body = {
      query: code,
      session,
      serialization: serialization || { method: "adaptive" },
    };

    if (cellName) {
      body.cellName = cellName;
    }

    if (context.length > 0) {
      body.context = context;
    }

    const url = `${this.serverUrl}/apps/notebook/api/eval`;

    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    if (this.user) {
      const credentials = Buffer.from(`${this.user}:${this.password}`).toString("base64");
      headers.Authorization = `Basic ${credentials}`;
    }

    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeout),
      });
    } catch (err) {
      if (err.name === "TimeoutError") {
        return {
          error: true,
          ename: "TimeoutError",
          evalue: `Request timed out after ${this.timeout}ms`,
          traceback: [],
        };
      }
      return {
        error: true,
        ename: "ConnectionError",
        evalue: `Cannot connect to eXist-db at ${this.serverUrl}: ${err.message}`,
        traceback: [],
      };
    }

    let result;
    try {
      result = await response.json();
    } catch {
      const text = await response.text().catch(() => "(no body)");
      return {
        error: true,
        ename: "ServerError",
        evalue: `eXist-db returned ${response.status}: ${text}`,
        traceback: [],
      };
    }

    if (result.error) {
      const traceback = [];
      if (result.line != null) {
        traceback.push(`Line ${result.line}, Column ${result.column || 0}`);
      }
      return {
        error: true,
        ename: result.code || "XQueryError",
        evalue: result.error,
        traceback,
      };
    }

    // Cache this cell for future context if it has a name
    if (cellName) {
      this._addToCache(session, cellName, code);
    }

    const text = result.result ?? "";
    const data = buildMimeBundle(text, result.type, serialization);

    return {
      data,
      metadata: {
        type: result.type,
        count: result.count,
        elapsed: result.elapsed,
      },
    };
  }

  _getContext(session) {
    return this.cellCache.get(session) || [];
  }

  _addToCache(session, name, query) {
    if (!this.cellCache.has(session)) {
      this.cellCache.set(session, []);
    }
    const cells = this.cellCache.get(session);
    // Replace if same name exists
    const idx = cells.findIndex((c) => c.name === name);
    if (idx >= 0) {
      cells[idx] = { name, query };
    } else {
      cells.push({ name, query });
    }
  }

  /**
   * Clear the cell cache for a session.
   */
  clearSession(session) {
    this.cellCache.delete(session);
  }
}
