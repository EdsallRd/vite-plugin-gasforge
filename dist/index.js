// src/index.ts
import { resolve, dirname } from "path";
import { readdirSync, readFileSync } from "fs";
import { writeFile } from "fs/promises";
import {
  build,
  defineConfig
} from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// src/transform.ts
function findValueEnd(code, startIndex) {
  let depth = 0;
  let i = startIndex;
  let inString = null;
  let prevChar = "";
  while (i < code.length) {
    const ch = code[i];
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
    if (ch === "/" && code[i + 1] === "/") {
      const eol = code.indexOf("\n", i);
      i = eol === -1 ? code.length : eol + 1;
      continue;
    }
    if (ch === "/" && code[i + 1] === "*") {
      const end = code.indexOf("*/", i + 2);
      i = end === -1 ? code.length : end + 2;
      continue;
    }
    if (ch === "{" || ch === "(" || ch === "[") depth++;
    if (ch === "}" || ch === ")" || ch === "]") {
      if (depth === 0) return i;
      depth--;
    }
    if (depth === 0 && ch === ",") return i;
    prevChar = ch;
    i++;
  }
  return i;
}
function findCreateServerFnCalls(code) {
  const pattern = /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*createServerFn\s*\(/g;
  const matches = [];
  let m;
  while ((m = pattern.exec(code)) !== null) {
    const name = m[1];
    const declStart = m.index;
    const parenOpen = m.index + m[0].length - 1;
    let depth = 1;
    let i = parenOpen + 1;
    let inStr = null;
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
      callEnd: i
      // index after the closing )
    });
  }
  return matches;
}
function transformForClient(code) {
  if (!code.includes("createServerFn")) return null;
  const matches = findCreateServerFnCalls(code);
  if (matches.length === 0) return null;
  let result = code;
  for (let i = matches.length - 1; i >= 0; i--) {
    const { name, callStart, callEnd } = matches[i];
    const inner = result.slice(callStart + 1, callEnd - 1);
    const stripped = stripHandlerProperty(inner);
    const braceIdx = stripped.indexOf("{");
    if (braceIdx === -1) continue;
    const injected = stripped.slice(0, braceIdx + 1) + ` __name: "${name}",` + stripped.slice(braceIdx + 1);
    result = result.slice(0, callStart + 1) + injected + result.slice(callEnd - 1);
  }
  result = stripUnusedImports(result);
  return result;
}
function stripHandlerProperty(objectStr) {
  const handlerPattern = /\bhandler\s*:\s*/g;
  let m;
  while ((m = handlerPattern.exec(objectStr)) !== null) {
    const valueStart = m.index + m[0].length;
    const valueEnd = findValueEnd(objectStr, valueStart);
    let removeStart = m.index;
    let removeEnd = valueEnd;
    if (objectStr[removeEnd] === ",") {
      removeEnd++;
      while (removeEnd < objectStr.length && /\s/.test(objectStr[removeEnd])) {
        removeEnd++;
      }
    }
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
function stripUnusedImports(code) {
  const lines = code.split("\n");
  const nonImportCode = lines.filter((l) => !l.trimStart().startsWith("import ")).join("\n");
  return lines.filter((line) => {
    const trimmed = line.trimStart();
    if (!trimmed.startsWith("import ")) return true;
    if (trimmed.startsWith("import type ")) return true;
    const namedMatch = trimmed.match(/import\s+\{([^}]+)\}\s+from/);
    const defaultMatch = trimmed.match(/import\s+(\w+)\s+from/);
    if (namedMatch) {
      const names = namedMatch[1].split(",").map((n) => {
        const parts = n.trim().split(/\s+as\s+/);
        return (parts[1] || parts[0]).trim();
      }).filter((n) => n && !n.startsWith("type "));
      return names.some(
        (name) => new RegExp(`\\b${name}\\b`).test(nonImportCode)
      );
    }
    if (defaultMatch) {
      const name = defaultMatch[1];
      return new RegExp(`\\b${name}\\b`).test(nonImportCode);
    }
    return true;
  }).join("\n");
}
function extractForServer(code) {
  if (!code.includes("createServerFn")) return null;
  const matches = findCreateServerFnCalls(code);
  if (matches.length === 0) return null;
  const lines = code.split("\n");
  const imports = lines.filter((l) => l.trimStart().startsWith("import "));
  const declarations = [];
  const names = [];
  for (const match of matches) {
    names.push(match.name);
    let stmtEnd = match.callEnd;
    while (stmtEnd < code.length && code[stmtEnd] !== ";" && code[stmtEnd] !== "\n") {
      stmtEnd++;
    }
    if (code[stmtEnd] === ";") stmtEnd++;
    let decl = code.slice(match.declStart, stmtEnd).trim();
    decl = decl.replace(/^export\s+/, "");
    declarations.push(decl);
  }
  const parts = [
    ...imports,
    "",
    ...declarations,
    "",
    `export { ${names.join(", ")} };`,
    ""
  ];
  return parts.join("\n");
}
function getServerFnNames(code) {
  return findCreateServerFnCalls(code).map((m) => m.name);
}

// src/index.ts
function createServerFn(def) {
  const fn = async (...args) => def.handler(args[0]);
  return fn;
}
var CLIENT_RUNTIME = `
async function __validate(schema, value) {
  const result = await schema["~standard"].validate(value);
  if ("issues" in result && result.issues) {
    throw new Error("Validation failed: " + result.issues.map(i => i.message).join(", "));
  }
  return result.value;
}

export function createServerFn(def) {
  return async (...args) => {
    const input = args[0];
    const validated = await __validate(def.input, input);
    return new Promise((resolve, reject) => {
      google.script.run
        .withSuccessHandler(async (result) => {
          try { resolve(await __validate(def.output, result)); }
          catch (err) { reject(err); }
        })
        .withFailureHandler(reject)
        [def.__name](validated);
    });
  };
}
`;
function scanAllFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      results.push(...scanAllFiles(full));
    } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name) && !entry.name.endsWith(".gen.ts")) {
      results.push(full);
    }
  }
  return results;
}
function buildRegistry(srcDir) {
  const files = scanAllFiles(srcDir);
  const registry = [];
  const seen = /* @__PURE__ */ new Map();
  for (const filePath of files) {
    const code = readFileSync(filePath, "utf-8");
    if (!code.includes("createServerFn")) continue;
    const names = getServerFnNames(code);
    for (const name of names) {
      if (seen.has(name)) {
        throw new Error(
          `vite-plugin-gas: duplicate server function "${name}" in:
  ${seen.get(name)}
  ${filePath}`
        );
      }
      seen.set(name, filePath);
      registry.push({ name, filePath });
    }
  }
  return registry;
}
var VIRTUAL_SERVER_FNS = "virtual:gas/server-fns";
var VIRTUAL_SERVER_RUNTIME = "virtual:gas/server-runtime";
var VIRTUAL_CLIENT_RUNTIME = "virtual:gas/client-runtime";
var SERVER_RUNTIME = `
export function createServerFn(def) {
  return async (...args) => def.handler(args[0]);
}
`;
function gas(options = {}) {
  const serverEntry = options.server ?? "src/server/index.ts";
  const clientEntry = options.client?.entry ?? "src/client/index.html";
  const clientPlugins = options.client?.plugins ?? [];
  const clientRolldownOptions = options.client?.rolldownOptions ?? {};
  let resolvedConfig;
  let root;
  let registry = [];
  return {
    name: "vite-plugin-gas",
    enforce: "pre",
    configResolved(config) {
      resolvedConfig = config;
      root = config.root;
      registry = buildRegistry(resolve(root, "src"));
      if (registry.length > 0) {
        console.log(
          `vite-plugin-gas: ${registry.length} server function(s) \u2014 ${registry.map((f) => f.name).join(", ")}`
        );
      }
    },
    // Server build configuration (IIFE for GAS)
    config() {
      return {
        build: {
          minify: false,
          lib: {
            entry: serverEntry,
            formats: ["iife"],
            name: "globalThis"
          },
          rollupOptions: {
            output: {
              entryFileNames: "Server.js",
              extend: true,
              footer: (chunk) => {
                return chunk.exports.map((fn) => `function ${fn}() {};`).join("\n");
              }
            }
          }
        }
      };
    },
    // Resolve virtual modules for the server build
    resolveId(source) {
      if (source === VIRTUAL_SERVER_FNS) return "\0" + VIRTUAL_SERVER_FNS;
      if (source === VIRTUAL_SERVER_RUNTIME)
        return "\0" + VIRTUAL_SERVER_RUNTIME;
      if (source === "vite-plugin-gas") return "\0" + VIRTUAL_SERVER_RUNTIME;
      if (source.endsWith("?gas-server")) return source;
      return null;
    },
    // Load virtual modules for the server build
    load(id) {
      if (id === "\0" + VIRTUAL_SERVER_RUNTIME) return SERVER_RUNTIME;
      if (id === "\0" + VIRTUAL_SERVER_FNS) {
        if (registry.length === 0) return "export {};";
        const byFile = /* @__PURE__ */ new Map();
        for (const { name, filePath } of registry) {
          const names = byFile.get(filePath) ?? [];
          names.push(name);
          byFile.set(filePath, names);
        }
        const lines = [];
        for (const [filePath, names] of byFile) {
          const normalizedPath = filePath.replace(/\\/g, "/");
          lines.push(
            `export { ${names.join(", ")} } from "${normalizedPath}?gas-server";`
          );
        }
        return lines.join("\n");
      }
      if (id.endsWith("?gas-server")) {
        const realPath = id.replace(/\?gas-server$/, "");
        const code = readFileSync(realPath, "utf-8");
        const extracted = extractForServer(code);
        return extracted ?? "";
      }
      return null;
    },
    watchChange(id) {
      if (/\.(ts|tsx)$/.test(id) && !id.endsWith(".gen.ts")) {
        const code = readFileSync(id, "utf-8");
        if (code.includes("createServerFn")) {
          console.log(
            "vite-plugin-gas: server function changed, re-scanning..."
          );
          registry = buildRegistry(resolve(root, "src"));
        }
      }
    },
    // Client build
    async closeBundle() {
      console.log("vite-plugin-gas: building client bundle...");
      const clientDir = resolve(root, dirname(clientEntry));
      const distDir = resolvedConfig.build.outDir ? resolve(root, resolvedConfig.build.outDir) : resolve(root, "dist");
      const clientConfig = defineConfig({
        plugins: [
          gasClientPlugin(),
          ...clientPlugins,
          viteSingleFile({ useRecommendedBuildConfig: true })
        ],
        root: clientDir,
        build: {
          minify: resolvedConfig.define?.PRODUCTION ?? false,
          outDir: distDir,
          write: false,
          rollupOptions: {
            ...clientRolldownOptions,
            output: { format: "es" },
            input: resolve(root, clientEntry)
          }
        },
        resolve: {
          alias: { "@": clientDir }
        },
        define: resolvedConfig.define
      });
      const buildOutput = await build(clientConfig);
      await writeFile(
        resolve(distDir, "Client.html"),
        // @ts-expect-error - output is an array of RollupOutput
        buildOutput.output[0].source,
        "utf-8"
      );
    }
  };
}
function gasClientPlugin() {
  return {
    name: "vite-plugin-gas:client",
    enforce: "pre",
    resolveId(source) {
      if (source === "vite-plugin-gas") return VIRTUAL_CLIENT_RUNTIME;
      if (source === VIRTUAL_CLIENT_RUNTIME) return VIRTUAL_CLIENT_RUNTIME;
      return null;
    },
    load(id) {
      if (id === VIRTUAL_CLIENT_RUNTIME) return CLIENT_RUNTIME;
      return null;
    },
    // Transform source files: strip handler, inject __name
    transform(code, id) {
      const cleanId = id.split("?")[0];
      if (!/\.(ts|tsx|js|jsx)$/.test(cleanId)) return null;
      return transformForClient(code);
    }
  };
}
export {
  createServerFn,
  gas as default
};
