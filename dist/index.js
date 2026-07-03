// src/plugin/index.ts
import { resolve as resolve3, dirname as dirname2 } from "path";
import { readFileSync as readFileSync2 } from "fs";
import { writeFile } from "fs/promises";
import { createRequire as createRequire2 } from "module";
import {
  build,
  defineConfig
} from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// src/transform/parser.ts
function scanImports(code) {
  const out = [];
  const len = code.length;
  let i = 0;
  let inString = null;
  let prevChar = "";
  while (i < len) {
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
    if (ch === "i" && code.slice(i, i + 6) === "import" && // not preceded by an identifier character (so we don't match `reimport`)
    !/[A-Za-z0-9_$]/.test(prevChar)) {
      const after = code[i + 6];
      if (after !== void 0 && /[A-Za-z0-9_$]/.test(after)) {
        prevChar = ch;
        i++;
        continue;
      }
      let p = i + 6;
      while (p < len && /\s/.test(code[p])) p++;
      const next = code[p];
      if (next === "." || next === "(") {
        prevChar = ch;
        i++;
        continue;
      }
      if (next !== "{" && next !== '"' && next !== "'" && next !== "*" && !(next !== void 0 && /[A-Za-z_$]/.test(next))) {
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
      i += 6;
      prevChar = "t";
      continue;
    }
    prevChar = ch;
    i++;
  }
  return out;
}
function parseImportFrom(code, start) {
  const len = code.length;
  let i = start + 6;
  let isTypeOnly = false;
  let defaultName;
  let namespaceName;
  const namedBindings = [];
  let sawClause = false;
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
        const end2 = code.indexOf("*/", i + 2);
        i = end2 === -1 ? len : end2 + 2;
        continue;
      }
      break;
    }
  };
  skipWs();
  if (code[i] === '"' || code[i] === "'") {
    const quoteEnd2 = consumeStringLiteral(code, i);
    if (quoteEnd2 === -1) return null;
    let end2 = quoteEnd2;
    if (code[end2] === ";") end2++;
    return {
      text: code.slice(start, end2),
      start,
      end: end2,
      isTypeOnly: false,
      isSideEffect: true,
      namedBindings: []
    };
  }
  if (code.slice(i, i + 4) === "type" && /\s/.test(code[i + 4] ?? "")) {
    isTypeOnly = true;
    i += 4;
    skipWs();
  }
  if (code[i] === "{") {
    const closeIdx = findMatchingBrace(code, i);
    if (closeIdx === -1) return null;
    const inner = code.slice(i + 1, closeIdx);
    parseNamedBindings(inner, namedBindings);
    i = closeIdx + 1;
    sawClause = true;
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
      sawClause = true;
    } else {
      return null;
    }
  } else {
    const id = consumeIdentifier(code, i);
    if (!id) return null;
    defaultName = id.name;
    i = id.end;
    sawClause = true;
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
  if (!sawClause) return null;
  skipWs();
  if (code.slice(i, i + 4) !== "from" || !/\s|["']/.test(code[i + 4] ?? "")) {
    return null;
  }
  i += 4;
  skipWs();
  if (code[i] !== '"' && code[i] !== "'") return null;
  const quoteEnd = consumeStringLiteral(code, i);
  if (quoteEnd === -1) return null;
  let end = quoteEnd;
  if (code[end] === ";") end++;
  return {
    text: code.slice(start, end),
    start,
    end,
    isTypeOnly,
    isSideEffect: false,
    defaultName,
    namedBindings,
    namespaceName
  };
}
function consumeStringLiteral(code, start) {
  const quote = code[start];
  if (quote !== '"' && quote !== "'") return -1;
  let i = start + 1;
  let prev = "";
  while (i < code.length) {
    const ch = code[i];
    if (ch === quote && prev !== "\\") return i + 1;
    if (ch === "\n" && prev !== "\\") return -1;
    prev = ch === "\\" && prev === "\\" ? "" : ch;
    i++;
  }
  return -1;
}
function findMatchingBrace(code, start) {
  if (code[start] !== "{") return -1;
  let depth = 1;
  let i = start + 1;
  let inStr = null;
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
function consumeIdentifier(code, start) {
  if (!/[A-Za-z_$]/.test(code[start] ?? "")) return null;
  let i = start + 1;
  while (i < code.length && /[A-Za-z0-9_$]/.test(code[i])) i++;
  return { name: code.slice(start, i), end: i };
}
function parseNamedBindings(inner, out) {
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
  const pattern = /(?:export\s+)?(?:const|let|var)\s+(\w+)(?:\s*:\s*[^=]+)?\s*=\s*createServerFn\b/g;
  const matches = [];
  let m;
  while ((m = pattern.exec(code)) !== null) {
    const name = m[1];
    const declStart = m.index;
    let i = m.index + m[0].length;
    while (i < code.length && /\s/.test(code[i])) i++;
    if (code[i] === "<") {
      let gDepth = 1;
      i++;
      let inStr2 = null;
      while (i < code.length && gDepth > 0) {
        const ch = code[i];
        if (inStr2) {
          if (ch === inStr2 && code[i - 1] !== "\\") inStr2 = null;
        } else if (ch === '"' || ch === "'" || ch === "`") {
          inStr2 = ch;
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

// src/transform/client.ts
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
  const handlerPattern = /(?:async\s+)?\bhandler\s*(?::|\()/g;
  let m;
  while ((m = handlerPattern.exec(objectStr)) !== null) {
    let removeStart = m.index;
    let removeEnd;
    const matched = m[0];
    if (matched.endsWith(":")) {
      const valueStart = m.index + matched.length;
      removeEnd = findValueEnd(objectStr, valueStart);
    } else {
      const parenOpen = m.index + matched.length - 1;
      let depth = 1;
      let i = parenOpen + 1;
      let inStr = null;
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
  const importInfos = scanImports(code);
  if (importInfos.length === 0) return code;
  let nonImportCode = "";
  let cursor = 0;
  for (const info of importInfos) {
    nonImportCode += code.slice(cursor, info.start);
    cursor = info.end;
  }
  nonImportCode += code.slice(cursor);
  const keep = importInfos.map((info) => {
    if (info.isTypeOnly) return true;
    if (info.isSideEffect) return true;
    const candidates = [];
    if (info.defaultName) candidates.push(info.defaultName);
    if (info.namespaceName) candidates.push(info.namespaceName);
    for (const n of info.namedBindings) candidates.push(n);
    if (candidates.length === 0) return true;
    return candidates.some(
      (name) => new RegExp(`\\b${escapeRegex(name)}\\b`).test(nonImportCode)
    );
  });
  let out = "";
  cursor = 0;
  for (let idx = 0; idx < importInfos.length; idx++) {
    const info = importInfos[idx];
    out += code.slice(cursor, info.start);
    if (keep[idx]) {
      out += info.text;
    } else {
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
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// src/transform/server.ts
function extractForServer(code) {
  if (!code.includes("createServerFn")) return null;
  const matches = findCreateServerFnCalls(code);
  if (matches.length === 0) return null;
  const imports = scanImports(code).map((info) => info.text);
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

// src/scanner.ts
import { resolve } from "path";
import { readdirSync, readFileSync } from "fs";
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
          `vite-plugin-gasforge: duplicate server function "${name}" in:
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

// src/plugin/client.ts
import { createRequire } from "module";

// package.json
var package_default = {
  name: "@edsallrd/vite-plugin-gasforge",
  version: "0.3.0",
  description: "A Vite plugin for building Google Apps Script projects with type-safe server functions.",
  author: "Edsall Park <https://github.com/EdsallRd>",
  repository: {
    type: "git",
    url: "https://github.com/EdsallRd/vite-plugin-gasforge.git"
  },
  homepage: "https://github.com/EdsallRd/vite-plugin-gasforge",
  license: "MIT",
  type: "module",
  exports: {
    ".": {
      import: "./dist/index.js",
      types: "./dist/index.d.ts"
    }
  },
  files: [
    "dist",
    "google.script.d.ts",
    "virtual.d.ts"
  ],
  peerDependencies: {
    "@standard-schema/spec": "^1.0.0",
    vite: ">=5.0.0",
    "vite-plugin-singlefile": ">=2.0.0"
  },
  devDependencies: {
    "@standard-schema/spec": "^1.1.0",
    "@types/acorn": "^4.0.6",
    "@types/node": "^26.1.0",
    tsup: "^8.5.1",
    typescript: "^6.0.3",
    vite: "^8.1.3",
    "vite-plugin-singlefile": "^2.3.0",
    vitest: "^4.1.9"
  },
  scripts: {
    build: "tsup",
    dev: "tsup --watch",
    test: "vitest run"
  },
  dependencies: {
    acorn: "^8.17.0",
    "magic-string": "^0.30.21",
    superjson: "^2.2.6"
  }
};

// src/plugin/constants.ts
var VIRTUAL_SERVER_FNS = "virtual:gas/server-fns";
var PKG_NAME = package_default.name;

// src/plugin/runtime-path.ts
import { fileURLToPath } from "url";
import { dirname, resolve as resolve2 } from "path";
import { existsSync } from "fs";
function getRuntimePath() {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const distPath = resolve2(currentDir, "./runtime.js");
  if (existsSync(distPath)) {
    return distPath;
  }
  const srcPath = resolve2(currentDir, "../runtime.ts");
  if (existsSync(srcPath)) {
    return srcPath;
  }
  return distPath;
}

// src/plugin/client.ts
var require2 = createRequire(import.meta.url);
function gasClientPlugin() {
  return {
    name: "vite-plugin-gasforge:client",
    enforce: "pre",
    resolveId(source) {
      if (source === PKG_NAME) {
        return getRuntimePath();
      }
      if (source === "superjson") {
        return require2.resolve("superjson");
      }
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

// src/plugin/index.ts
var require3 = createRequire2(import.meta.url);
function gas(options = {}) {
  const serverEntry = options.server ?? "src/server/index.ts";
  const clientEntry = options.client?.entry ?? "src/client/index.html";
  const clientPlugins = options.client?.plugins ?? [];
  const clientRollupOptions = options.client?.rollupOptions ?? {};
  let resolvedConfig;
  let root;
  let registry = [];
  return {
    name: PKG_NAME,
    enforce: "pre",
    configResolved(config) {
      resolvedConfig = config;
      root = config.root;
      registry = buildRegistry(resolve3(root, "src"));
      if (registry.length > 0) {
        console.log(
          `vite-plugin-gasforge: ${registry.length} server function(s) \u2014 ${registry.map((f) => f.name).join(", ")}`
        );
      }
    },
    // Server build configuration (IIFE for GAS)
    config() {
      return {
        define: {
          "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV || "production")
        },
        build: {
          target: "es2020",
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
      if (source === PKG_NAME) {
        return getRuntimePath();
      }
      if (source.endsWith("?gas-server")) return source;
      return null;
    },
    // Load virtual modules for the server build
    load(id) {
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
        const code = readFileSync2(realPath, "utf-8");
        const extracted = extractForServer(code);
        return extracted ?? "";
      }
      return null;
    },
    watchChange(id) {
      if (/\.(ts|tsx)$/.test(id) && !id.endsWith(".gen.ts")) {
        const code = readFileSync2(id, "utf-8");
        if (code.includes("createServerFn")) {
          console.log(
            "vite-plugin-gasforge: server function changed, re-scanning..."
          );
          registry = buildRegistry(resolve3(root, "src"));
        }
      }
    },
    // Client build
    async closeBundle() {
      console.log("vite-plugin-gasforge: building client bundle...");
      const clientDir = resolve3(root, dirname2(clientEntry));
      const distDir = resolvedConfig.build.outDir ? resolve3(root, resolvedConfig.build.outDir) : resolve3(root, "dist");
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
            ...clientRollupOptions,
            output: { format: "esm" },
            input: resolve3(root, clientEntry)
          }
        },
        resolve: {
          alias: { "@": clientDir }
        },
        define: resolvedConfig.define
      });
      const buildOutput = await build(clientConfig);
      const outputs = buildOutput.output;
      const html = outputs.find(
        (o) => o.type === "asset" && o.fileName.endsWith(".html")
      );
      if (html?.source) {
        await writeFile(resolve3(distDir, "Client.html"), html.source, "utf-8");
      } else {
        throw new Error(
          "vite-plugin-gasforge: no HTML asset found in client build output"
        );
      }
    }
  };
}

// src/runtime.ts
import superjson from "superjson";

// src/errors.ts
var GASForgeError = class extends Error {
  code;
  issues;
  constructor(code, message, issues) {
    super(message);
    this.name = "GASForgeError";
    this.code = code;
    this.issues = issues;
  }
};

// src/middleware.ts
function createMiddleware() {
  return {
    handler(fn) {
      return { handler: fn };
    }
  };
}

// src/runtime.ts
async function __validate(schema, value, errorCode) {
  if (!schema || !schema["~standard"]) return value;
  const result = await schema["~standard"].validate(value);
  if ("issues" in result && result.issues) {
    const err = new GASForgeError(
      errorCode,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      "Validation failed: " + result.issues.map((i) => i.message).join(", "),
      result.issues
    );
    throw err;
  }
  return result.value;
}
function createServerFn(def) {
  const fn = async (...args) => {
    if (typeof google !== "undefined" && google?.script?.run && !def.handler) {
      const input = args[0];
      const validated = await __validate(
        def.input,
        input,
        "INPUT_VALIDATION_FAILED"
      );
      const serializedInput = superjson.stringify(validated ?? null);
      return new Promise((resolve4, reject) => {
        google.script.run.withSuccessHandler(async (raw) => {
          try {
            const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
            if (parsed && typeof parsed === "object" && parsed.__gas_error) {
              const err = new GASForgeError(
                parsed.code || "SERVER_ERROR",
                parsed.message || "Server Error"
              );
              err.stack = parsed.stack;
              reject(err);
              return;
            }
            const deserialized = superjson.deserialize(parsed);
            resolve4(
              await __validate(
                def.output,
                deserialized,
                "OUTPUT_VALIDATION_FAILED"
              )
            );
          } catch (err) {
            reject(err);
          }
        }).withFailureHandler((err) => {
          const rpcErr = new GASForgeError(
            "RPC_ERROR",
            err?.message || String(err)
          );
          reject(rpcErr);
        })[def.__name](serializedInput);
      });
    }
    try {
      const rawInput = args[0];
      let input;
      if (typeof rawInput === "string") {
        input = superjson.parse(rawInput);
      } else if (rawInput && typeof rawInput === "object" && ("json" in rawInput || "meta" in rawInput)) {
        input = superjson.deserialize(rawInput);
      } else {
        input = rawInput;
      }
      const validatedInput = await __validate(
        def.input,
        input,
        "INPUT_VALIDATION_FAILED"
      );
      let ctx = {};
      if (def.middleware) {
        for (const mw of def.middleware) {
          const nextCtx = await mw.handler(ctx);
          ctx = { ...ctx, ...nextCtx };
        }
      }
      const result = await def.handler(
        validatedInput,
        ctx
      );
      const validatedOutput = await __validate(
        def.output,
        result,
        "OUTPUT_VALIDATION_FAILED"
      );
      return JSON.stringify(superjson.serialize(validatedOutput ?? null));
    } catch (err) {
      const errorObj = {
        __gas_error: true,
        code: err?.code || "SERVER_ERROR",
        message: err?.message || String(err),
        stack: err?.stack
      };
      return JSON.stringify(errorObj);
    }
  };
  const name = def.__name || "serverFn";
  fn.queryKey = (input) => [name, input];
  fn.queryOptions = (input) => ({
    queryKey: [name, input],
    queryFn: () => fn(input)
  });
  return fn;
}

// src/index.ts
var src_default = gas;
export {
  GASForgeError,
  createMiddleware,
  createServerFn,
  src_default as default
};
