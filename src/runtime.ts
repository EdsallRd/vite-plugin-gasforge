import superjson from "superjson";
import { GASForgeError } from "./errors";

// Re-export core types and helpers so runtime consumers have everything
export { createMiddleware, type Middleware, type InferMiddlewareContext } from "./middleware";
export { GASForgeError, type GASForgeErrorCode } from "./errors";
export type { ServerFnQueryExtensions } from "./query";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function __validate(schema: any, value: any, errorCode: string): Promise<any> {
  if (!schema || !schema["~standard"]) return value;
  const result = await schema["~standard"].validate(value);
  if ("issues" in result && result.issues) {
    const err = new GASForgeError(
      errorCode as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      "Validation failed: " + result.issues.map((i: any) => i.message).join(", "),
      result.issues,
    );
    throw err;
  }
  return result.value;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createServerFn(def: any): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fn = async (...args: any[]) => {
    // 1. Check if we are running in the browser client environment
    // Notice: on the client, def.handler was stripped by transformForClient
    if (typeof google !== "undefined" && google?.script?.run && !def.handler) {
      const input = args[0];
      const validated = await __validate(
        def.input,
        input,
        "INPUT_VALIDATION_FAILED",
      );
      const serializedInput = superjson.stringify(validated ?? null);

      return new Promise((resolve, reject) => {
        google.script.run
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .withSuccessHandler(async (raw: any) => {
            try {
              const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
              if (parsed && typeof parsed === "object" && parsed.__gas_error) {
                const err = new GASForgeError(
                  parsed.code || "SERVER_ERROR",
                  parsed.message || "Server Error",
                );
                err.stack = parsed.stack;
                reject(err);
                return;
              }
              const deserialized = superjson.deserialize(parsed);
              resolve(
                await __validate(
                  def.output,
                  deserialized,
                  "OUTPUT_VALIDATION_FAILED",
                ),
              );
            } catch (err) {
              reject(err);
            }
          })
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .withFailureHandler((err: any) => {
            const rpcErr = new GASForgeError(
              "RPC_ERROR",
              err?.message || String(err),
            );
            reject(rpcErr);
          })
          [def.__name](serializedInput);
      });
    }

    // 2. Otherwise, we are running on the server (GAS V8 engine or local execution)
    try {
      const rawInput = args[0];
      let input: unknown;
      if (typeof rawInput === "string") {
        input = superjson.parse(rawInput);
      } else if (
        rawInput &&
        typeof rawInput === "object" &&
        ("json" in rawInput || "meta" in rawInput)
      ) {
        input = superjson.deserialize(rawInput as any);
      } else {
        input = rawInput;
      }

      const validatedInput = await __validate(
        def.input,
        input,
        "INPUT_VALIDATION_FAILED",
      );

      let ctx: Record<string, unknown> = {};
      if (def.middleware) {
        for (const mw of def.middleware) {
          const nextCtx = await mw.handler(ctx);
          ctx = { ...ctx, ...nextCtx };
        }
      }

      const result = await def.handler(validatedInput, ctx);
      const validatedOutput = await __validate(
        def.output,
        result,
        "OUTPUT_VALIDATION_FAILED",
      );
      return JSON.stringify(superjson.serialize(validatedOutput ?? null));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      const errorObj = {
        __gas_error: true,
        code: err?.code || "SERVER_ERROR",
        message: err?.message || String(err),
        stack: err?.stack,
      };
      return JSON.stringify(errorObj);
    }
  };

  const name = def.__name || "serverFn";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fn.queryKey = (input: any) => [name, input];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fn.queryOptions = (input: any) => ({
    queryKey: [name, input],
    queryFn: () => fn(input),
  });

  return fn;
}
