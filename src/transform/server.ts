import { findCreateServerFnCalls, scanImports } from "./parser";

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

  // Collect all complete `import` statements (incl. multi-line ones).
  // Character-level scan handles strings/comments and multi-line bindings.
  const imports = scanImports(code).map((info) => info.text);

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
