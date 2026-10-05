import type { Plugin, ResolvedConfig } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";

/**
 * `@vitejs/plugin-basic-ssl`, with its PEM split into certificate and key.
 *
 * The plugin hands Vite one bundle (private key first, then certificate) as
 * both `cert` and `key`. Vite parses `cert` with X509Certificate to list the
 * cert's hostnames at startup; Node skips ahead to the CERTIFICATE block, but
 * Deno's implementation reads the first block, hits the key, and the dev
 * server dies before listening. Separate blocks are what TLS wants anyway.
 *
 * Wrapped rather than chained: Vite runs configResolved hooks concurrently, so
 * a second plugin could not count on basic-ssl having finished.
 */
export function basicSslSplit(): Plugin {
  const inner = basicSsl();
  const innerHook = inner.configResolved as (config: ResolvedConfig) => Promise<void>;
  return {
    ...inner,
    async configResolved(config) {
      await innerHook(config);
      for (const https of [config.server.https, config.preview.https]) {
        if (!https || typeof https.cert !== "string") continue;
        const blocks = https.cert.match(/-----BEGIN ([A-Z ]+)-----[\s\S]+?-----END \1-----/g) ?? [];
        const cert = blocks.filter((b) => b.startsWith("-----BEGIN CERTIFICATE-----"));
        const key = blocks.filter((b) => /^-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(b));
        if (cert.length === 0 || key.length === 0) {
          throw new Error("basic-ssl: expected a certificate and a private key in the generated PEM");
        }
        https.cert = cert.join("\n");
        https.key = key.join("\n");
      }
    },
  };
}
