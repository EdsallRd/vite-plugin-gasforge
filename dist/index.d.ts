import { PluginOption, BuildOptions, Plugin } from 'vite';
export { GASForgeError, GASForgeErrorCode, InferMiddlewareContext, Middleware, ServerFn, ServerFnQueryExtensions, createMiddleware, createServerFn } from './runtime.js';
import '@standard-schema/spec';

interface GASPluginOptions {
    server?: string;
    client?: {
        entry?: string;
        plugins?: PluginOption[];
        rollupOptions?: BuildOptions["rollupOptions"];
    };
}
declare function gas(options?: GASPluginOptions): Plugin;

export { type GASPluginOptions, gas as default };
