import type { StandardSchemaV1 } from "@standard-schema/spec";

export type GASForgeErrorCode =
  | "INPUT_VALIDATION_FAILED"
  | "OUTPUT_VALIDATION_FAILED"
  | "MIDDLEWARE_ERROR"
  | "SERVER_ERROR"
  | "RPC_ERROR";

export class GASForgeError extends Error {
  public readonly code: GASForgeErrorCode;
  public readonly issues?: readonly StandardSchemaV1.Issue[];

  constructor(
    code: GASForgeErrorCode,
    message: string,
    issues?: readonly StandardSchemaV1.Issue[],
  ) {
    super(message);
    this.name = "GASForgeError";
    this.code = code;
    this.issues = issues;
  }
}
