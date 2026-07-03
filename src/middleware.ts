/**
 * A middleware function that processes context before a server function handler runs.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface Middleware<TNextCtx = any> {
  handler: (ctx: Record<string, unknown>) => Promise<TNextCtx> | TNextCtx;
}

/**
 * Helper type to infer the combined context produced by an array of middlewares.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type InferMiddlewareContext<TMiddlewares extends readonly Middleware<any>[]> =
  TMiddlewares extends readonly [Middleware<infer C1>, ...infer Rest]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? Rest extends readonly Middleware<any>[]
      ? C1 & InferMiddlewareContext<Rest>
      : C1
    : Record<string, never>;

/**
 * Create a middleware that can be attached to `createServerFn`.
 *
 * @example
 * ```ts
 * const authMiddleware = createMiddleware().handler(async () => {
 *   const userEmail = Session.getActiveUser().getEmail();
 *   if (!userEmail) throw new Error("Unauthorized");
 *   return { userEmail };
 * });
 * ```
 */
export function createMiddleware() {
  return {
    handler<TNextCtx extends Record<string, unknown>>(
      fn: (ctx: Record<string, unknown>) => Promise<TNextCtx> | TNextCtx,
    ): Middleware<TNextCtx> {
      return { handler: fn };
    },
  };
}
