import type { StandardSchemaV1 } from "@standard-schema/spec";
import superjson from "superjson";
import { GASForgeError, type GASForgeErrorCode } from "./errors";
import type { Middleware, InferMiddlewareContext } from "./middleware";
import type { ServerFnQueryExtensions } from "./query";

// Google Apps Script V8 runtime does not define URL or URLSearchParams globals.
// SuperJSON checks `payload instanceof URL`, which throws ReferenceError if URL is undefined.
if (typeof globalThis.URL === "undefined") {
  // @ts-expect-error GAS runtime polyfill
  globalThis.URL = class URL {};
}
if (typeof globalThis.URLSearchParams === "undefined") {
  // @ts-expect-error GAS runtime polyfill
  globalThis.URLSearchParams = class URLSearchParams {};
}

// Re-export core types and helpers so runtime consumers have everything
export { createMiddleware, type Middleware, type InferMiddlewareContext } from "./middleware";
export { GASForgeError, type GASForgeErrorCode } from "./errors";
export type { ServerFnQueryExtensions } from "./query";

/**
 * A callable server function with typed input/output and query helper extensions.
 */
export type ServerFn<
  TInput extends StandardSchemaV1,
  TOutput extends StandardSchemaV1,
> = ((
  ...args: StandardSchemaV1.InferInput<TInput> extends void
    ? [input?: StandardSchemaV1.InferInput<TInput>]
    : [input: StandardSchemaV1.InferInput<TInput>]
) => Promise<StandardSchemaV1.InferOutput<TOutput>>) &
  ServerFnQueryExtensions<TInput, TOutput>;

async function __validate<TSchema extends StandardSchemaV1>(
  schema: TSchema | undefined,
  value: unknown,
  errorCode: GASForgeErrorCode,
): Promise<StandardSchemaV1.InferOutput<TSchema>> {
  if (!schema?.["~standard"]) {
    return value;
  }
  const result = await schema["~standard"].validate(value);
  if ("issues" in result && result.issues) {
    const err = new GASForgeError(
      errorCode,
      "Validation failed: " + result.issues.map((i) => i.message).join(", "),
      result.issues,
    );
    throw err;
  }
  return result.value;
}

/**
 * Define a server function that can be called from client code.
 */
 
export function createServerFn<
  TInput extends StandardSchemaV1,
  TOutput extends StandardSchemaV1,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TMiddlewares extends readonly Middleware<any>[] = [],
>(def: {
  middleware?: TMiddlewares;
  input: TInput;
  output: TOutput;
  handler: (
    input: StandardSchemaV1.InferOutput<TInput>,
    ctx: InferMiddlewareContext<TMiddlewares>,
  ) =>
    | Promise<StandardSchemaV1.InferInput<TOutput>>
    | StandardSchemaV1.InferInput<TOutput>;
  __name?: string;
}): ServerFn<TInput, TOutput> {
  const fn = async (...args: unknown[]) => {
    // 1. Check if we are running in the browser client environment
    if (typeof google !== "undefined" && google?.script?.run && !def.handler) {
      const input = args[0];
      const validated = await __validate(
        def.input,
        input,
        "INPUT_VALIDATION_FAILED",
      );
      const serializedInput = superjson.stringify(validated);

      return new Promise((resolve, reject) => {
        const serverFnName = def.__name!;
        const serverFn = google.script.run[serverFnName];
        if (typeof serverFn !== "function") {
          reject(
            new GASForgeError(
              "RPC_ERROR",
              `Server function "${serverFnName}" is not exported or defined on the Apps Script server. Make sure it is exported from your server entry point.`,
            ),
          );
          return;
        }

        google.script.run
          .withSuccessHandler((raw: unknown) => {
            try {
              const parsed = (typeof raw === "string" ? JSON.parse(raw) : raw) as Record<string, unknown> | null;
              if (parsed && typeof parsed === "object" && parsed.__gas_error) {
                const err = new GASForgeError(
                  (parsed.code as GASForgeErrorCode | undefined) ?? "SERVER_ERROR",
                  (parsed.message as string | undefined) ?? "Server Error",
                );
                err.stack = parsed.stack as string | undefined;
                reject(err);
                return;
              }
              const deserialized = superjson.deserialize(parsed as unknown as Parameters<typeof superjson.deserialize>[0]);
              __validate(
                def.output,
                deserialized,
                "OUTPUT_VALIDATION_FAILED",
              ).then(resolve, reject);
            } catch (err) {
              reject(err instanceof Error ? err : new Error(String(err)));
            }
          })
          .withFailureHandler((err: Error) => {
            const rpcErr = new GASForgeError(
              "RPC_ERROR",
              err.message || String(err),
            );
            reject(rpcErr);
          })[serverFnName](serializedInput);
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
        input = superjson.deserialize(rawInput as Parameters<typeof superjson.deserialize>[0]);
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
          const nextCtx = (await mw.handler(ctx)) as Record<string, unknown>;
          ctx = { ...ctx, ...nextCtx };
        }
      }

      const result = await def.handler(
        validatedInput,
        ctx as InferMiddlewareContext<TMiddlewares>,
      );
      const validatedOutput = await __validate(
        def.output,
        result,
        "OUTPUT_VALIDATION_FAILED",
      );
      return JSON.stringify(superjson.serialize(validatedOutput));
    } catch (err) {
      const isObject = err && typeof err === "object";
      const code = (isObject && "code" in err && typeof err.code === "string") ? (err.code as GASForgeErrorCode) : "SERVER_ERROR";
      const message = (isObject && "message" in err && typeof err.message === "string") ? err.message : String(err);
      const stack = (isObject && "stack" in err && typeof err.stack === "string") ? err.stack : undefined;
      const errorObj = {
        __gas_error: true,
        code,
        message,
        stack,
      };
      return JSON.stringify(errorObj);
    }
  };

  fn.local = async (input: unknown) => {
    const validatedInput = await __validate(
      def.input,
      input,
      "INPUT_VALIDATION_FAILED",
    );

    let ctx: Record<string, unknown> = {};
    if (def.middleware) {
      for (const mw of def.middleware) {
        const nextCtx = (await mw.handler(ctx)) as Record<string, unknown>;
        ctx = { ...ctx, ...nextCtx };
      }
    }

    const result = await def.handler(
      validatedInput,
      ctx as InferMiddlewareContext<TMiddlewares>,
    );

    const validatedOutput = await __validate(
      def.output,
      result,
      "OUTPUT_VALIDATION_FAILED",
    );

    return validatedOutput;
  };

  const name = def.__name ?? "serverFn";
  fn.queryKey = (input: unknown) => [name, input] as const;
  fn.queryOptions = (input: unknown) => ({
    queryKey: [name, input] as const,
    queryFn: () => fn(input),
  });

  return fn as unknown as ServerFn<TInput, TOutput>;
}
