// Hosted catalog loading: one dynamic import per locale, so each language is
// its own chunk and the receive entry stays under its CI size tripwire.
//
// The standalone builds swap this module for loaders.inline.ts (see
// build/use-inline-variants.ts): a single file must embed every catalog, and
// inlining THESE dynamic imports put the catalog bindings after the entry's
// top-level await in the bundle — a temporal-dead-zone crash on open. Static
// imports in the inline variant initialize before any entry code runs.
//
// One entry per registry row — tests/i18n.test.ts fails if these drift apart.
// Explicit literals rather than import(`./locales/${c}`) because Vite needs
// static analysis to split them.

import type { Messages } from "./messages.ts";

export const loaders: Record<string, () => Promise<{ messages: Messages }>> = {
  en: () => import("./locales/en.ts"),
  es: () => import("./locales/es.ts"),
  "pt-br": () => import("./locales/pt-br.ts"),
  fr: () => import("./locales/fr.ts"),
  de: () => import("./locales/de.ts"),
  it: () => import("./locales/it.ts"),
  ru: () => import("./locales/ru.ts"),
  hi: () => import("./locales/hi.ts"),
  "zh-hans": () => import("./locales/zh-hans.ts"),
  ja: () => import("./locales/ja.ts"),
  ko: () => import("./locales/ko.ts"),
  ar: () => import("./locales/ar.ts"),
};
