/**
 * XQuery completeness checker for is_complete_request.
 *
 * Basic heuristic: checks whether braces, parentheses, and brackets
 * are balanced, and whether the expression looks "complete."
 */

export function checkComplete(code) {
  const trimmed = code.trim();
  if (!trimmed) {
    return { status: "incomplete", indent: "" };
  }

  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  let inString = false;
  let stringChar = null;
  let inComment = false;
  let inLineComment = false;

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    const next = trimmed[i + 1];

    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      continue;
    }

    if (inComment) {
      if (ch === ":" && next === ")") {
        inComment = false;
        i++;
      }
      continue;
    }

    if (inString) {
      if (ch === stringChar) {
        // Check for escaped quotes (doubled)
        if (next === stringChar) {
          i++;
        } else {
          inString = false;
          stringChar = null;
        }
      }
      continue;
    }

    // XQuery comments: (: ... :)
    if (ch === "(" && next === ":") {
      inComment = true;
      i++;
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      stringChar = ch;
      continue;
    }

    if (ch === "(") parenDepth++;
    else if (ch === ")") parenDepth--;
    else if (ch === "{") braceDepth++;
    else if (ch === "}") braceDepth--;
    else if (ch === "[") bracketDepth++;
    else if (ch === "]") bracketDepth--;
  }

  if (inString || inComment) {
    return { status: "incomplete", indent: "" };
  }

  if (parenDepth > 0 || braceDepth > 0 || bracketDepth > 0) {
    return { status: "incomplete", indent: "  " };
  }

  return { status: "complete" };
}
