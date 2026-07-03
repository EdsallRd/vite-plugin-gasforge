import { resolve, dirname, relative } from "path";
import { readFileSync, writeFileSync } from "fs";
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
import { extractForServer } from "../transform";
import { buildRegistry, type FnEntry } from "../scanner";
import { gasClientPlugin } from "./client";
import { getRuntimePath } from "./runtime-path";
import { VIRTUAL_SERVER_FNS, PKG_NAME } from "./constants";

export interface GASPluginOptions {
  server?: string;
  client?: {
    entry?: string;
    plugins?: PluginOption[];
    rollupOptions?: BuildOptions["rollupOptions"];
  };
}

export default function gas(options: GASPluginOptions = {}): Plugin {
  const serverEntry = options.server ?? "src/server/index.ts";
  const clientEntry = options.client?.entry ?? "src/client/index.html";
  const clientPlugins = options.client?.plugins ?? [];
  const clientRollupOptions = options.client?.rollupOptions ?? {};

  let resolvedConfig: ResolvedConfig;
  let root: string;
  let registry: FnEntry[] = [];

  return {
    name: PKG_NAME,
    enforce: "pre",

    configResolved(config) {
      resolvedConfig = config;
      root = config.root;

      // Scan for all createServerFn calls
      registry = buildRegistry(resolve(root, "src"));

      if (registry.length > 0) {
        // eslint-disable-next-line no-console
        console.log(
          `vite-plugin-gasforge: ${registry.length} server function(s) — ${registry.map((f) => f.name).join(", ")}`,
        );
      }

      writeDeclarationFile(root, registry);
    },

    // Server build configuration (IIFE for GAS)
    config() {
      return {
        define: {
          "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV ?? "production"),
        },
        build: {
          target: "es2020",
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
              banner: `if (typeof globalThis.URL === "undefined") globalThis.URL = class URL {};\nif (typeof globalThis.URLSearchParams === "undefined") globalThis.URLSearchParams = class URLSearchParams {};`,
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
      // Redirect plugin imports in source files to physical server runtime
      if (source === PKG_NAME) {
        return getRuntimePath();
      }
      // ?gas-server modules: no \0 prefix so TS/JSX transforms still run
      if (source.endsWith("?gas-server")) return source;
      return null;
    },

    // Load virtual modules for the server build
    load(id) {
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
      if (
        /\.(ts|tsx)$/.test(id) &&
        !id.endsWith(".gen.ts") &&
        !id.endsWith("gasforge-virtual.d.ts")
      ) {
        const code = readFileSync(id, "utf-8");
        if (code.includes("createServerFn")) {
          // eslint-disable-next-line no-console
          console.log(
            "vite-plugin-gasforge: server function changed, re-scanning...",
          );
          registry = buildRegistry(resolve(root, "src"));
          writeDeclarationFile(root, registry);
        }
      }
    },

    // Client build
    async closeBundle() {
      // eslint-disable-next-line no-console
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
          minify: (resolvedConfig.define?.PRODUCTION as boolean | undefined) ?? false,
          outDir: distDir,
          write: false,
          assetsInlineLimit: 100000000,
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
      const outputs = buildOutput.output as {
        type: string;
        fileName: string;
        source?: string;
        code?: string;
      }[];
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

function generateDeclarationFile(root: string, registry: FnEntry[]): string {
  if (registry.length === 0) {
    return `declare module "virtual:gas/server-fns" {
  // No server functions detected.
}
`;
  }

  const byFile = new Map<string, string[]>();
  for (const { name, filePath } of registry) {
    let relPath = relative(root, filePath);
    relPath = relPath.replace(/\.(ts|tsx|js|jsx)$/, "");
    relPath = relPath.replace(/\\/g, "/");
    if (!relPath.startsWith(".") && !relPath.startsWith("/")) {
      relPath = "./" + relPath;
    }

    const names = byFile.get(relPath) ?? [];
    names.push(name);
    byFile.set(relPath, names);
  }

  const lines: string[] = [];
  lines.push(`// This file is auto-generated by vite-plugin-gasforge.`);
  lines.push(`// Do not edit this file manually. Ensure it is included in your tsconfig.json.`);
  lines.push(``);
  lines.push(`declare module "virtual:gas/server-fns" {`);
  for (const [relPath, names] of byFile) {
    lines.push(`  export { ${names.join(", ")} } from "${relPath}";`);
  }
  lines.push(`}`);
  lines.push(``);

  return lines.join("\n");
}

function writeDeclarationFile(root: string, registry: FnEntry[]) {
  const content = generateDeclarationFile(root, registry);
  writeFileSync(resolve(root, "gasforge-virtual.d.ts"), content, "utf-8");
}
