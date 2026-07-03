import type { StandardSchemaV1 } from "@standard-schema/spec";

/**
 * Query helper extensions attached to every server function.
 * Compatible with TanStack Query (React Query, Vue Query, Solid Query).
 */
export interface ServerFnQueryExtensions<
  TInput extends StandardSchemaV1,
  TOutput extends StandardSchemaV1,
> {
  local: (
    ...args: StandardSchemaV1.InferInput<TInput> extends void
      ? [input?: StandardSchemaV1.InferInput<TInput>]
      : [input: StandardSchemaV1.InferInput<TInput>]
  ) => Promise<StandardSchemaV1.InferOutput<TOutput>>;

  queryKey: (
    ...args: StandardSchemaV1.InferInput<TInput> extends void
      ? [input?: StandardSchemaV1.InferInput<TInput>]
      : [input: StandardSchemaV1.InferInput<TInput>]
  ) => [string, StandardSchemaV1.InferInput<TInput> | undefined];

  queryOptions: (
    ...args: StandardSchemaV1.InferInput<TInput> extends void
      ? [input?: StandardSchemaV1.InferInput<TInput>]
      : [input: StandardSchemaV1.InferInput<TInput>]
  ) => {
    queryKey: [string, StandardSchemaV1.InferInput<TInput> | undefined];
    queryFn: () => Promise<StandardSchemaV1.InferOutput<TOutput>>;
  };
}
