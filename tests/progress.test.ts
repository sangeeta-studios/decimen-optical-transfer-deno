import { assert, assertStrictEquals } from "@std/assert";
import {
  estimateTransferProgress,
  expectedFountainOverhead,
  formatDuration,
} from "../shared/progress.ts";

// k=100 is a ~300 KB file at 2953 bytes/frame — a very ordinary transfer.
// v2 overhead(100) = 1.02, so 102 expected frames and 2 of expected redundancy.
const K = 100;
const EXPECTED_FRAMES = 102;

Deno.test("the carousel needs almost no fountain overhead, and the model says so", () => {
  // v2 measurement: p50 AND p90 over 100 zero-loss trials are exactly 1.00
  // for every k in {5, 25, 100, 400, 1600} — one caught sweep is the whole
  // file. The model quotes a hair above so the bar never finishes early.
  for (const k of [2, 5, 25, 100, 500, 5000, 65535]) {
    const value = expectedFountainOverhead(k);
    assert(value >= 1 && value <= 1.05, `k=${k}: ${value}`);
  }
  assertStrictEquals(expectedFountainOverhead(1), 1, "a single block needs exactly one frame");
  assertStrictEquals(expectedFountainOverhead(0), 1, "guards against a zero-block stream");
});

Deno.test("progress and ETA follow the observed unique-frame rate", () => {
  const progress = estimateTransferProgress(K, 50, 10);
  assertStrictEquals(progress.expectedFrames, EXPECTED_FRAMES);
  assertStrictEquals(progress.fraction, 0.43);
  assertStrictEquals(progress.phase, "collecting");
  // 52 frames still wanted at the observed 5 frames/s.
  assertStrictEquals(progress.etaSeconds, 10.4);
});

Deno.test("progress keeps moving through redundant frames", () => {
  const at = (frames: number) => estimateTransferProgress(K, frames, 20).fraction;

  assertStrictEquals(estimateTransferProgress(K, 2, 4).etaSeconds, undefined, "too early to guess");
  assertStrictEquals(at(K), 0.86, "the theoretical minimum is 86% of the bar");
  assertStrictEquals(at(K + 1), 0.91, "half the expected redundancy is 91%");
  assert(Math.abs(at(EXPECTED_FRAMES) - 0.96) < 1e-9, "expected frames lands on 96%");
  assert(at(EXPECTED_FRAMES + 18) > 0.96, "running long still creeps forward");
  assert(at(EXPECTED_FRAMES + 30) < 0.99, "and never reaches 100% on frame count alone");
  assert(at(EXPECTED_FRAMES * 4) <= 0.99);
});

Deno.test("the ETA keeps quoting a time once a stream runs long", () => {
  // Past the expected count the target steps up one redundancy block at a time
  // rather than going silent — which is exactly when someone is wondering
  // whether the transfer has stalled.
  const overrun = estimateTransferProgress(K, EXPECTED_FRAMES + 5, 30);
  assert(overrun.etaSeconds !== undefined && overrun.etaSeconds > 0);
  assertStrictEquals(overrun.phase, "decoding");
});

Deno.test("decoded blocks can advance progress and completion caps at 99%", () => {
  assertStrictEquals(estimateTransferProgress(K, 101, 20, 95).fraction, 0.9405);
  assertStrictEquals(estimateTransferProgress(K, 101, 20, 100).fraction, 0.99);
});

Deno.test("the bar cannot run far ahead of solved blocks", () => {
  // The 22%-catch 4-code field run: a frames-only bar said 96% while under
  // half the blocks were solved, then the transfer "finished early". Once
  // blocks are flowing, the frame baseline may lead them by at most 12% of
  // the stream.
  const capped = estimateTransferProgress(K, 98, 20, 30);
  assert(Math.abs(capped.fraction - 0.86 * 0.42) < 1e-9, `got ${capped.fraction}`);
  // The cap only restrains the frame PROMISE — blocks still lift the bar on
  // their own, so a block-rich stream is never pushed backwards.
  assertStrictEquals(estimateTransferProgress(K, 101, 20, 95).fraction, 0.9405);
  // With nothing solved yet the baseline stays uncapped: the stream has not
  // started delivering, and early sweep frames solve on arrival anyway.
  assertStrictEquals(estimateTransferProgress(K, 50, 10).fraction, 0.43);
});

Deno.test("durations stay compact and readable", () => {
  assertStrictEquals(formatDuration(12.1), "13s");
  assertStrictEquals(formatDuration(75.1), "1m 16s");
  assertStrictEquals(formatDuration(3_661), "1h 1m");
});
