import { assertStrictEquals } from "@std/assert";
import { NoSignalHintTimer } from "../shared/no-signal.ts";

const DELAY = 8_000;
const REDELAY = 15_000;
const timer = () => new NoSignalHintTimer(DELAY, REDELAY);

Deno.test("nothing fires before the camera starts", () => {
  const t = timer();
  assertStrictEquals(t.tick(0), false);
  assertStrictEquals(t.tick(1_000_000), false, "an unstarted timer must never fire");
  assertStrictEquals(t.isVisible, false);
});

Deno.test("it fires once, after the delay, and not again on its own", () => {
  const t = timer();
  t.cameraStarted(0);
  assertStrictEquals(t.tick(DELAY), false, "not at exactly the delay");
  assertStrictEquals(t.tick(DELAY + 1), true);
  assertStrictEquals(t.isVisible, true);
  // Every subsequent tick must be silent, or the receiver would re-render the
  // panel twice a second for the rest of the transfer.
  for (const now of [DELAY + 2, DELAY + 500, 10 * DELAY]) {
    assertStrictEquals(t.tick(now), false, `fired again at ${now}`);
  }
});

Deno.test("dismissing hides it and restarts the countdown on the longer delay", () => {
  const t = timer();
  t.cameraStarted(0);
  assertStrictEquals(t.tick(DELAY + 1), true);

  t.dismiss(DELAY + 1);
  assertStrictEquals(t.isVisible, false);

  assertStrictEquals(t.tick(DELAY + 1 + DELAY + 1), false, "the first delay no longer applies");
  assertStrictEquals(t.tick(DELAY + 1 + REDELAY), false, "not at exactly the longer delay");
  assertStrictEquals(t.tick(DELAY + 1 + REDELAY + 1), true, "comes back after the longer delay");
  assertStrictEquals(t.isVisible, true);
});

Deno.test("it keeps coming back for as long as nothing decodes", () => {
  const t = timer();
  t.cameraStarted(0);
  let now = DELAY + 1;
  assertStrictEquals(t.tick(now), true, "first round did not fire");
  t.dismiss(now);
  for (let round = 2; round <= 5; round++) {
    now += REDELAY + 1;
    assertStrictEquals(t.tick(now), true, `round ${round} did not re-arm`);
    t.dismiss(now);
  }
});

Deno.test("a camera restart after a dismissal goes back to the short delay", () => {
  const t = timer();
  t.cameraStarted(0);
  assertStrictEquals(t.tick(DELAY + 1), true);
  t.dismiss(DELAY + 1);

  t.cameraStarted(30_000);
  assertStrictEquals(t.tick(30_000 + DELAY - 1), false);
  assertStrictEquals(t.tick(30_000 + DELAY + 1), true, "a fresh attempt uses the fresh-attempt delay");
});

Deno.test("the first decoded frame ends it for good", () => {
  const t = timer();
  t.cameraStarted(0);
  assertStrictEquals(t.tick(DELAY + 1), true);

  assertStrictEquals(t.frameDecoded(), true, "reports that the panel needs removing");
  assertStrictEquals(t.isVisible, false);
  assertStrictEquals(t.tick(100 * DELAY), false, "must never return once a frame has decoded");
});

Deno.test("a frame decoded while the hint is hidden reports nothing to remove", () => {
  const t = timer();
  t.cameraStarted(0);
  assertStrictEquals(t.frameDecoded(), false);
  assertStrictEquals(t.tick(100 * DELAY), false);
});

Deno.test("a decoded frame outlasts a later camera restart", () => {
  // Settings can restart the pipeline; having already seen a frame means the
  // link works, so the advice would be wrong.
  const t = timer();
  t.cameraStarted(0);
  t.frameDecoded();
  t.cameraStarted(50_000);
  assertStrictEquals(t.tick(50_000 + DELAY + 1), false);
});

Deno.test("restarting the camera before any frame re-arms from the new start", () => {
  const t = timer();
  t.cameraStarted(0);
  t.cameraStarted(30_000);
  assertStrictEquals(t.tick(30_000 + DELAY - 1), false, "measured from the old start, not the new one");
  assertStrictEquals(t.tick(30_000 + DELAY + 1), true);
});
