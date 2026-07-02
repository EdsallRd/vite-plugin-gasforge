import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { existsSync } from "fs";

export function getRuntimePath(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  // When executing from dist/ (e.g., dist/index.js), the unified runtime is at ./runtime.js
  const distPath = resolve(currentDir, "./runtime.js");
  if (existsSync(distPath)) {
    return distPath;
  }
  // When executing from src/plugin/ (e.g., during vitest or dev), the file is at ../runtime.ts
  const srcPath = resolve(currentDir, "../runtime.ts");
  if (existsSync(srcPath)) {
    return srcPath;
  }
  return distPath;
}
