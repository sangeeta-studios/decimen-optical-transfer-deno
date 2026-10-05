import { assert, assertEquals, assertMatch, assertRejects, assertStrictEquals, assertThrows } from "@std/assert";
import { ApngEncoder } from "../shared/apng.ts";
import { PNG_SIGNATURE, concatBytes, crc32, packBilevelScanlines } from "../shared/png.ts";

const WHITE = 0xffffffff;
const BLACK = 0xff000000;

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

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

const FRAMES = [
  [WHITE, BLACK, BLACK, WHITE],
  [BLACK, WHITE, WHITE, BLACK],
  [WHITE, WHITE, WHITE, WHITE],
];

async function encodeSample(): Promise<Uint8Array> {
  const encoder = new ApngEncoder({ width: 2, height: 2, scale: 2, fps: 10, frameCount: 3 });
  for (const frame of FRAMES) await encoder.addFrame(frame);
  return concatBytes(encoder.finish());
}

Deno.test("chunk order: IHDR, acTL, then fcTL before every frame, IEND last", async () => {
  const chunks = walkChunks(await encodeSample());
  assertEquals(
    chunks.map((c) => c.type),
    ["IHDR", "PLTE", "acTL", "fcTL", "IDAT", "fcTL", "fdAT", "fcTL", "fdAT", "IEND"],
  );
});

Deno.test("IHDR carries the scaled dimensions of a bilevel image", async () => {
  const ihdr = walkChunks(await encodeSample())[0]!.data;
  const dv = new DataView(ihdr.buffer, ihdr.byteOffset);
  assertStrictEquals(dv.getUint32(0), 4); // 2 × scale 2
  assertStrictEquals(dv.getUint32(4), 4);
  assertStrictEquals(ihdr[8], 1); // bit depth
  assertStrictEquals(ihdr[9], 3); // palette — ffmpeg's APNG decoder refuses 1-bit gray
});

Deno.test("acTL declares the frame count and loops forever", async () => {
  const actl = walkChunks(await encodeSample()).find((c) => c.type === "acTL")!.data;
  const dv = new DataView(actl.buffer, actl.byteOffset);
  assertStrictEquals(dv.getUint32(0), 3);
  assertStrictEquals(dv.getUint32(4), 0); // num_plays 0 = infinite
});

Deno.test("fcTL: full frames at exactly 1/fps, one sequence counter with fdAT", async () => {
  const chunks = walkChunks(await encodeSample());
  const fctls = chunks.filter((c) => c.type === "fcTL").map((c) => c.data);
  const fdats = chunks.filter((c) => c.type === "fdAT").map((c) => c.data);
  const sequenceOf = (data: Uint8Array) => new DataView(data.buffer, data.byteOffset).getUint32(0);
  assertEquals(fctls.map(sequenceOf), [0, 1, 3]);
  assertEquals(fdats.map(sequenceOf), [2, 4]);
  for (const data of fctls) {
    const dv = new DataView(data.buffer, data.byteOffset);
    assertStrictEquals(dv.getUint32(4), 4); // width
    assertStrictEquals(dv.getUint32(8), 4); // height
    assertStrictEquals(dv.getUint32(12), 0); // x offset
    assertStrictEquals(dv.getUint32(16), 0); // y offset
    assertStrictEquals(dv.getUint16(20), 1); // delay numerator
    assertStrictEquals(dv.getUint16(22), 10); // delay denominator = fps
    assertStrictEquals(data[24], 0); // dispose NONE
    assertStrictEquals(data[25], 0); // blend SOURCE
  }
});

Deno.test("every frame inflates to its packed scanlines", async () => {
  const chunks = walkChunks(await encodeSample());
  const streams = [
    chunks.find((c) => c.type === "IDAT")!.data,
    ...chunks.filter((c) => c.type === "fdAT").map((c) => c.data.subarray(4)),
  ];
  for (const [i, stream] of streams.entries()) {
    assertEquals(
      [...(await inflate(stream))],
      [...packBilevelScanlines(2, 2, FRAMES[i]!, 2)],
      `frame ${i}`,
    );
  }
});

Deno.test("the declared frame count is enforced in both directions", async () => {
  const encoder = new ApngEncoder({ width: 1, height: 1, scale: 1, fps: 1, frameCount: 2 });
  await encoder.addFrame([WHITE]);
  assertMatch(assertThrows(() => encoder.finish(), Error).message, /declared 2 frames, got 1/);
  await encoder.addFrame([BLACK]);
  assertMatch((await assertRejects(() => encoder.addFrame([WHITE]), Error)).message, /more frames than the 2 declared/);
  encoder.finish();
  assertMatch(assertThrows(() => encoder.finish(), Error).message, /finish\(\) called twice/);
  assertMatch((await assertRejects(() => encoder.addFrame([WHITE]), Error)).message, /after finish/);
});

Deno.test("an fps outside the u16 delay denominator is refused", () => {
  for (const fps of [0, 65536]) {
    const error = assertThrows(
      () => new ApngEncoder({ width: 1, height: 1, scale: 1, fps, frameCount: 1 }),
      Error,
    );
    assertMatch(error.message, /fps/);
  }
});
