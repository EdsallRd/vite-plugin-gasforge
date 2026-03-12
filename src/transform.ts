/**
 * Code transforms for vite-plugin-gas.
 *
 * Client transform: strips `handler` from createServerFn calls, injects `__name`,
 * and removes imports that become unused after handler removal.
 *
 * Server extraction: given a file with createServerFn calls mixed with React code,
 * extracts only the imports + createServerFn definitions for the server build.
 */

// ── Utilities ───────────────────────────────────────────────────────────────

/**
 * Starting from `startIndex`, find where a JS value ends at nesting depth 0.
 * Returns the index of the terminating `,` or `}` (not consumed).
 */
function findValueEnd(code: string, startIndex: number): number {
  let depth = 0;
  let i = startIndex;
  let inString: string | null = null;
  let prevChar = "";

  while (i < code.length) {
    const ch = code[i];

    // Handle string literals
    if (inString) {
      if (ch === inString && prevChar !== "\\") inString = null;
      prevChar = ch;
      i++;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      prevChar = ch;
      i++;
      continue;
    }

    // Handle line comments
    if (ch === "/" && code[i + 1] === "/") {
      const eol = code.indexOf("\n", i);
      i = eol === -1 ? code.length : eol + 1;
      continue;
    }

    // Handle block comments
    if (ch === "/" && code[i + 1] === "*") {
      const end = code.indexOf("*/", i + 2);
      i = end === -1 ? code.length : end + 2;
      continue;
    }

    if (ch === "{" || ch === "(" || ch === "[") depth++;
    if (ch === "}" || ch === ")" || ch === "]") {
      if (depth === 0) return i; // closing brace of parent object
      depth--;
    }

    if (depth === 0 && ch === ",") return i;

    prevChar = ch;
    i++;
  }

  return i;
}

/**
 * Find all `const/let/var/export const VARNAME = createServerFn(` occurrences.
 * Returns array of { name, callStart, callEnd } where callStart..callEnd
 * spans the full `createServerFn({...})` expression.
 */
interface ServerFnMatch {
  name: string;
  declStart: number;
  callStart: number;
  callEnd: number;
}

