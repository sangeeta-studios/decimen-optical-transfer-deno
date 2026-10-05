// Types for Vite's `?url` import, for `deno check`: Deno cannot resolve the
// query suffix, so wasm-url.ts points its import here with `@ts-types`. Vite
// ignores the directive and emits the asset as before.
declare const url: string;
export default url;
