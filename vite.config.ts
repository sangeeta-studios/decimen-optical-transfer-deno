import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { VitePWA } from "vite-plugin-pwa";
import { resolve } from "@std/path";
import { MAX_FILE_LABEL } from "./shared/protocol.ts";
import { MAX_SNIPPET_LABEL } from "./shared/snippet.ts";
import {
  DEFAULT_FRAME_BYTES,
  DEFAULT_TX_FPS,
  FRAME_BYTES_OPTIONS,
  TX_FPS_OPTIONS,
} from "./shared/send-settings.ts";
import { htmlTokens } from "./build/html-tokens.ts";
import { inlineCodecWasm } from "./build/inline-codec-wasm.ts";
import { useInlineVariants } from "./build/use-inline-variants.ts";
import { rewriteStandaloneLinks } from "./build/rewrite-standalone-links.ts";
import { standaloneCsp } from "./build/standalone-csp.ts";
import { emitAs } from "./build/emit-as.ts";
import { rootPwaHead } from "./build/root-pwa-head.ts";
import { licenseBanner } from "./build/license-banner.ts";
import { diagnosticsEndpoint } from "./build/diagnostics-endpoint.ts";
import { basicSslSplit } from "./build/basic-ssl.ts";
import { i18nPages } from "./build/i18n-pages.ts";

// Where the site is published, used only to make the social-card URLs absolute
// — scrapers are inconsistent about resolving relative ones. Override with
// VITE_SITE_URL when deploying somewhere else; nothing else depends on it, and
// the build still works under any subpath.
const SITE_URL = Deno.env.get("VITE_SITE_URL") ?? "https://decimen.app/";

// HTTPS always: the receiver needs getUserMedia, and on insecure origins
// that API does not exist at all — a phone reaching this server over the LAN
// gets no camera on plain http (browser rule, localhost-only exemption).
// The generated cert is self-signed: tap through the warning once on the
// phone and the page is still a secure context, so the camera works.
//
// Modes:
//   (default)           the site — three pages, PWA, offline after first visit
//   demo                sender locked to the bundled payloads
//   standalone-send     one self-contained decimen-sender.html
//   standalone-receive  one self-contained decimen-receiver.html
//
// The plugins live in build/, one file each.

const ROOT = import.meta.dirname!;

const pkg = JSON.parse(Deno.readTextFileSync(resolve(ROOT, "deno.json"))) as {
  version: string;
};