function findCreateServerFnCalls(code: string): ServerFnMatch[] {
  const pattern =
    /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*createServerFn\s*\(/g;
  const matches: ServerFnMatch[] = [];

  let m: RegExpExecArray | null;
  while ((m = pattern.exec(code)) !== null) {
    const name = m[1];
    const declStart = m.index;
    // Find the opening paren of createServerFn(
    const parenOpen = m.index + m[0].length - 1;
    // Count parens to find the matching close
    let depth = 1;
    let i = parenOpen + 1;
    let inStr: string | null = null;

    while (i < code.length && depth > 0) {
      const ch = code[i];
      if (inStr) {
        if (ch === inStr && code[i - 1] !== "\\") inStr = null;
        i++;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        inStr = ch;
        i++;
        continue;
      }
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      i++;
    }

    matches.push({
      name,
      declStart,
      callStart: parenOpen,
      callEnd: i, // index after the closing )
    });
  }

  return matches;
}

// ── Client transform ────────────────────────────────────────────────────────

/**
 * Transform a source file for the client build:
 * 1. Inject `__name: "varName"` into each createServerFn argument
 * 2. Strip the `handler` property (and its value) from each call
 * 3. Remove imports that become unused after handler removal
 */
export function transformForClient(code: string): string | null {
  if (!code.includes("createServerFn")) return null;

  const matches = findCreateServerFnCalls(code);
  if (matches.length === 0) return null;

  // Work backwards so indices remain valid
  let result = code;
  for (let i = matches.length - 1; i >= 0; i--) {
    const { name, callStart, callEnd } = matches[i];

    // Extract the content between createServerFn( and )
    const inner = result.slice(callStart + 1, callEnd - 1);

    // Strip handler property
    const stripped = stripHandlerProperty(inner);

    // Inject __name after the first {
    const braceIdx = stripped.indexOf("{");
    if (braceIdx === -1) continue;

    const injected =
      stripped.slice(0, braceIdx + 1) +
      ` __name: "${name}",` +
      stripped.slice(braceIdx + 1);

    result =
      result.slice(0, callStart + 1) + injected + result.slice(callEnd - 1);
  }

  // Strip imports that became unused after handler removal
  result = stripUnusedImports(result);

  return result;
}

/**
 * Remove the `handler: <value>` property from an object literal string.
 */
function stripHandlerProperty(objectStr: string): string {
  // Match `handler` as a property key (word boundary to avoid matching in strings)
  const handlerPattern = /\bhandler\s*:\s*/g;
  let m: RegExpExecArray | null;

  while ((m = handlerPattern.exec(objectStr)) !== null) {
    const valueStart = m.index + m[0].length;
    const valueEnd = findValueEnd(objectStr, valueStart);

    // Determine removal range
    let removeStart = m.index;
    let removeEnd = valueEnd;

    // Include trailing comma and whitespace
    if (objectStr[removeEnd] === ",") {
      removeEnd++;
      // Skip whitespace/newlines after comma
      while (removeEnd < objectStr.length && /\s/.test(objectStr[removeEnd])) {
        removeEnd++;
      }
    }

    // Remove preceding comma + whitespace if handler isn't the first property
    const before = objectStr.slice(0, removeStart);
    const lastComma = before.lastIndexOf(",");
    if (lastComma !== -1) {
      const between = before.slice(lastComma + 1);
      if (between.trim() === "") {
        removeStart = lastComma;
      }
    }

    return objectStr.slice(0, removeStart) + objectStr.slice(removeEnd);
  }

  return objectStr;
}

/**
 * Remove import statements where none of the imported names appear
 * in the rest of the code (outside of import statements).
 */
function stripUnusedImports(code: string): string {
  // const importPattern =
  //   /^import\s+(?:type\s+)?(?:\{([^}]+)\}|(\w+)).*?from\s+["'][^"']+["'];?\s*$/gm;
  const lines = code.split("\n");

  // Collect all non-import code for usage checking
  const nonImportCode = lines
    .filter((l) => !l.trimStart().startsWith("import "))
    .join("\n");

  return lines
    .filter((line) => {
      const trimmed = line.trimStart();
      if (!trimmed.startsWith("import ")) return true;

      // Type-only imports are always safe to keep (erased at runtime)
      if (trimmed.startsWith("import type ")) return true;

      // Extract imported names
      const namedMatch = trimmed.match(/import\s+\{([^}]+)\}\s+from/);
      const defaultMatch = trimmed.match(/import\s+(\w+)\s+from/);

      if (namedMatch) {
        const names = namedMatch[1]
          .split(",")
          .map((n) => {
            const parts = n.trim().split(/\s+as\s+/);
            return (parts[1] || parts[0]).trim();
          })
          .filter((n) => n && !n.startsWith("type "));

        // Keep if ANY imported name is used in non-import code
        return names.some((name) =>
          new RegExp(`\\b${name}\\b`).test(nonImportCode),
        );
      }

      if (defaultMatch) {
        const name = defaultMatch[1];
        return new RegExp(`\\b${name}\\b`).test(nonImportCode);
      }

      // Side-effect import (import "foo") — keep
      return true;
    })
    .join("\n");
}

// ── Server extraction ───────────────────────────────────────────────────────

/**
 * Given a source file that may contain React components + createServerFn calls,
 * extract only the parts needed for the server build:
 * - All import statements (unused ones will be tree-shaken by Rollup)
 * - All createServerFn variable declarations
 * - Export statements for the extracted functions
 */
export function extractForServer(code: string): string | null {
  if (!code.includes("createServerFn")) return null;

  const matches = findCreateServerFnCalls(code);
  if (matches.length === 0) return null;

  const lines = code.split("\n");

  // Keep all import statements
  const imports = lines.filter((l) => l.trimStart().startsWith("import "));

  // Extract each createServerFn declaration (from declaration start to the `;` after callEnd)
  const declarations: string[] = [];
  const names: string[] = [];

  for (const match of matches) {
    names.push(match.name);
    // Find the end of the statement (the ; or newline after callEnd)
    let stmtEnd = match.callEnd;
    while (
      stmtEnd < code.length &&
      code[stmtEnd] !== ";" &&
      code[stmtEnd] !== "\n"
    ) {
      stmtEnd++;
    }
    if (code[stmtEnd] === ";") stmtEnd++;

    let decl = code.slice(match.declStart, stmtEnd).trim();
    // Remove `export` if present — we'll add our own export statement
    decl = decl.replace(/^export\s+/, "");
    declarations.push(decl);
  }

  // Build extracted module
  const parts = [
    ...imports,
    "",
    ...declarations,
    "",
    `export { ${names.join(", ")} };`,
    "",
  ];

  return parts.join("\n");
}

/**
 * Scan a source string and return the names of all createServerFn calls.
 */
export function getServerFnNames(code: string): string[] {
  return findCreateServerFnCalls(code).map((m) => m.name);
}
