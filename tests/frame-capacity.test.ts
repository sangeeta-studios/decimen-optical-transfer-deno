import { assert, assertStrictEquals } from "@std/assert";
import {
  MAX_SOURCE_BLOCKS,
  blockLength,
  fitsInOneStream,
  minimumFrameBytes,
  smallestSufficientFrameSize,
  sourceBlockCount,
} from "../shared/frame-capacity.ts";
import { HEADER_LEN, MAX_FILE_BYTES } from "../shared/protocol.ts";
import { FRAME_BYTES_OPTIONS } from "../shared/send-settings.ts";

/** The sender's actual bytes/frame dropdown — these tests hold for the options
 *  really on offer, not a copy that can drift. */
const OFFERED = FRAME_BYTES_OPTIONS;

Deno.test("the header takes its cut off every frame", () => {
  assertStrictEquals(blockLength(2953), 2953 - HEADER_LEN);
  assertStrictEquals(blockLength(500), 500 - HEADER_LEN);
});

Deno.test("block count rounds up, because a partial block still needs a frame", () => {
  // Derived from blockLength() rather than written out: these boundaries move
  // whenever the header does, and a wire-format change should not look like a
  // capacity bug.
  const perFrame = blockLength(2953);
  assertStrictEquals(sourceBlockCount(1, 2953), 1);
  assertStrictEquals(sourceBlockCount(perFrame, 2953), 1);
  assertStrictEquals(sourceBlockCount(perFrame + 1, 2953), 2);
  assertStrictEquals(sourceBlockCount(10 * perFrame, 2953), 10);
});

Deno.test("the block ceiling bites well below the file size limit", () => {
  // This is the whole reason the check exists: at the smallest offered frame
  // size you run out of block numbers around 30 MB, not 64.
  assertStrictEquals(fitsInOneStream(30 * 1024 * 1024, 500), false);
  assertStrictEquals(fitsInOneStream(20 * 1024 * 1024, 500), true);
  assertStrictEquals(fitsInOneStream(MAX_FILE_BYTES, 2953), true);
});

Deno.test("minimumFrameBytes is the smallest frame size that actually fits", () => {
  for (const payload of [1, 1000, 30 * 1024 * 1024, 64 * 1024 * 1024, MAX_FILE_BYTES]) {
    const minimum = minimumFrameBytes(payload);
    assert(fitsInOneStream(payload, minimum), `${payload} does not fit at ${minimum}`);
    // ...and it really is the smallest: one byte less must not fit, unless we
    // are already at the floor where a single block covers everything.
    if (sourceBlockCount(payload, minimum) > 1) {
      assertStrictEquals(
        fitsInOneStream(payload, minimum - 1),
        false,
        `${payload} unexpectedly still fits at ${minimum - 1}`,
      );
    }
  }
});

Deno.test("the suggested dropdown option always works", () => {
  // The sender puts this number in front of the user, so it has to be a value
  // they can pick AND one that resolves the error.
  for (const payload of [30 * 1024 * 1024, 40 * 1024 * 1024, MAX_FILE_BYTES]) {
    for (const frameBytes of OFFERED) {
      if (fitsInOneStream(payload, frameBytes)) continue;
      const suggestion = smallestSufficientFrameSize(payload, OFFERED);
      assert(suggestion !== undefined, `no suggestion for ${payload} at ${frameBytes}`);
      assert(OFFERED.includes(suggestion), `${suggestion} is not an offered option`);
      assert(fitsInOneStream(payload, suggestion), `${suggestion} still does not fit`);
      assert(suggestion > frameBytes, "suggesting the setting that just failed helps nobody");
    }
  }
});

Deno.test("an offered option always exists for any legal payload", () => {
  // The container adds a header plus the name and media type, so allow room
  // above MAX_FILE_BYTES for the largest plausible envelope.
  const worstCase = MAX_FILE_BYTES + 49 + 2 * 0xffff;
  const suggestion = smallestSufficientFrameSize(worstCase, OFFERED);
  assert(suggestion !== undefined, "the dropdown cannot express the largest legal payload");
  assert(fitsInOneStream(worstCase, suggestion));
});

Deno.test("no suggestion when nothing on offer is big enough", () => {
  assertStrictEquals(smallestSufficientFrameSize(MAX_SOURCE_BLOCKS * 4000, OFFERED), undefined);
});
