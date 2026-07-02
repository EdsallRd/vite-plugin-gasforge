import { PluginOption, BuildOptions, Plugin } from 'vite';
import { StandardSchemaV1 } from '@standard-schema/spec';
import { S as ServerFnQueryExtensions, M as Middleware, I as InferMiddlewareContext } from './errors-DZYkikXZ.js';
export { G as GASForgeError, a as GASForgeErrorCode, c as createMiddleware } from './errors-DZYkikXZ.js';

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

export { type GASPluginOptions, InferMiddlewareContext, Middleware, type ServerFn, ServerFnQueryExtensions, createServerFn, gas as default };
