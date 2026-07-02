// src/middleware.ts
function createMiddleware() {
  return {
    handler(fn) {
      return { handler: fn };
    }
  };
}

// src/errors.ts
var GASForgeError = class extends Error {
  code;
  issues;
  constructor(code, message, issues) {
    super(message);
    this.name = "GASForgeError";
    this.code = code;
    this.issues = issues;
  }
};

export {
  createMiddleware,
  GASForgeError
};
