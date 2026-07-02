import { PluginOption, BuildOptions, Plugin } from 'vite';
import { StandardSchemaV1 } from '@standard-schema/spec';

interface GASPluginOptions {
    server?: string;
    client?: {
        entry?: string;
        plugins?: PluginOption[];
        rollupOptions?: BuildOptions["rollupOptions"];
    };
}
declare function gas(options?: GASPluginOptions): Plugin;

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

/**
 * A callable server function with typed input/output and query helper extensions.
 * On the client (after build transform), calls google.script.run.
 * On the server, calls the handler directly.
 */
type ServerFn<TInput extends StandardSchemaV1, TOutput extends StandardSchemaV1> = ((...args: StandardSchemaV1.InferInput<TInput> extends void ? [input?: StandardSchemaV1.InferInput<TInput>] : [input: StandardSchemaV1.InferInput<TInput>]) => Promise<StandardSchemaV1.InferOutput<TOutput>>) & ServerFnQueryExtensions<TInput, TOutput>;
/**
 * Define a server function that can be called from client code.
 */
declare function createServerFn<TInput extends StandardSchemaV1, TOutput extends StandardSchemaV1, TMiddlewares extends ReadonlyArray<Middleware<any>> = []>(def: {
    middleware?: TMiddlewares;
    input: TInput;
    output: TOutput;
    handler: (input: StandardSchemaV1.InferOutput<TInput>, ctx: InferMiddlewareContext<TMiddlewares>) => Promise<StandardSchemaV1.InferInput<TOutput>> | StandardSchemaV1.InferInput<TOutput>;
    __name?: string;
}): ServerFn<TInput, TOutput>;

type GASForgeErrorCode = "INPUT_VALIDATION_FAILED" | "OUTPUT_VALIDATION_FAILED" | "MIDDLEWARE_ERROR" | "SERVER_ERROR" | "RPC_ERROR";
declare class GASForgeError extends Error {
    readonly code: GASForgeErrorCode;
    readonly issues?: ReadonlyArray<StandardSchemaV1.Issue>;
    constructor(code: GASForgeErrorCode, message: string, issues?: ReadonlyArray<StandardSchemaV1.Issue>);
}

export { GASForgeError, type GASForgeErrorCode, type GASPluginOptions, type InferMiddlewareContext, type Middleware, type ServerFn, type ServerFnQueryExtensions, createMiddleware, createServerFn, gas as default };
