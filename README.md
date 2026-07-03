# vite-plugin-gasforge

A Vite plugin for building Google Apps Script (GAS) projects with type-safe, validated RPC server functions. Write your server and client code in TypeScript, define validated functions using [Standard Schema](https://github.com/standard-schema/standard-schema), and let the plugin manage compilation, serialization, context injection, and tree-shaking.

---

## Key Features

- **Type-Safe RPCs:** Call server-side GAS functions from client-side browser code with compile-time type safety.
- **Standard Schema Validation:** Validate input parameters and output values using any Standard Schema v1 compatible library (Zod, Valibot, ArkType).
- **Rich Serialization:** SuperJSON integration allows you to send JavaScript types like `Date`, `Map`, `Set`, `BigInt`, and `Uint8Array` directly over the RPC bridge.
- **Middleware and Context API:** Inject execution context (such as active users, spreadsheet instances, or auth tokens) through composable middleware chains.
- **TanStack Query Ready:** Every server function includes `.queryKey()` and `.queryOptions()` helper adapters for React Query or Vue Query compatibility.
- **Structured Errors:** Errors thrown on the server are reconstructed into typed `GASForgeError` instances on the client, maintaining error codes and stack traces.

---

## Installation

```bash
pnpm add vite-plugin-gasforge vite vite-plugin-singlefile @standard-schema/spec
# or
npm install vite-plugin-gasforge vite vite-plugin-singlefile @standard-schema/spec
```

---

## Setup

### 1. `vite.config.ts`

Add the plugin to your Vite configuration:

```ts
import { defineConfig } from "vite";
import gas from "@edsallrd/vite-plugin-gasforge";

export default defineConfig({
  plugins: [gas()],
});
```

### 2. Project Directory Structure

Organize your source code with folders for client and server entries:

```text
src/
  server/
    index.ts       # Server entry point
  client/
    index.html     # Client HTML entry point
```

Customize these paths using plugin options:

```ts
gas({
  server: "src/server/index.ts",
  client: {
    entry: "src/client/index.html",
    plugins: [], // Additional client-side plugins (e.g. react(), vue())
    rollupOptions: {}, // Custom Rollup configuration for the client bundle
  },
});
```

### 3. `tsconfig.json`

Include the type definitions to enable support for `google.script` globals and virtual modules:

```json
{
  "compilerOptions": {
    "types": ["vite-plugin-gasforge/google.script"]
  }
}
```

---

## Guide and API Reference

### Defining Server Functions

Use `createServerFn` to declare typed endpoints. In client builds, the `handler` implementation is automatically stripped out, while in server builds, the validation and handler logic are preserved.

```ts
import { createServerFn } from "@edsallrd/vite-plugin-gasforge";
import { z } from "zod";

export const getGreeting = createServerFn({
  input: z.string(),
  output: z.string(),
  handler: async (name) => {
    return `Hello, ${name}!`;
  },
});
```

Call the function directly from client-side code:

```ts
const message = await getGreeting("World");
// => "Hello, World!"
```

---

### Rich Data Serialization

By incorporating SuperJSON into the RPC bridge, you can transmit rich data structures (such as `Date`, `Map`, and `Set`) without degrading them to strings or empty objects:

```ts
import { createServerFn } from "@edsallrd/vite-plugin-gasforge";
import { z } from "zod";

export const createTodo = createServerFn({
  input: z.object({
    title: z.string(),
    tags: z.instanceof(Set),
    dueDate: z.date(),
  }),
  output: z.object({
    id: z.string(),
    createdAt: z.date(),
  }),
  handler: async (todo) => {
    return {
      id: "todo-99",
      createdAt: new Date(),
    };
  },
});
```

---

### Middleware and Context Injection

Define composable middleware to populate execution context (such as verifying spreadsheet permissions or fetching user credentials) before invoking the main handler:

```ts
import {
  createMiddleware,
  createServerFn,
} from "@edsallrd/vite-plugin-gasforge";
import { z } from "zod";

// 1. Define middleware and context outputs
const authMiddleware = createMiddleware().handler(async () => {
  const email = Session.getActiveUser().getEmail();
  if (!email) {
    throw new Error("Unauthorized access");
  }
  return { userEmail: email };
});

// 2. Attach middleware to server functions
export const getUserPreferences = createServerFn({
  middleware: [authMiddleware],
  input: z.void(),
  output: z.any(),
  handler: async (input, ctx) => {
    // ctx is fully typed and contains userEmail:
    console.log(`Access by: ${ctx.userEmail}`);
    return { theme: "dark" };
  },
});
```

---

### TanStack Query Adapters

Every server function includes `.queryKey()` and `.queryOptions()` methods to integrate with `@tanstack/react-query` or `@tanstack/vue-query`:

```ts
import { useQuery } from "@tanstack/react-query";
import { getGreeting } from "./functions";

function GreetingComponent() {
  const { data, isLoading } = useQuery(getGreeting.queryOptions("Alice"));

  if (isLoading) return <div>Loading...</div>;
  return <h1>{data}</h1>;
}
```

---

### Structured Error Handling

All thrown errors are caught and reconstructed into `GASForgeError` instances, providing type-safe code categorizations:

```ts
import { GASForgeError } from "@edsallrd/vite-plugin-gasforge";
import { getGreeting } from "./functions";

try {
  await getGreeting(123 as any); // Invalid type
} catch (err) {
  if (err instanceof GASForgeError) {
    console.error(`Error Code: ${err.code}`); // e.g. "INPUT_VALIDATION_FAILED"
    console.error(`Issues:`, err.issues); // Validation problems
  }
}
```

---

## Server Entry Point

Your Google Apps Script server-side code should export all discovered endpoints by importing the virtual compilation file:

```ts
// src/server/index.ts
export * from "virtual:gas/server-fns";

// Add global triggers or HTML sidebar logic
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Sidebar Application")
    .addItem("Open App", "showSidebar")
    .addToUi();
}

function showSidebar() {
  const html = HtmlService.createHtmlOutputFromFile("Client");
  SpreadsheetApp.getUi().showSidebar(html);
}
```

---

## Production Build

Run the compilation script:

```bash
pnpm vite build
# or
npm run build
```

This triggers the dual-build pipeline and generates the following flat bundle files:

```text
dist/
  Server.js    # Deploy directly to Google Apps Script
  Client.html  # Deploy directly to Google Apps Script
```

---

## Plugin Options

| Option                 | Type             | Default                   | Description                                   |
| ---------------------- | ---------------- | ------------------------- | --------------------------------------------- |
| `server`               | `string`         | `"src/server/index.ts"`   | File path of the server entry-point.          |
| `client.entry`         | `string`         | `"src/client/index.html"` | File path of the client HTML entry-point.     |
| `client.plugins`       | `PluginOption[]` | `[]`                      | Additional Vite plugins for the client build. |
| `client.rollupOptions` | `object`         | `{}`                      | Custom Rollup build options for the client.   |

---
