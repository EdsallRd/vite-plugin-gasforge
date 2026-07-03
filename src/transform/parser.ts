/**
 * Information about a single top-level `import` statement.
 */
export interface ImportInfo {
  /** The full statement text, including newlines if multi-line. */
  text: string;
  /** Byte offset of the `i` in `import`. */
  start: number;
  /** Byte offset just past the end of the statement (exclusive). */
  end: number;
  /** True for `import type { ... }` or `import type X from ...`. */
  isTypeOnly: boolean;
  /** True for `import "polyfill"` (no `from`). */
  isSideEffect: boolean;
  /** Local name of a default import (`import X from "..."`). */
  defaultName?: string;
  /** Local names of named bindings (post-`as`); excludes leading `type ` prefix. */
  namedBindings: string[];
  /** Local name of a namespace import (`import * as X from "..."`). */
  namespaceName?: string;
}

/**
 * Scan `code` and return all top-level `import` statements as structured records.
 *
 * String/comment-aware: respects single, double, and template string literals
 * (with escape handling), line comments, and block comments. Filters out
 * `import.meta`, dynamic `import(...)`, and substrings inside identifiers.
 */
export function scanImports(code: string): ImportInfo[] {
  const out: ImportInfo[] = [];
  const len = code.length;
  let i = 0;
  let inString: string | null = null;
  let prevChar = "";

  while (i < len) {
    const ch = code[i];

    // String state
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

    // Comments
    if (ch === "/" && code[i + 1] === "/") {
      const eol = code.indexOf("\n", i);
      i = eol === -1 ? len : eol + 1;
      prevChar = "\n";
      continue;
    }
    if (ch === "/" && code[i + 1] === "*") {
      const end = code.indexOf("*/", i + 2);
      i = end === -1 ? len : end + 2;
      prevChar = "/";
      continue;
    }

    // Look for the keyword `import`
    if (
      ch === "i" &&
      code.slice(i, i + 6) === "import" &&
      // not preceded by an identifier character (so we don't match `reimport`)
      !/[A-Za-z0-9_$]/.test(prevChar)
    ) {
      const after = code[i + 6];
      // Reject substrings inside identifiers: `importMap`, `imports`, etc.
      if (after !== undefined && /[A-Za-z0-9_$]/.test(after)) {
        prevChar = ch;
        i++;
        continue;
      }
      // Reject `import.meta` and dynamic `import(...)`
      // Skip whitespace to peek the next significant char
      let p = i + 6;
      while (p < len && /\s/.test(code[p])) p++;
      const next = code[p];
      if (next === "." || next === "(") {
        // not an import statement
        prevChar = ch;
        i++;
        continue;
      }
      // Must be followed by whitespace, `{`, `"`, `'`, `*`, or an identifier (default/namespace/type form).
      // (We've already consumed whitespace above into `p`.)
      if (
        next !== "{" &&
        next !== '"' &&
        next !== "'" &&
        next !== "*" &&
        !(next !== undefined && /[A-Za-z_$]/.test(next))
      ) {
        prevChar = ch;
        i++;
        continue;
      }

      const stmtStart = i;
      const info = parseImportFrom(code, stmtStart);
      if (info) {
        out.push(info);
        i = info.end;
        prevChar = code[i - 1] ?? "";
        continue;
      }
      // If parse failed, advance past the keyword to avoid an infinite loop.
      i += 6;
      prevChar = "t";
      continue;
    }

    prevChar = ch;
    i++;
  }

  return out;
}

/**
 * Parse a single import statement starting at `start` (where `code[start..start+6] === "import"`).
 * Returns the parsed info, or null if the statement could not be parsed.
 */
