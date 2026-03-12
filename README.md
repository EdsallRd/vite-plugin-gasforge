# vite-plugin-gasforge

A Vite plugin for building Google Apps Script projects with type-safe server functions. Write your server and client code in TypeScript, define RPC functions with [Standard Schema](https://github.com/standard-schema/standard-schema) validation, and let the plugin handle the rest.

## How it works

GASForge splits your project into two build outputs:

- **Server.js** — An IIFE bundle for the Google Apps Script runtime. Server functions are extracted and exposed as top-level GAS functions.
- **Client.html** — A single-file HTML bundle (via [vite-plugin-singlefile](https://github.com/nickreese/vite-plugin-singlefile)) served by HtmlService. Client calls to server functions are automatically transformed into `google.script.run` RPC calls.

## Installation

```bash
npm install vite-plugin-gasforge vite vite-plugin-singlefile @standard-schema/spec
```

## Setup

### vite.config.ts

```ts
import { defineConfig } from "vite";
import gas from "vite-plugin-gasforge";

export default defineConfig({
  plugins: [gas()],
});
```

### Project structure

```
src/
  server/
    index.ts       # Server entry point
  client/
    index.html     # Client entry point
```

These paths are configurable via the plugin options:

```ts
gas({
  server: "src/server/index.ts",
  client: {
    entry: "src/client/index.html",
    plugins: [react()], // Additional Vite plugins for the client build
    rolldownOptions: {}, // Custom Rolldown options for the client build
  },
});
```

### tsconfig.json

Add the type declarations to get `google.script` types and virtual module support:

```json
{
  "compilerOptions": {
    "types": ["vite-plugin-gasforge/google.script"]
  }
}
```

## Defining server functions

Use `createServerFn` to define type-safe functions that are callable from both server and client code. Any [Standard Schema](https://github.com/standard-schema/standard-schema)-compatible library (Zod, Valibot, ArkType, etc.) can be used for validation.

```ts
import { createServerFn } from "vite-plugin-gasforge";
import { z } from "zod";

export const getGreeting = createServerFn({
  input: z.string(),
  output: z.string(),
  handler: (name) => `Hello, ${name}!`,
});
```

### What happens at build time

- **Server build**: The function is kept as-is and exported as a top-level GAS function.
- **Client build**: The `handler` is stripped out and replaced with a `google.script.run` call. Input and output are validated against the schemas on the client side.

### Calling server functions

Server functions are fully typed and can be called directly:

```ts
const greeting = await getGreeting("World");
// => "Hello, World!"
```

On the client, this transparently calls `google.script.run.getGreeting(...)` under the hood.

## Server entry point

Your server entry should re-export the virtual module `virtual:gas/server-fns`, which automatically collects all discovered `createServerFn` definitions:

```ts
// src/server/index.ts
export * from "virtual:gas/server-fns";

// Add any other top-level GAS functions here
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("My App")
    .addItem("Open", "showSidebar")
    .addToUi();
}

function showSidebar() {
  const html = HtmlService.createHtmlOutputFromFile("Client");
  SpreadsheetApp.getUi().showSidebar(html);
}
```

## Build

```bash
npx vite build
```

This produces:

```
dist/
  Server.js    # Deploy to Google Apps Script
  Client.html  # Deploy to Google Apps Script
```

## Plugin options

| Option                   | Type             | Default                   | Description                                  |
| ------------------------ | ---------------- | ------------------------- | -------------------------------------------- |
| `server`                 | `string`         | `"src/server/index.ts"`   | Server entry file path                       |
| `client.entry`           | `string`         | `"src/client/index.html"` | Client entry file path                       |
| `client.plugins`         | `PluginOption[]` | `[]`                      | Additional Vite plugins for the client build |
| `client.rolldownOptions` | `object`         | `{}`                      | Rolldown options for the client build        |
