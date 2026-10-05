import type { Plugin } from "vite";
import { resolve } from "@std/path";

/** Vite names HTML output after its input path, so send/index.html lands at
 *  send/index.html. Standalone builds want one file with a memorable name. */
export function emitAs(outDir: string, from: string, to: string): Plugin {
  return {
    name: "emit-standalone-as",
    enforce: "post",
    closeBundle() {
      Deno.renameSync(resolve(outDir, from), resolve(outDir, to));
      Deno.removeSync(resolve(outDir, from.split("/")[0]!), { recursive: true });
    },
  };
}
