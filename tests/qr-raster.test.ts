import { assert, assertEquals, assertMatch, assertStrictEquals, assertThrows } from "@std/assert";
import { gridDims, rasterizeQr, rasterizeQrGrid } from "../shared/qr-raster.ts";

const WHITE = 0xffffffff;
const BLACK = 0xff000000;

Deno.test("a single dark module with no margin is one black pixel", () => {
  const { size, pixels } = rasterizeQr(1, [1], 0);
  assertStrictEquals(size, 1);
  assertEquals([...pixels], [BLACK]);
});

Deno.test("the margin surrounds the modules with white on every side", () => {
  const { size, pixels } = rasterizeQr(1, [1], 2);
  assertStrictEquals(size, 5);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const expected = x === 2 && y === 2 ? BLACK : WHITE;
      assertStrictEquals(pixels[y * size + x], expected, `pixel (${x},${y})`);
    }
  }
});

Deno.test("modules map row-major and truthy means dark", () => {
  // ▓░ / ░▓ checkerboard
  const { size, pixels } = rasterizeQr(2, [1, 0, 0, 1], 0);
  assertStrictEquals(size, 2);
  assertEquals([...pixels], [BLACK, WHITE, WHITE, BLACK]);
});

Deno.test("an all-light matrix rasterizes to all white", () => {
  const { size, pixels } = rasterizeQr(3, new Uint8Array(9), 1);
  assertStrictEquals(size, 5);
  assert([...pixels].every((p) => p === WHITE));
});

Deno.test("every offered layout gets an as-square-as-possible grid, taller first", () => {
  assertEquals(gridDims(1), { cols: 1, rows: 1 });
  assertEquals(gridDims(2), { cols: 1, rows: 2 });
  assertEquals(gridDims(4), { cols: 2, rows: 2 });
  assertEquals(gridDims(6), { cols: 2, rows: 3 });
  assertEquals(gridDims(9), { cols: 3, rows: 3 });
});

Deno.test("a 2×2 grid tiles four matrices, each inside its own quiet zone", () => {
  // Single-module codes with margin 1: cells are 3×3, dark centers at
  // (1,1), (4,1), (1,4), (4,4) for the codes that have a dark module.
  const { width, height, pixels } = rasterizeQrGrid(1, [[1], [0], [0], [1]], 1);
  assertStrictEquals(width, 6);
  assertStrictEquals(height, 6);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dark = (x === 1 && y === 1) || (x === 4 && y === 4);
      assertStrictEquals(pixels[y * width + x], dark ? BLACK : WHITE, `pixel (${x},${y})`);
    }
  }
});

Deno.test("a 2-code grid stacks in a single column", () => {
  // Cells are 3×3: dark centers at (1,1) and (1,4), nothing beside them.
  const { width, height, pixels } = rasterizeQrGrid(1, [[1], [1]], 1);
  assertStrictEquals(width, 3);
  assertStrictEquals(height, 6);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dark = x === 1 && (y === 1 || y === 4);
      assertStrictEquals(pixels[y * width + x], dark ? BLACK : WHITE, `pixel (${x},${y})`);
    }
  }
});

Deno.test("a 6-code grid fills two columns by three rows", () => {
  // Margin 0, single-module codes: the raster IS the layout, row-major.
  const { width, height, pixels } = rasterizeQrGrid(1, [[1], [0], [1], [0], [1], [0]], 0);
  assertStrictEquals(width, 2);
  assertStrictEquals(height, 3);
  assertEquals([...pixels], [BLACK, WHITE, BLACK, WHITE, BLACK, WHITE]);
});

Deno.test("a grid of one is exactly the plain raster", () => {
  const grid = rasterizeQrGrid(2, [[1, 0, 0, 1]], 2);
  const plain = rasterizeQr(2, [1, 0, 0, 1], 2);
  assertStrictEquals(grid.width, plain.size);
  assertStrictEquals(grid.height, plain.size);
  assertEquals([...grid.pixels], [...plain.pixels]);
});

Deno.test("a code count that cannot fill its rows is refused", () => {
  assertMatch(assertThrows(() => rasterizeQrGrid(1, [[1], [1], [1], [1], [1]], 1), Error).message, /fills its rows/);
  assertMatch(assertThrows(() => gridDims(5), Error).message, /fills its rows/);
  assertMatch(assertThrows(() => gridDims(7), Error).message, /fills its rows/);
  assertMatch(assertThrows(() => gridDims(0), Error).message, /fills its rows/);
});

Deno.test("pixel values are the RGBA bytes an ImageData buffer expects", () => {
  const { pixels } = rasterizeQr(1, [1], 1);
  const bytes = new Uint8Array(pixels.buffer);
  // little-endian u32 0xff000000 → R,G,B = 0 and A = 255
  const center = 4 * (1 * 3 + 1);
  assertEquals([...bytes.slice(center, center + 4)], [0, 0, 0, 255]);
  // and the white corner is R,G,B,A all 255
  assertEquals([...bytes.slice(0, 4)], [255, 255, 255, 255]);
});