// Shared between the root PWA manifest and the per-locale manifests emitted
// by i18nPages() — one identity, translated descriptions.
const MANIFEST_BASE = {
  name: "Decimen Optical Transfer",
  short_name: "Decimen",
  description:
    "Send a file or text between two devices with a screen and a camera. No network.",
  theme_color: "#070a11",
  background_color: "#070a11",
  display: "standalone" as const,
  // Real icons, not the demo payload image this once pointed at. The
  // maskable variant keeps the mark inside the launcher's safe zone;
  // Android needs 192 + 512 with honest sizes to consider the app
  // installable at all.
  icons: [
    { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
};

/**
 * Short commit hash for the footer, "-dirty" appended when the build includes
 * uncommitted work. A standalone file found on a USB stick months later can
 * then say exactly what it was built from. "unknown" outside a git checkout
 * (a source tarball still has to build).
 */
function buildId(): string {
  const git = (...args: string[]) => {
    const out = new Deno.Command("git", { args, stdin: "null", stderr: "null" }).outputSync();
    if (!out.success) throw new Error(`git ${args[0]} failed`);
    return new TextDecoder().decode(out.stdout).trim();
  };
  try {
    const hash = git("rev-parse", "--short", "HEAD");
    return git("status", "--porcelain").length > 0 ? `${hash}-dirty` : hash;
  } catch {
    return "unknown";
  }
}

/** Render a <select>'s options from the canonical lists in send-settings.ts. */
const selectOptions = (values: readonly number[], selected: number) =>
  values
    .map((v) => (v === selected ? `<option selected>${v}</option>` : `<option>${v}</option>`))
    .join("");

// The og-description speed claim reads the benchmark records at build time,
// so the social-card text can never lag the published table.
const topSustained = (
  JSON.parse(Deno.readTextFileSync(resolve(ROOT, "benchmarks/records.json"))) as {
    sustained: { sustainedKBs: number } | null;
  }
).sustained;

// One token set for every mode — the standalone pages carry these tokens too.
const TOKENS = {
  TOP_SPEED: topSustained ? `Up to ${Math.floor(topSustained.sustainedKBs)} KB/s` : "Hundreds of KB/s",
  MAX_FILE_LABEL,
  MAX_SNIPPET_LABEL,
  SITE_URL,
  OG_IMAGE: new URL("og.png", SITE_URL).href,
  TX_FPS_OPTIONS: selectOptions(TX_FPS_OPTIONS, DEFAULT_TX_FPS),
  FRAME_BYTES_OPTIONS: selectOptions(FRAME_BYTES_OPTIONS, DEFAULT_FRAME_BYTES),
  APP_VERSION: pkg.version,
  BUILD_ID: buildId(),
};

// Native class fields, as the ES2022 target always gave us. Vite's esbuild
// derives this from a tsconfig.json target, and Deno has no tsconfig.json, so
// without it class fields silently compile to constructor assignments.
const ESBUILD = { tsconfigRaw: { compilerOptions: { useDefineForClassFields: true } } };

export default defineConfig(({ mode }) => {
  const standalone = mode === "standalone-send" || mode === "standalone-receive";
  const page = mode === "standalone-send" ? "send" : "receive";
  const outDir = "dist-standalone";

  if (standalone) {
    return {
      base: "./",
      esbuild: ESBUILD,
      // The bundled demo PNGs are fetched by relative URL, which a single file
      // has no way to satisfy — copying them here would just litter the output.
      publicDir: false,
      plugins: [
        htmlTokens(TOKENS),
        useInlineVariants(ROOT),
        inlineCodecWasm(),
        rewriteStandaloneLinks(page),
        standaloneCsp(page),
        viteSingleFile(),
        licenseBanner(pkg.version),
        emitAs(outDir, `${page}/index.html`, `decimen-${page === "send" ? "sender" : "receiver"}.html`),
      ],
      // Workers are bundled in their own Rollup pass and do not inherit the
      // plugin list, so both plugins have to be registered again here.
      worker: { format: "iife", plugins: () => [useInlineVariants(ROOT), inlineCodecWasm()] },
      build: {
        // ES2022 for top-level await: the entries await initI18n() before
        // touching the DOM. Chrome 89 / Firefox 89 / Safari 15 — anything
        // older already lacks the camera/wasm/worker floor this app stands on.
        target: "es2022",
        outDir,
        emptyOutDir: false,
        assetsInlineLimit: Number.MAX_SAFE_INTEGER,
        rollupOptions: { input: resolve(ROOT, `${page}/index.html`) },
      },
    };
  }

  return {
    base: "./",
    esbuild: ESBUILD,
    plugins: [
      htmlTokens(TOKENS),
      basicSslSplit(),
      VitePWA({
        registerType: "autoUpdate",
        // We inject our own registration — see rootPwaHead().
        injectRegister: false,
        manifest: {
          ...MANIFEST_BASE,
          start_url: "./",
        },
        workbox: {
          // Without this a rebuilt site serves stale pages indefinitely.
          // `registerType: "autoUpdate"` gives the new worker skipWaiting(), so
          // it activates at once — but activating is not the same as taking
          // over: an already-open tab stays bound to the OLD worker, which goes
          // on serving the previous precache. The visible symptom is that a
          // hard reload shows your changes and an ordinary one undoes them,
          // because only the hard reload bypasses the service worker.
          // clientsClaim() makes the new worker adopt open clients immediately.
          clientsClaim: true,
          // success-2mb.png is exactly 2 MiB — right at workbox's per-file
          // default — and benchmark.png adds another meg; the explicit
          // ceiling removes the boundary edge and leaves headroom.
          maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
          // webmanifest included so the per-locale manifests emitted by
          // i18nPages() are served offline alongside their page trees.
          globPatterns: ["**/*.{js,css,html,wasm,png,svg,webmanifest}"],
          // Received media plays from the Cache API at a real URL: iOS Safari
          // will not reliably play a blob: URL handed to <video>/<audio>, but
          // WebKit's media loader is happy with ranged HTTP responses. The
          // receiver fills this cache (see servableMediaUrl in receive/main.ts)
          // and workbox's rangeRequests plugin answers AVFoundation's Range
          // probes from it.
          runtimeCaching: [
            {
              urlPattern: /\/received-media\//,
              handler: "CacheOnly" as const,
              options: {
                cacheName: "received-media",
                rangeRequests: true,
                matchOptions: { ignoreSearch: true },
              },
            },
          ],
        },
      }),
      rootPwaHead(),
      // After rootPwaHead so the locale copies see the final SW registration
      // and manifest link; emits in writeBundle, before the SW precache glob.
      i18nPages({ siteUrl: SITE_URL, tokens: TOKENS, manifest: MANIFEST_BASE }),
      licenseBanner(pkg.version),
      diagnosticsEndpoint(pkg.version),
    ],
    build: {
      // Same ES2022/top-level-await floor as the standalone build above.
      target: "es2022",
      rollupOptions: {
        input: {
          index: resolve(ROOT, "index.html"),
          send: resolve(ROOT, "send/index.html"),
          receive: resolve(ROOT, "receive/index.html"),
        },
      },
    },
    // host: true on both so a phone on the LAN can reach either the dev server
    // or the built bundle that `deno task serve` previews.
    server: { host: true },
    preview: { host: true },
  };
});
