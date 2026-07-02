import type { Plugin } from "vite";
import { transformForClient } from "../transform";
import { VIRTUAL_CLIENT_RUNTIME } from "./constants";
import { CLIENT_RUNTIME } from "./runtimes";

export function gasClientPlugin(): Plugin {
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
