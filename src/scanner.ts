import { resolve } from "path";
import { readdirSync, readFileSync } from "fs";
import { getServerFnNames } from "./transform";

export interface FnEntry {
  name: string;
  filePath: string;
}

export function scanAllFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      results.push(...scanAllFiles(full));
    } else if (
      /\.(ts|tsx|js|jsx)$/.test(entry.name) &&
      !entry.name.endsWith(".gen.ts")
    ) {
      results.push(full);
    }
  }
  return results;
}

export function buildRegistry(srcDir: string): FnEntry[] {
  const files = scanAllFiles(srcDir);
  const registry: FnEntry[] = [];
  const seen = new Map<string, string>();

  for (const filePath of files) {
    const code = readFileSync(filePath, "utf-8");
    if (!code.includes("createServerFn")) continue;

    const names = getServerFnNames(code);
    for (const name of names) {
      if (seen.has(name)) {
        throw new Error(
          `vite-plugin-gasforge: duplicate server function "${name}" in:\n` +
            `  ${seen.get(name)}\n  ${filePath}`,
        );
      }
      seen.set(name, filePath);
      registry.push({ name, filePath });
    }
  }

  return registry;
}
