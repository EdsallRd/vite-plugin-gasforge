// src/runtime.ts
import superjson from "superjson";

// src/errors.ts
var GASForgeError = class extends Error {
  code;
  issues;
  constructor(code, message, issues) {
    super(message);
    this.name = "GASForgeError";
    this.code = code;
    this.issues = issues;
  }
};

// src/middleware.ts
function createMiddleware() {
  return {
    handler(fn) {
      return { handler: fn };
    }
  };
}

// src/runtime.ts
if (typeof globalThis.URL === "undefined") {
  globalThis.URL = class URL {
  };
}
if (typeof globalThis.URLSearchParams === "undefined") {
  globalThis.URLSearchParams = class URLSearchParams {
  };
}
async function __validate(schema, value, errorCode) {
  if (!schema || !schema["~standard"]) return value;
  const result = await schema["~standard"].validate(value);
  if ("issues" in result && result.issues) {
    const err = new GASForgeError(
      errorCode,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      "Validation failed: " + result.issues.map((i) => i.message).join(", "),
      result.issues
    );
    throw err;
  }
  return result.value;
}
function createServerFn(def) {
  const fn = async (...args) => {
    if (typeof google !== "undefined" && google?.script?.run && !def.handler) {
      const input = args[0];
      const validated = await __validate(
        def.input,
        input,
        "INPUT_VALIDATION_FAILED"
      );
      const serializedInput = superjson.stringify(validated);
      return new Promise((resolve, reject) => {
        const serverFnName = def.__name;
        const serverFn = google.script.run[serverFnName];
        if (typeof serverFn !== "function") {
          reject(
            new GASForgeError(
              "RPC_ERROR",
              `Server function "${serverFnName}" is not exported or defined on the Apps Script server. Make sure it is exported from your server entry point.`
            )
          );
          return;
        }
        google.script.run.withSuccessHandler(async (raw) => {
          try {
            const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
            if (parsed && typeof parsed === "object" && parsed.__gas_error) {
              const err = new GASForgeError(
                parsed.code || "SERVER_ERROR",
                parsed.message || "Server Error"
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
                "OUTPUT_VALIDATION_FAILED"
              )
            );
          } catch (err) {
            reject(err);
          }
        }).withFailureHandler((err) => {
          const rpcErr = new GASForgeError(
            "RPC_ERROR",
            err?.message || String(err)
          );
          reject(rpcErr);
        })[serverFnName](serializedInput);
      });
    }
    try {
      const rawInput = args[0];
      let input;
      if (typeof rawInput === "string") {
        input = superjson.parse(rawInput);
      } else if (rawInput && typeof rawInput === "object" && ("json" in rawInput || "meta" in rawInput)) {
        input = superjson.deserialize(rawInput);
      } else {
        input = rawInput;
      }
      const validatedInput = await __validate(
        def.input,
        input,
        "INPUT_VALIDATION_FAILED"
      );
      let ctx = {};
      if (def.middleware) {
        for (const mw of def.middleware) {
          const nextCtx = await mw.handler(ctx);
          ctx = { ...ctx, ...nextCtx };
        }
      }
      const result = await def.handler(
        validatedInput,
        ctx
      );
      const validatedOutput = await __validate(
        def.output,
        result,
        "OUTPUT_VALIDATION_FAILED"
      );
      return JSON.stringify(superjson.serialize(validatedOutput));
    } catch (err) {
      const errorObj = {
        __gas_error: true,
        code: err?.code || "SERVER_ERROR",
        message: err?.message || String(err),
        stack: err?.stack
      };
      return JSON.stringify(errorObj);
    }
  };
  fn.local = async (input) => {
    const validatedInput = await __validate(
      def.input,
      input,
      "INPUT_VALIDATION_FAILED"
    );
    let ctx = {};
    if (def.middleware) {
      for (const mw of def.middleware) {
        const nextCtx = await mw.handler(ctx);
        ctx = { ...ctx, ...nextCtx };
      }
    }
    const result = await def.handler(
      validatedInput,
      ctx
    );
    const validatedOutput = await __validate(
      def.output,
      result,
      "OUTPUT_VALIDATION_FAILED"
    );
    return validatedOutput;
  };
  const name = def.__name || "serverFn";
  fn.queryKey = (input) => [name, input];
  fn.queryOptions = (input) => ({
    queryKey: [name, input],
    queryFn: () => fn(input)
  });
  return fn;
}
export {
  GASForgeError,
  createMiddleware,
  createServerFn
};
