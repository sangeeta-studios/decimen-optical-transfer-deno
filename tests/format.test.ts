import { assertStrictEquals } from "@std/assert";
import { formatBytes } from "../shared/format.ts";
import { MAX_FILE_BYTES, MAX_FILE_LABEL } from "../shared/protocol.ts";

Deno.test("byte counts read the way a person would say them", () => {
  assertStrictEquals(formatBytes(0), "0 B");
  assertStrictEquals(formatBytes(1023), "1023 B");
  assertStrictEquals(formatBytes(1024), "1.0 KB");
  assertStrictEquals(formatBytes(1536), "1.5 KB");
  assertStrictEquals(formatBytes(1024 * 1024 - 1), "1024.0 KB");
  assertStrictEquals(formatBytes(1024 * 1024), "1.0 MB");
  assertStrictEquals(formatBytes(150_323_855), "143.4 MB");
});

Deno.test("the file size limit and its label agree", () => {
  // The label goes on the picker and into the rejection message; the constant
  // is what actually rejects. They are one number in two places.
  assertStrictEquals(MAX_FILE_LABEL, "64 MB");
  assertStrictEquals(formatBytes(MAX_FILE_BYTES), "64.0 MB");
});
