import { resolve, dirname } from "path";
import { readdirSync, readFileSync } from "fs";
import { writeFile } from "fs/promises";
import {
  build,
  defineConfig,
  type Plugin,
  type ResolvedConfig,
  type PluginOption,
  type BuildOptions,
} from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import {
  transformForClient,
  extractForServer,
  getServerFnNames,
} from "./transform";

// ── createServerFn ──────────────────────────────────────────────────────────

/**
 * A callable server function with typed input/output.
 * On the client (after build transform), calls google.script.run.
 * On the server, calls the handler directly.
 */
export type ServerFn<
  TInput extends StandardSchemaV1,
  TOutput extends StandardSchemaV1,
> = (
  ...args: StandardSchemaV1.InferInput<TInput> extends void
    ? []
    : [input: StandardSchemaV1.InferInput<TInput>]
) => Promise<StandardSchemaV1.InferOutput<TOutput>>;

/**
 * Define a server function that can be called from client code.
 *
 * At build time, the plugin transforms this:
 * - **Client build**: handler is stripped, replaced with a google.script.run RPC call
 * - **Server build**: handler is kept, function is exported for GAS
 *
 * @example
 * ```ts
 * import { createServerFn } from "vite-plugin-gasforge";
 * import { z } from "zod";
 *
 * const getGreeting = createServerFn({
 *   input: z.void(),
 *   output: z.string(),
 *   handler: () => "Hello, world!",
 * });
 *
 * // Call it directly — fully typed
 * const msg = await getGreeting();
 * ```
 */
export function createServerFn<
  TInput extends StandardSchemaV1,
  TOutput extends StandardSchemaV1,
>(def: {
  input: TInput;
  output: TOutput;
  handler: (
    input: StandardSchemaV1.InferOutput<TInput>,
  ) => StandardSchemaV1.InferInput<TOutput>;
}): ServerFn<TInput, TOutput> {
  // Server runtime: return a callable that invokes the handler directly.
  // On the client, this code is replaced by the build transform.
  const fn = async (...args: unknown[]) =>
    def.handler(args[0] as StandardSchemaV1.InferOutput<TInput>);
  return fn as ServerFn<TInput, TOutput>;
}

// ── Client runtime (served as virtual module) ───────────────────────────────

const CLIENT_RUNTIME = `
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
        .withSuccessHandler(async (raw) => {
          try {
            const result = typeof raw === "string" ? JSON.parse(raw) : raw;
            resolve(await __validate(def.output, result));
          }
          catch (err) { reject(err); }
        })
        .withFailureHandler(reject)
        [def.__name](JSON.stringify(validated ?? null));
    });
  };
}
`;

// ── Scanner ─────────────────────────────────────────────────────────────────

interface FnEntry {
  name: string;
  filePath: string;
}

