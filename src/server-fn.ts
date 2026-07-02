import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { Middleware, InferMiddlewareContext } from "./middleware";
import type { ServerFnQueryExtensions } from "./query";

/**
 * A callable server function with typed input/output and query helper extensions.
 * On the client (after build transform), calls google.script.run.
 * On the server, calls the handler directly.
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

/**
 * Define a server function that can be called from client code.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createServerFn<
  TInput extends StandardSchemaV1,
  TOutput extends StandardSchemaV1,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TMiddlewares extends ReadonlyArray<Middleware<any>> = [],
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
    const input = args[0] as StandardSchemaV1.InferOutput<TInput>;
    let ctx: Record<string, unknown> = {};
    if (def.middleware) {
      for (const mw of def.middleware) {
        const nextCtx = await mw.handler(ctx);
        ctx = { ...ctx, ...nextCtx };
      }
    }
    return def.handler(input, ctx as InferMiddlewareContext<TMiddlewares>);
  };

  const name = def.__name || "serverFn";

  const ext: ServerFnQueryExtensions<TInput, TOutput> = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    queryKey: (...args: any[]) => [name, args[0]],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    queryOptions: (...args: any[]) => ({
      queryKey: [name, args[0]],
      queryFn: () => fn(args[0]),
    }),
  };

  return Object.assign(fn, ext) as unknown as ServerFn<TInput, TOutput>;
}
