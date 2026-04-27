# vite-plugin-gasforge

A Vite plugin for building Google Apps Script projects with type-safe RPC server functions defined via Standard Schema.

## Public surface

Default export: `gas(options?: GASPluginOptions): Plugin`

```ts
interface GASPluginOptions {
  server?: string;                          // default: "src/server/index.ts"
  client?: {
    entry?: string;                         // default: "src/client/index.html"
    plugins?: PluginOption[];               // extra Vite plugins for the client build
    rollupOptions?: BuildOptions["rollupOptions"];
  };
}
```

Named export: `createServerFn({ input, output, handler })` — defines a typed RPC. `input`/`output` are any `StandardSchemaV1` (Zod, Valibot, ArkType, etc.). The plugin transforms call-sites differently for server vs client at build time.

Virtual modules:
- `virtual:gas/server-fns` — re-exports every discovered `createServerFn` declaration. Server entry should `export * from "virtual:gas/server-fns"` so they become top-level GAS functions.
- `virtual:gas/server-runtime` — lightweight `createServerFn` impl injected into the server build (handler runs directly, JSON-stringifies result).
- `virtual:gas/client-runtime` — `createServerFn` impl injected into the client build (handler stripped, calls `google.script.run.<name>(JSON.stringify(input))`, validates input/output against the schemas).

Ambient type files shipped in `files`:
- `google.script.d.ts` — types for `google.script.run`, `google.script.host`, `url`, `history` (HTML Service client API). Add via `"types": ["vite-plugin-gasforge/google.script"]`.
- `virtual.d.ts` — declares `virtual:gas/server-fns`.

## Build pipeline

Two outputs, both written to `dist/`:
- `Server.js` — IIFE bundle attached to `globalThis`. A Rollup `footer` emits `function <name>() {}` stubs for each export so GAS picks them up as runnable top-level functions. Built by the main Vite invocation.
- `Client.html` — single-file HTML built in `closeBundle` by spawning a second Vite build with `viteSingleFile`. Source is read from the in-memory build output and written to disk.

Server function discovery: at `configResolved`, `buildRegistry` walks `src/` (skipping `node_modules`/`dist`/`*.gen.ts`) and regex-scans for `(export )?(const|let|var) <name> = createServerFn(`. Duplicates throw. `watchChange` re-scans on edits.

Server extraction: when the server build asks for a source file via `<path>?gas-server`, `extractForServer` returns just the imports, the `createServerFn` declarations, and a single `export {...}`. React/UI code in the same file is dropped so the server bundle stays lean.

Client transform: `transformForClient` strips `handler:` from each `createServerFn({...})`, injects `__name: "<varName>"`, and removes imports that are unused after handler removal (type-only and side-effect imports preserved).

## Build tooling

`tsup` (`tsup.config.ts`):
- `entry: { index: "src/index.ts" }`, `format: "esm"`, `dts: true`, `clean: true`
- externals: `vite`, `vite-plugin-singlefile`, `@standard-schema/spec`

Outputs `dist/index.js` and `dist/index.d.ts`. The `.d.ts` files for `google.script` and the virtual module live at the package root and are listed in `package.json#files`.

## Developing in Yggdrasil

From the meta-repo root:

```bash
pnpm --filter vite-plugin-gasforge dev    # tsup watch
pnpm --filter vite-plugin-gasforge build  # one-shot
```

Sibling apps depend on it via `"vite-plugin-gasforge": "workspace:*"`. The npm name stays unscoped because this package is intended for public publish.

## Notes

- `transform.ts` parses imports with a hand-rolled scanner (`scanImports`/`parseImportFrom`), but `createServerFn` call detection inside source bodies still uses regex matching — works for the supported `const NAME = createServerFn({...})` form.
