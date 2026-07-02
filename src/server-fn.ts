import type { StandardSchemaV1 } from "@standard-schema/spec";

/**
 * A callable server function with typed input/output.
 * On the client (after build transform), calls google.script.run.
 * On the server, calls the handler directly.
 */
export type ServerFn<
  TInput extends StandardSchemaV1,
  TOutput extends StandardSchemaV1,
> = (
  ...args: StandardSchemaV1.InferInput<TInput> extends void
    ? []
    : [input: StandardSchemaV1.InferInput<TInput>]
) => Promise<StandardSchemaV1.InferOutput<TOutput>>;

/**
 * Define a server function that can be called from client code.
 *
 * At build time, the plugin transforms this:
 * - **Client build**: handler is stripped, replaced with a google.script.run RPC call
 * - **Server build**: handler is kept, function is exported for GAS
 *
 * @example
 * ```ts
 * import { createServerFn } from "@edsallrd/vite-plugin-gasforge";
 * import { z } from "zod";
 *
 * const getGreeting = createServerFn({
 *   input: z.void(),
 *   output: z.string(),
 *   handler: () => "Hello, world!",
 * });
 *
 * // Call it directly — fully typed
 * const msg = await getGreeting();
 * ```
 */
export function createServerFn<
  TInput extends StandardSchemaV1,
  TOutput extends StandardSchemaV1,
>(def: {
  input: TInput;
  output: TOutput;
  handler: (
    input: StandardSchemaV1.InferOutput<TInput>,
  ) => StandardSchemaV1.InferInput<TOutput>;
}): ServerFn<TInput, TOutput> {
  // Server runtime: return a callable that invokes the handler directly.
  // On the client, this code is replaced by the build transform.
  const fn = async (...args: unknown[]) =>
    def.handler(args[0] as StandardSchemaV1.InferOutput<TInput>);
  return fn as ServerFn<TInput, TOutput>;
}
