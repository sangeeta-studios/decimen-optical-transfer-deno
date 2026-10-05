import { assertStrictEquals } from "@std/assert";
import { fitQrDisplaySize } from "../shared/display.ts";

Deno.test("QR display fits inside its container including padding", () => {
  assertStrictEquals(fitQrDisplaySize(1440, 1000, 720, 900, 40), 680);
});

Deno.test("QR display still respects the requested and viewport sizes", () => {
  assertStrictEquals(fitQrDisplaySize(1440, 1000, 1200, 600, 40), 600);
  assertStrictEquals(fitQrDisplaySize(390, 844, 366, 900, 40), 326);
});
