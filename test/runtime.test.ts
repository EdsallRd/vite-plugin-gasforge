import { describe, it, expect } from "vitest";
import superjson from "superjson";
import { createServerFn, createMiddleware, GASForgeError } from "../src";

describe("Runtime execution, middleware, and query extensions", () => {
  it("should execute middleware chain and pass merged context to handler", async () => {
    const authMw = createMiddleware().handler(async () => {
      return { userId: "user-123" };
    });

    const roleMw = createMiddleware().handler(async (ctx) => {
      expect(ctx.userId).toBe("user-123");
      return { role: "admin" };
    });

    const getUserInfo = createServerFn({
      middleware: [authMw, roleMw],
      input: {} as any,
      output: {} as any,
      handler: async (input, ctx) => {
        expect(ctx.userId).toBe("user-123");
        expect(ctx.role).toBe("admin");
        return { success: true, user: ctx.userId };
      },
    });

    const rawRes = await getUserInfo(undefined);
    const parsed = typeof rawRes === "string" ? JSON.parse(rawRes) : rawRes;
    const res = superjson.deserialize(parsed);
    expect(res).toEqual({ success: true, user: "user-123" });
  });

  it("should generate TanStack queryOptions and queryKey", () => {
    const getGreeting = createServerFn({
      __name: "getGreeting",
      input: {} as any,
      output: {} as any,
      handler: async (name: string) => `Hello, ${name}`,
    });

    expect(getGreeting.queryKey("Alice")).toEqual(["getGreeting", "Alice"]);
    const options = getGreeting.queryOptions("Alice");
    expect(options.queryKey).toEqual(["getGreeting", "Alice"]);
    expect(typeof options.queryFn).toBe("function");
  });

  it("should instantiate GASForgeError properly", () => {
    const err = new GASForgeError("UNAUTHORIZED" as any, "Not allowed");
    expect(err instanceof Error).toBe(true);
    expect(err.name).toBe("GASForgeError");
    expect(err.code).toBe("UNAUTHORIZED");
  });

  it("should handle void (undefined) schema inputs and outputs without coercing to null", async () => {
    const voidSchema = {
      "~standard": {
        version: 1 as const,
        vendor: "test",
        validate: (val: unknown) => {
          if (val !== undefined) {
            return {
              issues: [
                {
                  message: `expected void, received ${val === null ? "null" : typeof val}`,
                },
              ],
            };
          }
          return { value: undefined };
        },
      },
    };

    const getVoid = createServerFn({
      input: voidSchema as any,
      output: voidSchema as any,
      handler: async () => {
        return undefined;
      },
    });

    const rawRes = await getVoid(undefined);
    expect(typeof rawRes).toBe("string");
    const parsed = JSON.parse(rawRes);
    expect(parsed.__gas_error).toBeUndefined();
    const res = superjson.deserialize(parsed);
    expect(res).toBeUndefined();
  });

  it("should execute .local bypassed call directly on the server without serialization", async () => {
    const authMw = createMiddleware().handler(async () => {
      return { userId: "user-123" };
    });

    const doubleFn = createServerFn({
      middleware: [authMw],
      input: {
        "~standard": {
          version: 1,
          vendor: "test",
          validate: (val: any) => ({ value: val }),
        },
      } as any,
      output: {
        "~standard": {
          version: 1,
          vendor: "test",
          validate: (val: any) => ({ value: val }),
        },
      } as any,
      handler: async (num: number, ctx) => {
        expect(ctx.userId).toBe("user-123");
        return num * 2;
      },
    });

    const res = await doubleFn.local(21);
    expect(res).toBe(42);
  });

  it("should throw GASForgeError when target function is missing on google.script.run", async () => {
    const defObj: any = {
      __name: "missingFunction",
      input: {} as any,
      output: {} as any,
      handler: async () => "result",
    };
    const testFn = createServerFn(defObj);

    // Simulate client-side transform by deleting handler from definition object
    delete defObj.handler;

    // Mock google global environment
    const originalGoogle = (globalThis as any).google;
    (globalThis as any).google = {
      script: {
        run: {
          withSuccessHandler() {
            return this;
          },
          withFailureHandler() {
            return this;
          },
        },
      },
    };

    try {
      await expect(testFn(undefined)).rejects.toThrowError(
        'Server function "missingFunction" is not exported or defined on the Apps Script server.',
      );
    } finally {
      // Restore
      (globalThis as any).google = originalGoogle;
    }
  });
});