export function parseImportFrom(code: string, start: number): ImportInfo | null {
  const len = code.length;
  let i = start + 6; // past `import`
  let isTypeOnly = false;
  let defaultName: string | undefined;
  let namespaceName: string | undefined;
  const namedBindings: string[] = [];

  // Advance past whitespace/comments helper
  const skipWs = () => {
    while (i < len) {
      const ch = code[i];
      if (/\s/.test(ch)) {
        i++;
        continue;
      }
      if (ch === "/" && code[i + 1] === "/") {
        const eol = code.indexOf("\n", i);
        i = eol === -1 ? len : eol + 1;
        continue;
      }
      if (ch === "/" && code[i + 1] === "*") {
        const end = code.indexOf("*/", i + 2);
        i = end === -1 ? len : end + 2;
        continue;
      }
      break;
    }
  };

  skipWs();

  // Side-effect import: `import "..."` or `import '...'`
  if (code[i] === '"' || code[i] === "'") {
    const quoteEnd = consumeStringLiteral(code, i);
    if (quoteEnd === -1) return null;
    let end = quoteEnd;
    if (code[end] === ";") end++;
    return {
      text: code.slice(start, end),
      start,
      end,
      isTypeOnly: false,
      isSideEffect: true,
      namedBindings: [],
    };
  }

  // Optional `type` keyword (import type ...)
  if (code.slice(i, i + 4) === "type" && /\s/.test(code[i + 4] ?? "")) {
    isTypeOnly = true;
    i += 4;
    skipWs();
  }

  // Possible forms now:
  //   { ... }
  //   * as Name
  //   DefaultName
  //   DefaultName, { ... }
  //   DefaultName, * as Name
  if (code[i] === "{") {
    const closeIdx = findMatchingBrace(code, i);
    if (closeIdx === -1) return null;
    const inner = code.slice(i + 1, closeIdx);
    parseNamedBindings(inner, namedBindings);
    i = closeIdx + 1;
  } else if (code[i] === "*") {
    i++;
    skipWs();
    if (code.slice(i, i + 2) === "as" && /\s/.test(code[i + 2] ?? "")) {
      i += 2;
      skipWs();
      const id = consumeIdentifier(code, i);
      if (!id) return null;
      namespaceName = id.name;
      i = id.end;
    } else {
      return null;
    }
  } else {
    // Default import
    const id = consumeIdentifier(code, i);
    if (!id) return null;
    defaultName = id.name;
    i = id.end;

    skipWs();
    if (code[i] === ",") {
      i++;
      skipWs();
      if (code[i] === "{") {
        const closeIdx = findMatchingBrace(code, i);
        if (closeIdx === -1) return null;
        const inner = code.slice(i + 1, closeIdx);
        parseNamedBindings(inner, namedBindings);
        i = closeIdx + 1;
      } else if (code[i] === "*") {
        i++;
        skipWs();
        if (code.slice(i, i + 2) === "as" && /\s/.test(code[i + 2] ?? "")) {
          i += 2;
          skipWs();
          const ns = consumeIdentifier(code, i);
          if (!ns) return null;
          namespaceName = ns.name;
          i = ns.end;
        } else {
          return null;
        }
      } else {
        return null;
      }
    }
  }


  skipWs();

  // Expect `from`
  if (code.slice(i, i + 4) !== "from" || !/\s|["']/.test(code[i + 4] ?? "")) {
    return null;
  }
  i += 4;
  skipWs();

  if (code[i] !== '"' && code[i] !== "'") return null;
  const quoteEnd = consumeStringLiteral(code, i);
  if (quoteEnd === -1) return null;
  let end = quoteEnd;
  // Optional trailing semicolon
  if (code[end] === ";") end++;

  return {
    text: code.slice(start, end),
    start,
    end,
    isTypeOnly,
    isSideEffect: false,
    defaultName,
    namedBindings,
    namespaceName,
  };
}

/**
 * Consume a quoted string literal starting at `code[start]`.
 * Returns the index just past the closing quote, or -1 if not closed.
 */
export function consumeStringLiteral(code: string, start: number): number {
  const quote = code[start];
  if (quote !== '"' && quote !== "'") return -1;
  let i = start + 1;
  let prev = "";
  while (i < code.length) {
    const ch = code[i];
    if (ch === quote && prev !== "\\") return i + 1;
    if (ch === "\n" && prev !== "\\") return -1; // unterminated
    prev = ch === "\\" && prev === "\\" ? "" : ch;
    i++;
  }
  return -1;
}

/**
 * Find the index of the `}` matching the `{` at `start`. String/comment-aware.
 */
export function findMatchingBrace(code: string, start: number): number {
  if (code[start] !== "{") return -1;
  let depth = 1;
  let i = start + 1;
  let inStr: string | null = null;
  let prev = "";
  while (i < code.length) {
    const ch = code[i];
    if (inStr) {
      if (ch === inStr && prev !== "\\") inStr = null;
      prev = ch;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inStr = ch;
      prev = ch;
      i++;
      continue;
    }
    if (ch === "/" && code[i + 1] === "/") {
      const eol = code.indexOf("\n", i);
      i = eol === -1 ? code.length : eol + 1;
      prev = "\n";
      continue;
    }
    if (ch === "/" && code[i + 1] === "*") {
      const end = code.indexOf("*/", i + 2);
      i = end === -1 ? code.length : end + 2;
      prev = "/";
      continue;
    }
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
    prev = ch;
    i++;
  }
  return -1;
}

/**
 * Consume an identifier starting at `start`. Returns null if no identifier.
 */
export function consumeIdentifier(
  code: string,
  start: number,
): { name: string; end: number } | null {
  if (!/[A-Za-z_$]/.test(code[start] ?? "")) return null;
  let i = start + 1;
  while (i < code.length && /[A-Za-z0-9_$]/.test(code[i])) i++;
  return { name: code.slice(start, i), end: i };
}

/**
 * Parse the contents between `{` and `}` of a named-import clause.
 * For each binding, push the local name (post-`as`) onto `out`.
 * Strips any leading `type ` (mixed type/value imports — erased at runtime).
 */
export function parseNamedBindings(inner: string, out: string[]): void {
  for (const raw of inner.split(",")) {
    let token = raw.trim();
    if (!token) continue;
    if (token.startsWith("type ")) token = token.slice(5).trim();
    if (!token) continue;
    const parts = token.split(/\s+as\s+/);
    const local = (parts[1] || parts[0]).trim();
    if (local) out.push(local);
  }
}

/**
 * Starting from `startIndex`, find where a JS value ends at nesting depth 0.
 * Returns the index of the terminating `,` or `}` (not consumed).
 */
export function findValueEnd(code: string, startIndex: number): number {
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
 * Find all `const/let/var/export const VARNAME = createServerFn(` occurrences,
 * supporting TypeScript generics (`createServerFn<I, O>(...)`) and explicit type annotations.
 * Returns array of { name, declStart, callStart, callEnd }.
 */
export interface ServerFnMatch {
  name: string;
  declStart: number;
  callStart: number;
  callEnd: number;
}

export function findCreateServerFnCalls(code: string): ServerFnMatch[] {
  // Pattern matches `var/let/const name = createServerFn` or `name: Type = createServerFn`
  const pattern =
    /(?:export\s+)?(?:const|let|var)\s+(\w+)(?:\s*:\s*[^=]+)?\s*=\s*createServerFn\b/g;
  const matches: ServerFnMatch[] = [];

  let m: RegExpExecArray | null;
  while ((m = pattern.exec(code)) !== null) {
    const name = m[1];
    const declStart = m.index;
    let i = m.index + m[0].length;

    // Skip optional whitespace/comments
    while (i < code.length && /\s/.test(code[i])) i++;

    // Skip TS generics <...> if present
    if (code[i] === "<") {
      let gDepth = 1;
      i++;
      let inStr: string | null = null;
      while (i < code.length && gDepth > 0) {
        const ch = code[i];
        if (inStr) {
          if (ch === inStr && code[i - 1] !== "\\") inStr = null;
        } else if (ch === '"' || ch === "'" || ch === "`") {
          inStr = ch;
        } else if (ch === "<") {
          gDepth++;
        } else if (ch === ">") {
          gDepth--;
        }
        i++;
      }
      while (i < code.length && /\s/.test(code[i])) i++;
    }

    if (code[i] !== "(") continue;
    const parenOpen = i;
    let depth = 1;
    i++;
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
