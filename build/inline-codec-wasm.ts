import type { Plugin } from "vite";
import { encodeBase64 } from "@std/encoding/base64";

/**
 * `?inline` does not work on .wasm — Vite claims the extension for its own wasm
 * handling and Rollup then tries to parse the binary as JavaScript. So the
 * base64 is produced here instead, behind a virtual module.
 */
export function inlineCodecWasm(): Plugin {
  const id = "virtual:codec-wasm-data-url";
  const resolved = `\0${id}`;
  return {
    name: "inline-codec-wasm",
    resolveId: (source) => (source === id ? resolved : null),
    load(source) {
      if (source !== resolved) return null;
      const wasm = Deno.readFileSync(new URL("../vendor/decimen-codec/decimen_codec.wasm", import.meta.url));
      return `export default "data:application/wasm;base64,${encodeBase64(wasm)}"`;
    },
  };
}
