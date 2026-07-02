import { StandardSchemaV1 } from '@standard-schema/spec';

/**
 * A middleware function that processes context before a server function handler runs.
 */
interface Middleware<TNextCtx = any> {
    handler: (ctx: Record<string, unknown>) => Promise<TNextCtx> | TNextCtx;
}
/**
 * Helper type to infer the combined context produced by an array of middlewares.
 */
type InferMiddlewareContext<TMiddlewares extends ReadonlyArray<Middleware<any>>> = TMiddlewares extends readonly [Middleware<infer C1>, ...infer Rest] ? Rest extends readonly Middleware<any>[] ? C1 & InferMiddlewareContext<Rest> : C1 : Record<string, never>;
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
declare function createMiddleware(): {
    handler<TNextCtx extends Record<string, unknown>>(fn: (ctx: Record<string, unknown>) => Promise<TNextCtx> | TNextCtx): Middleware<TNextCtx>;
};

/**
 * Query helper extensions attached to every server function.
 * Compatible with TanStack Query (React Query, Vue Query, Solid Query).
 */
interface ServerFnQueryExtensions<TInput extends StandardSchemaV1, TOutput extends StandardSchemaV1> {
    queryKey: (...args: StandardSchemaV1.InferInput<TInput> extends void ? [input?: StandardSchemaV1.InferInput<TInput>] : [input: StandardSchemaV1.InferInput<TInput>]) => [string, StandardSchemaV1.InferInput<TInput> | undefined];
    queryOptions: (...args: StandardSchemaV1.InferInput<TInput> extends void ? [input?: StandardSchemaV1.InferInput<TInput>] : [input: StandardSchemaV1.InferInput<TInput>]) => {
        queryKey: [string, StandardSchemaV1.InferInput<TInput> | undefined];
        queryFn: () => Promise<StandardSchemaV1.InferOutput<TOutput>>;
    };
}

type GASForgeErrorCode = "INPUT_VALIDATION_FAILED" | "OUTPUT_VALIDATION_FAILED" | "MIDDLEWARE_ERROR" | "SERVER_ERROR" | "RPC_ERROR";
declare class GASForgeError extends Error {
    readonly code: GASForgeErrorCode;
    readonly issues?: ReadonlyArray<StandardSchemaV1.Issue>;
    constructor(code: GASForgeErrorCode, message: string, issues?: ReadonlyArray<StandardSchemaV1.Issue>);
}

export { GASForgeError as G, type InferMiddlewareContext as I, type Middleware as M, type ServerFnQueryExtensions as S, type GASForgeErrorCode as a, createMiddleware as c };
