import {
  findCreateServerFnCalls,
  findMatchingBrace,
  findValueEnd,
  scanImports,
} from "./parser";

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
 * Remove the `handler` property (supporting `handler: <value>` and method shorthands) from an object literal string.
 */
function stripHandlerProperty(objectStr: string): string {
  const handlerPattern = /(?:async\s+)?\bhandler\s*(?::|\()/g;
  let m: RegExpExecArray | null;

  while ((m = handlerPattern.exec(objectStr)) !== null) {
    let removeStart = m.index;
    let removeEnd: number;

    const matched = m[0];
    if (matched.endsWith(":")) {
      const valueStart = m.index + matched.length;
      removeEnd = findValueEnd(objectStr, valueStart);
    } else {
      // Method shorthand: handler(...) { ... } or async handler(...) { ... }
      const parenOpen = m.index + matched.length - 1;
      let depth = 1;
      let i = parenOpen + 1;
      let inStr: string | null = null;
      while (i < objectStr.length && depth > 0) {
        const ch = objectStr[i];
        if (inStr) {
          if (ch === inStr && objectStr[i - 1] !== "\\") inStr = null;
        } else if (ch === '"' || ch === "'" || ch === "`") {
          inStr = ch;
        } else if (ch === "(") depth++;
        else if (ch === ")") depth--;
        i++;
      }
      while (i < objectStr.length && objectStr[i] !== "{") i++;
      if (i < objectStr.length && objectStr[i] === "{") {
        const braceClose = findMatchingBrace(objectStr, i);
        removeEnd = braceClose === -1 ? objectStr.length : braceClose + 1;
      } else {
        removeEnd = i;
      }
    }

    // Include trailing comma and whitespace
    if (objectStr[removeEnd] === ",") {
      removeEnd++;
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
 *
 * Multi-line imports are handled correctly by character-level scanning.
 * Output for kept regions is byte-identical to the input.
 */
function stripUnusedImports(code: string): string {
  const importInfos = scanImports(code);
  if (importInfos.length === 0) return code;

  // Build "non-import code" by stitching together everything OUTSIDE the
  // import ranges. Replace each import range with whitespace of equal byte
  // length so character offsets in the rest of the code are preserved (not
  // strictly required, but keeps line-based regex tests behaving naturally).
  let nonImportCode = "";
  let cursor = 0;
  for (const info of importInfos) {
    nonImportCode += code.slice(cursor, info.start);
    cursor = info.end;
  }
  nonImportCode += code.slice(cursor);

  const keep: boolean[] = importInfos.map((info) => {
    if (info.isTypeOnly) return true;
    if (info.isSideEffect) return true;

    const candidates: string[] = [];
    if (info.defaultName) candidates.push(info.defaultName);
    if (info.namespaceName) candidates.push(info.namespaceName);
    for (const n of info.namedBindings) candidates.push(n);

    if (candidates.length === 0) return true;

    return candidates.some((name) =>
      new RegExp(`\\b${escapeRegex(name)}\\b`).test(nonImportCode),
    );
  });

  // Stitch the output together: drop unkept import ranges, leave everything
  // else byte-identical. Also collapse a single trailing newline immediately
  // after a removed import so we don't leave behind blank lines.
  let out = "";
  cursor = 0;
  for (let idx = 0; idx < importInfos.length; idx++) {
    const info = importInfos[idx];
    out += code.slice(cursor, info.start);
    if (keep[idx]) {
      out += info.text;
    } else {
      // Skip the import. Also consume one trailing newline (\n or \r\n) to
      // avoid leaving an empty line behind.
      let after = info.end;
      if (code[after] === "\r" && code[after + 1] === "\n") after += 2;
      else if (code[after] === "\n") after += 1;
      cursor = after;
      continue;
    }
    cursor = info.end;
  }
  out += code.slice(cursor);
  return out;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
