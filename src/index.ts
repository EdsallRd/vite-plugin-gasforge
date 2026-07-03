import gas, { type GASPluginOptions } from "./plugin";

export {
  createServerFn,
  type ServerFn,
  createMiddleware,
  type Middleware,
  type InferMiddlewareContext,
  GASForgeError,
  type GASForgeErrorCode,
  type ServerFnQueryExtensions,
} from "./runtime";
export type { GASPluginOptions };
export default gas;
