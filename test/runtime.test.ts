import { describe, it, expect } from "vitest";
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

    const res = await getUserInfo(undefined);
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
});
