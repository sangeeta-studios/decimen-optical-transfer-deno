// Types for Vite's `?worker&inline` import, for `deno check`: Deno cannot
// resolve the query suffix, so worker-factory.inline.ts points its import here
// with `@ts-types`. Vite ignores the directive and inlines the worker as before.
declare const InlineWorker: new () => Worker;
export default InlineWorker;
