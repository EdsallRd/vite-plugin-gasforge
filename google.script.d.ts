// Client-side google.script API types for Google Apps Script HTML Service.
// Add to your tsconfig: "types": ["vite-plugin-gas/google.script"]
// See: https://developers.google.com/apps-script/guides/html/reference/run

declare namespace google {
  namespace script {
    interface IRun {
      [serverSideFunction: string]: (...args: unknown[]) => void;

      withFailureHandler(
        callback: (error: Error, object?: unknown) => void,
      ): IRun;

      withSuccessHandler(
        callback: (value: unknown, object?: unknown) => void,
      ): IRun;

      withUserObject(object: object): IRun;
    }

    const run: IRun;

    namespace host {
      function close(): void;
      function setHeight(height: number): void;
      function setWidth(width: number): void;
      namespace editor {
        function focus(): void;
      }
    }

    namespace url {
      interface IUrlLocation {
        hash: string;
        parameter: Record<string, string>;
        parameters: Record<string, string[]>;
      }
      function getLocation(callback: (location: IUrlLocation) => void): void;
    }

    namespace history {
      function push(
        stateObject?: unknown,
        params?: Record<string, unknown>,
        hash?: string,
      ): void;
      function replace(
        stateObject?: unknown,
        params?: Record<string, unknown>,
        hash?: string,
      ): void;
      function setChangeHandler(
        callback: (event: {
          state: unknown;
          location: url.IUrlLocation;
        }) => void,
      ): void;
    }
  }
}
