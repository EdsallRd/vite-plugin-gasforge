import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    runtime: "src/runtime.ts",
  },
  format: "esm",
  dts: true,
  clean: true,
  external: ["vite", "vite-plugin-singlefile", "@standard-schema/spec"],
});
