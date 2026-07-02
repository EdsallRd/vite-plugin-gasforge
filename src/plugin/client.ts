import type { Plugin } from "vite";
import { createRequire } from "module";
import { transformForClient } from "../transform";
import { PKG_NAME } from "./constants";
import { getRuntimePath } from "./runtime-path";

const require = createRequire(import.meta.url);

export function gasClientPlugin(): Plugin {
  return {
    name: "vite-plugin-gasforge:client",
    enforce: "pre",

    resolveId(source) {
      if (source === PKG_NAME) {
        return getRuntimePath();
      }
      if (source === "superjson") {
        return require.resolve("superjson");
      }
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