function scanAllFiles(dir: string): string[] {
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

function buildRegistry(srcDir: string): FnEntry[] {
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

// ── Plugin ──────────────────────────────────────────────────────────────────

export interface GASPluginOptions {
  server?: string;
  client?: {
    entry?: string;
    plugins?: PluginOption[];
    rollupOptions?: BuildOptions["rollupOptions"];
  };
}

const VIRTUAL_SERVER_FNS = "virtual:gas/server-fns";
const VIRTUAL_SERVER_RUNTIME = "virtual:gas/server-runtime";
const VIRTUAL_CLIENT_RUNTIME = "virtual:gas/client-runtime";

const SERVER_RUNTIME = `
export function createServerFn(def) {
  return async (...args) => {
    const input = typeof args[0] === "string" ? JSON.parse(args[0]) : args[0];
    const result = await def.handler(input);
    return JSON.stringify(result ?? null);
  };
}
`;

export default function gas(options: GASPluginOptions = {}): Plugin {
  const serverEntry = options.server ?? "src/server/index.ts";
  const clientEntry = options.client?.entry ?? "src/client/index.html";
  const clientPlugins = options.client?.plugins ?? [];
  const clientRollupOptions = options.client?.rollupOptions ?? {};

  let resolvedConfig: ResolvedConfig;
  let root: string;
  let registry: FnEntry[] = [];

  return {
    name: "vite-plugin-gasforge",
    enforce: "pre",

    configResolved(config) {
      resolvedConfig = config;
      root = config.root;

      // Scan for all createServerFn calls
      registry = buildRegistry(resolve(root, "src"));

      if (registry.length > 0) {
        console.log(
          `vite-plugin-gasforge: ${registry.length} server function(s) — ${registry.map((f) => f.name).join(", ")}`,
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
            formats: ["iife" as const],
            name: "globalThis",
          },
          rollupOptions: {
            output: {
              entryFileNames: "Server.js",
              extend: true,
              footer: (chunk: { exports: string[] }) => {
                return chunk.exports
                  .map((fn) => `function ${fn}() {};`)
                  .join("\n");
              },
            },
          },
        },
      };
    },

    // Resolve virtual modules for the server build
    resolveId(source) {
      if (source === VIRTUAL_SERVER_FNS) return "\0" + VIRTUAL_SERVER_FNS;
      if (source === VIRTUAL_SERVER_RUNTIME)
        return "\0" + VIRTUAL_SERVER_RUNTIME;
      // Redirect plugin imports in source files to lightweight server runtime
      if (source === "vite-plugin-gasforge")
        return "\0" + VIRTUAL_SERVER_RUNTIME;
      // ?gas-server modules: no \0 prefix so TS/JSX transforms still run
      if (source.endsWith("?gas-server")) return source;
      return null;
    },

    // Load virtual modules for the server build
    load(id) {
      // Lightweight server runtime (no Node APIs)
      if (id === "\0" + VIRTUAL_SERVER_RUNTIME) return SERVER_RUNTIME;

      // Virtual server functions entry — re-exports all discovered functions
      if (id === "\0" + VIRTUAL_SERVER_FNS) {
        if (registry.length === 0) return "export {};";

        // Group by file
        const byFile = new Map<string, string[]>();
        for (const { name, filePath } of registry) {
          const names = byFile.get(filePath) ?? [];
          names.push(name);
          byFile.set(filePath, names);
        }

        const lines: string[] = [];
        for (const [filePath, names] of byFile) {
          const normalizedPath = filePath.replace(/\\/g, "/");
          lines.push(
            `export { ${names.join(", ")} } from "${normalizedPath}?gas-server";`,
          );
        }
        return lines.join("\n");
      }

      // Server extraction — load only createServerFn parts from a source file
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
            "vite-plugin-gasforge: server function changed, re-scanning...",
          );
          registry = buildRegistry(resolve(root, "src"));
        }
      }
    },

    // Client build
    async closeBundle() {
      console.log("vite-plugin-gasforge: building client bundle...");

      const clientDir = resolve(root, dirname(clientEntry));
      const distDir = resolvedConfig.build.outDir
        ? resolve(root, resolvedConfig.build.outDir)
        : resolve(root, "dist");

      const clientConfig = defineConfig({
        plugins: [
          gasClientPlugin(),
          ...clientPlugins,
          viteSingleFile({ useRecommendedBuildConfig: true }),
        ],
        root: clientDir,
        build: {
          minify: resolvedConfig.define?.PRODUCTION ?? false,
          outDir: distDir,
          write: false,
          rollupOptions: {
            ...clientRollupOptions,
            output: { format: "esm" },
            input: resolve(root, clientEntry),
          },
        },
        resolve: {
          alias: { "@": clientDir },
        },
        define: resolvedConfig.define,
      });

      const buildOutput = await build(clientConfig);
      // Find the HTML asset in the build output
      // @ts-expect-error - output is an array of RollupOutput
      const outputs = buildOutput.output as Array<{
        type: string;
        fileName: string;
        source?: string;
        code?: string;
      }>;
      const html = outputs.find(
        (o) => o.type === "asset" && o.fileName.endsWith(".html"),
      );
      if (html?.source) {
        await writeFile(resolve(distDir, "Client.html"), html.source, "utf-8");
      } else {
        throw new Error(
          "vite-plugin-gasforge: no HTML asset found in client build output",
        );
      }
    },
  };
}

// ── Client build plugin ─────────────────────────────────────────────────────

function gasClientPlugin(): Plugin {
  return {
    name: "vite-plugin-gasforge:client",
    enforce: "pre",

    resolveId(source) {
      if (source === "vite-plugin-gasforge") return VIRTUAL_CLIENT_RUNTIME;
      if (source === VIRTUAL_CLIENT_RUNTIME) return VIRTUAL_CLIENT_RUNTIME;
      return null;
    },

    load(id) {
      if (id === VIRTUAL_CLIENT_RUNTIME) return CLIENT_RUNTIME;
      return null;
    },

    // Transform source files: strip handler, inject __name
    transform(code, id) {
      // Strip query strings (e.g. ?tsr-split from TanStack Router code splitting)
      const cleanId = id.split("?")[0];
      if (!/\.(ts|tsx|js|jsx)$/.test(cleanId)) return null;
      return transformForClient(code);
    },
  };
}
