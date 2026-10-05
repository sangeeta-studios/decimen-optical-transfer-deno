import { assert, assertEquals, assertMatch, assertStrictEquals, assertThrows } from "@std/assert";
import {
  PLTE_BILEVEL,
  PNG_SIGNATURE,
  bilevelIhdr,
  concatBytes,
  crc32,
  deflate,
  encodeBilevelPng,
  packBilevelScanlines,
  pngChunk,
} from "../shared/png.ts";

const WHITE = 0xffffffff;
const BLACK = 0xff000000;

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Walk a PNG byte stream, verifying the signature and every chunk CRC. */
function walkChunks(bytes: Uint8Array): { type: string; data: Uint8Array }[] {
  assertEquals([...bytes.subarray(0, 8)], [...PNG_SIGNATURE], "PNG signature");
  const chunks: { type: string; data: Uint8Array }[] = [];
  let at = 8;
  while (at < bytes.length) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset + at);
    const length = dv.getUint32(0);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    assert(at + 12 + length <= bytes.length, `${type} chunk overruns the file`);
    const data = bytes.subarray(at + 8, at + 8 + length);
    assertStrictEquals(dv.getUint32(8 + length), crc32(bytes.subarray(at + 4, at + 8 + length)), `${type} CRC`);
    chunks.push({ type, data });
    at += 12 + length;
  }
  return chunks;
}

Deno.test("crc32 matches the standard check value", () => {
  assertStrictEquals(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  // Variadic hashing is identical to hashing the concatenation.
  const a = new Uint8Array([1, 2, 3]);
  const b = new Uint8Array([4, 5]);
  assertStrictEquals(crc32(a, b), crc32(concatBytes([a, b])));
});

Deno.test("pngChunk produces the canonical IEND bytes", () => {
  assertEquals(
    [...pngChunk("IEND", new Uint8Array(0))],
    [0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82],
  );
});

Deno.test("bilevel IHDR: big-endian dimensions, depth 1, palette", () => {
  const data = bilevelIhdr(0x0102, 0x0304);
  // Color type 3, not 0: 1-bit grayscale is the one format ffmpeg's APNG
  // decoder refuses, so the exported animation would not survive a video
  // pipeline. See the note on bilevelIhdr.
  assertEquals([...data], [0, 0, 1, 2, 0, 0, 3, 4, 1, 3, 0, 0, 0]);
});

Deno.test("the bilevel palette is black at index 0, white at index 1", () => {
  // packBilevelScanlines writes 1 for white, so index 1 must be white or every
  // exported frame comes out inverted.
  assertEquals([...PLTE_BILEVEL], [0, 0, 0, 255, 255, 255]);
});

Deno.test("scanlines pack MSB-first with a zero filter byte per row", () => {
  // ▓░ / ░▓ checkerboard, top-left white.
  const pixels = [WHITE, BLACK, BLACK, WHITE];
  assertEquals([...packBilevelScanlines(2, 2, pixels, 1)], [0, 0x80, 0, 0x40]);
});

Deno.test("scale repeats bits across and rows down", () => {
  const pixels = [WHITE, BLACK, BLACK, WHITE];
  assertEquals(
    [...packBilevelScanlines(2, 2, pixels, 2)],
    [0, 0xc0, 0, 0xc0, 0, 0x30, 0, 0x30],
  );
});

Deno.test("padding bits in the last byte are zeroed", () => {
  // Three white pixels: 0b1110_0000, never 0b1111_1111.
  assertEquals([...packBilevelScanlines(3, 1, [WHITE, WHITE, WHITE], 1)], [0, 0xe0]);
});

Deno.test("a non-integer or zero scale is refused", () => {
  assertMatch(assertThrows(() => packBilevelScanlines(1, 1, [WHITE], 0), Error).message, /positive integer/);
  assertMatch(assertThrows(() => packBilevelScanlines(1, 1, [WHITE], 1.5), Error).message, /positive integer/);
});

Deno.test("deflate emits a zlib stream DecompressionStream inflates back", async () => {
  const bytes = new Uint8Array(500).map((_, i) => i % 7);
  assertEquals([...(await inflate(await deflate(bytes)))], [...bytes]);
});

Deno.test("encodeBilevelPng is a well-formed single-image PNG", async () => {
  const pixels = [WHITE, BLACK, BLACK, WHITE];
  const png = await encodeBilevelPng(2, 2, pixels, 3);
  const chunks = walkChunks(png);
  // PLTE is not optional here: a palette PNG without one is malformed.
  assertEquals(chunks.map((c) => c.type), ["IHDR", "PLTE", "IDAT", "IEND"]);
  assertEquals([...chunks[0]!.data], [...bilevelIhdr(6, 6)]);
  assertEquals([...chunks[1]!.data], [...PLTE_BILEVEL]);
  assertEquals(
    [...(await inflate(chunks[2]!.data))],
    [...packBilevelScanlines(2, 2, pixels, 3)],
  );
});
