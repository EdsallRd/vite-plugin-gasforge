import gas, { type GASPluginOptions } from "./plugin";

export { createServerFn, type ServerFn } from "./server-fn";
export { createMiddleware, type Middleware, type InferMiddlewareContext } from "./middleware";
export { GASForgeError, type GASForgeErrorCode } from "./errors";
export type { ServerFnQueryExtensions } from "./query";
export type { GASPluginOptions };
export default gas;
