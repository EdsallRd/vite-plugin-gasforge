import { describe, it, expect } from "vitest";
import { transformForClient } from "../src/transform/client";
import { extractForServer, getServerFnNames } from "../src/transform/server";

describe("Code Transformation", () => {
  it("should transform createServerFn with standard property handler for client", () => {
    const code = `
import { createServerFn } from "@edsallrd/vite-plugin-gasforge";
import { z } from "zod";

export const getGreeting = createServerFn({
  input: z.string(),
  output: z.string(),
  handler: async (name) => {
    return \`Hello, \${name}!\`;
  },
});
    `;

    const clientCode = transformForClient(code);
    expect(clientCode).toBeDefined();
    expect(clientCode).toContain('__name: "getGreeting"');
    expect(clientCode).not.toContain("handler:");
    expect(clientCode).not.toContain("Hello,");
  });

  it("should transform createServerFn with method shorthand handler for client", () => {
    const code = `
import { createServerFn } from "@edsallrd/vite-plugin-gasforge";
import { z } from "zod";

export const getGreeting = createServerFn({
  input: z.string(),
  output: z.string(),
  async handler(name) {
    return \`Hello, \${name}!\`;
  },
});
    `;

    const clientCode = transformForClient(code);
    expect(clientCode).toBeDefined();
    expect(clientCode).toContain('__name: "getGreeting"');
    expect(clientCode).not.toContain("async handler(");
  });

  it("should support TypeScript generics in createServerFn calls", () => {
    const code = `
export const getGreeting = createServerFn<z.ZodString, z.ZodString>({
  input: z.string(),
  output: z.string(),
  handler: (n) => n,
});
    `;

    const names = getServerFnNames(code);
    expect(names).toEqual(["getGreeting"]);

    const clientCode = transformForClient(code);
    expect(clientCode).toContain('__name: "getGreeting"');
  });

  it("should extract only server functions for server build", () => {
    const code = `
import { createServerFn } from "@edsallrd/vite-plugin-gasforge";
import React from "react";

function MyUIComponent() {
  return <div />;
}

export const myServerFn = createServerFn({
  input: z.void(),
  output: z.string(),
  handler: () => "server data",
});
    `;

    const serverCode = extractForServer(code);
    expect(serverCode).toBeDefined();
    expect(serverCode).toContain("myServerFn");
    expect(serverCode).not.toContain("MyUIComponent");
  });
});
