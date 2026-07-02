export const CLIENT_RUNTIME = `
async function __validate(schema, value) {
  const result = await schema["~standard"].validate(value);
  if ("issues" in result && result.issues) {
    throw new Error("Validation failed: " + result.issues.map(i => i.message).join(", "));
  }
  return result.value;
}

export function createServerFn(def) {
  return async (...args) => {
    const input = args[0];
    const validated = await __validate(def.input, input);
    return new Promise((resolve, reject) => {
      google.script.run
        .withSuccessHandler(async (raw) => {
          try {
            const result = typeof raw === "string" ? JSON.parse(raw) : raw;
            resolve(await __validate(def.output, result));
          }
          catch (err) { reject(err); }
        })
        .withFailureHandler(reject)
        [def.__name](JSON.stringify(validated ?? null));
    });
  };
}
`;

export const SERVER_RUNTIME = `
export function createServerFn(def) {
  return async (...args) => {
    const input = typeof args[0] === "string" ? JSON.parse(args[0]) : args[0];
    const result = await def.handler(input);
    return JSON.stringify(result ?? null);
  };
}
`;
