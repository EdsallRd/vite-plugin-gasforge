export const CLIENT_RUNTIME = `
import superjson from "superjson";

async function __validate(schema, value, errorCode) {
  if (!schema || !schema["~standard"]) return value;
  const result = await schema["~standard"].validate(value);
  if ("issues" in result && result.issues) {
    const err = new Error("Validation failed: " + result.issues.map(i => i.message).join(", "));
    err.name = "GASForgeError";
    err.code = errorCode;
    err.issues = result.issues;
    throw err;
  }
  return result.value;
}

export function createServerFn(def) {
  const fn = async (...args) => {
    const input = args[0];
    const validated = await __validate(def.input, input, "INPUT_VALIDATION_FAILED");
    const serializedInput = superjson.stringify(validated ?? null);
    return new Promise((resolve, reject) => {
      google.script.run
        .withSuccessHandler(async (raw) => {
          try {
            const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
            if (parsed && typeof parsed === "object" && parsed.__gas_error) {
              const err = new Error(parsed.message || "Server Error");
              err.name = "GASForgeError";
              err.code = parsed.code || "SERVER_ERROR";
              err.stack = parsed.stack;
              reject(err);
              return;
            }
            const deserialized = superjson.deserialize(parsed);
            resolve(await __validate(def.output, deserialized, "OUTPUT_VALIDATION_FAILED"));
          } catch (err) { reject(err); }
        })
        .withFailureHandler((err) => {
          const rpcErr = new Error(err?.message || String(err));
          rpcErr.name = "GASForgeError";
          rpcErr.code = "RPC_ERROR";
          reject(rpcErr);
        })
        [def.__name](serializedInput);
    });
  };

  const name = def.__name || "serverFn";
  fn.queryKey = (input) => [name, input];
  fn.queryOptions = (input) => ({
    queryKey: [name, input],
    queryFn: () => fn(input),
  });

  return fn;
}
`;

export const SERVER_RUNTIME = `
import superjson from "superjson";

async function __validateServer(schema, value, errorCode) {
  if (!schema || !schema["~standard"]) return value;
  const result = await schema["~standard"].validate(value);
  if ("issues" in result && result.issues) {
    const err = new Error("Validation failed: " + result.issues.map(i => i.message).join(", "));
    err.code = errorCode;
    throw err;
  }
  return result.value;
}

export function createServerFn(def) {
  const fn = async (...args) => {
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
      const validatedInput = await __validateServer(def.input, input, "INPUT_VALIDATION_FAILED");
      let ctx = {};
      if (def.middleware) {
        for (const mw of def.middleware) {
          const nextCtx = await mw.handler(ctx);
          ctx = { ...ctx, ...nextCtx };
        }
      }
      const result = await def.handler(validatedInput, ctx);
      const validatedOutput = await __validateServer(def.output, result, "OUTPUT_VALIDATION_FAILED");
      return JSON.stringify(superjson.serialize(validatedOutput ?? null));
    } catch (err) {
      const errorObj = {
        __gas_error: true,
        code: err.code || "SERVER_ERROR",
        message: err.message || String(err),
        stack: err.stack,
      };
      return JSON.stringify(errorObj);
    }
  };

  const name = def.__name || "serverFn";
  fn.queryKey = (input) => [name, input];
  fn.queryOptions = (input) => ({
    queryKey: [name, input],
    queryFn: () => fn(input),
  });

  return fn;
}
`;
