import { assert, assertMatch, assertRejects, assertStrictEquals, assertThrows } from "@std/assert";
import {
  MAX_SNIPPET_BYTES,
  MAX_SNIPPET_LABEL,
  isSnippet,
  packSnippet,
  snippetText,
} from "../shared/snippet.ts";
import { unpackFile, verifyFile } from "../shared/protocol.ts";

Deno.test("a text snippet survives the optical container", async () => {
  const text = "ssh-ed25519 AAAAC3Nz… evan@laptop\nand a second line.";
  const packed = await packSnippet(text);
  const file = await unpackFile(packed.container);

  assert(await verifyFile(file));
  assert(isSnippet(file));
  assertStrictEquals(snippetText(file), text);
});

Deno.test("the receiver tells a snippet apart from an ordinary file", async () => {
  const { packFile } = await import("../shared/protocol.ts");
  const file = await unpackFile(
    (await packFile("notes.txt", "text/plain", new TextEncoder().encode("hello"))).container,
  );

  assertStrictEquals(isSnippet(file), false);
  assertMatch(assertThrows(() => snippetText(file), Error).message, /not a text snippet/);
});

Deno.test("empty snippets are rejected", async () => {
  assertMatch((await assertRejects(() => packSnippet("  \n\t "), Error)).message, /Paste or type some text/);
});

Deno.test("snippets are capped, and the cap is measured in UTF-8 bytes", async () => {
  const overCap = new RegExp(`limited to ${MAX_SNIPPET_LABEL}`);
  const ascii = await assertRejects(() => packSnippet("x".repeat(MAX_SNIPPET_BYTES + 1)), Error);
  assertMatch(ascii.message, overCap);

  // "あ" is one UTF-16 unit but three UTF-8 bytes, so a string well under the
  // cap by .length is still over it on the wire.
  const wide = await assertRejects(
    () => packSnippet("あ".repeat(Math.ceil(MAX_SNIPPET_BYTES / 3) + 1)),
    Error,
  );
  assertMatch(wide.message, overCap);
});

Deno.test("long snippets compress before they are transmitted", async () => {
  const packed = await packSnippet("the same sentence over and over. ".repeat(2000));

  assertStrictEquals(packed.compression, "gzip");
  assert(packed.transmittedSize < packed.originalSize);
});
