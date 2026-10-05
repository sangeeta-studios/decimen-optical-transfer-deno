import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import { DecodeWorkerPool, type PoolWorker } from "../shared/worker-pool.ts";

class FakeWorker implements PoolWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  readonly sent: unknown[] = [];
  terminated = false;

  constructor(readonly id: number) {}

  postMessage(message: unknown): void {
    this.sent.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  /** Pretend the WASM decoder came back with one symbol (or nothing). */
  reply(bytes: Uint8Array | null, id = 0): void {
    this.onmessage?.({ data: { id, symbols: bytes ? [{ bytes }] : [] } } as MessageEvent);
  }

  /** Grid mode: a frame can come back as several decoded symbols. */
  replyMany(symbols: Uint8Array[], id = 0): void {
    this.onmessage?.({
      data: { id, symbols: symbols.map((bytes) => ({ bytes })) },
    } as MessageEvent);
  }
}

function harness() {
  const created: FakeWorker[] = [];
  const decoded: Uint8Array[] = [];
  const pool = new DecodeWorkerPool(
    () => {
      const worker = new FakeWorker(created.length);
      created.push(worker);
      return worker;
    },
    (bytes) => decoded.push(bytes),
  );
  return { pool, created, decoded };
}

const frame = (n: number) => new Uint8Array([n]);

Deno.test("the pool grows and shrinks to the requested size", () => {
  const { pool, created } = harness();
  pool.resize(3);
  assertStrictEquals(pool.size, 3);
  assertStrictEquals(created.length, 3);

  pool.resize(1);
  assertStrictEquals(pool.size, 1);
  assertStrictEquals(created.length, 3, "shrinking must not spawn anything");
  assertEquals(
    created.map((w) => w.terminated),
    [false, true, true],
    "shrinking terminates from the end, so surviving workers keep their slots",
  );

  pool.resize(0);
  assertStrictEquals(pool.size, 0);
  assert(created.every((w) => w.terminated));
});

Deno.test("resize is idempotent and ignores negative counts", () => {
  const { pool, created } = harness();
  pool.resize(2);
  pool.resize(2);
  assertStrictEquals(created.length, 2);
  pool.resize(-5);
  assertStrictEquals(pool.size, 0);
});

Deno.test("frames go to free workers and come back as decoded bytes", () => {
  const { pool, created, decoded } = harness();
  pool.resize(2);

  assertStrictEquals(pool.submit(frame(1), []), true);
  assertStrictEquals(pool.submit(frame(2), []), true);
  assertStrictEquals(pool.busyCount, 2);
  assertStrictEquals(pool.submit(frame(3), []), false, "no free worker — the caller drops the frame");
  assertEquals(created[0]!.sent, [frame(1)]);
  assertEquals(created[1]!.sent, [frame(2)]);

  created[0]!.reply(new Uint8Array([0xaa]));
  assertStrictEquals(pool.busyCount, 1);
  assertEquals(decoded, [new Uint8Array([0xaa])]);
  assertStrictEquals(pool.submit(frame(4), []), true, "the freed worker takes the next frame");
  assertEquals(created[0]!.sent, [frame(1), frame(4)]);
});

Deno.test("a worker that found no code still frees its slot", () => {
  const { pool, created, decoded } = harness();
  pool.resize(1);
  pool.submit(frame(1), []);
  created[0]!.reply(null);
  assertStrictEquals(pool.busyCount, 0);
  assertEquals(decoded, [], "no bytes, nothing to hand on");
});

Deno.test("the warm-up ping is not mistaken for a finished frame", () => {
  // worker.ts posts {id: -1} once the WASM is instantiated, before any real
  // frame. Treating that as a completion would free a slot nobody claimed.
  const { pool, created, decoded } = harness();
  pool.resize(1);
  pool.submit(frame(1), []);
  assertStrictEquals(pool.busyCount, 1);

  created[0]!.reply(null, -1);
  assertStrictEquals(pool.busyCount, 1, "the in-flight frame is still in flight");
  assertEquals(decoded, []);

  created[0]!.reply(new Uint8Array([1]), 7);
  assertStrictEquals(pool.busyCount, 0);
});

Deno.test("slots stay bound to their own worker across a shrink and regrow", () => {
  // Each worker's handler closes over its index. If shrinking renumbered the
  // survivors, a reply from worker 0 would free somebody else's slot.
  const { pool, created } = harness();
  pool.resize(3);
  pool.submit(frame(1), []);
  pool.resize(1); // drops the two idle workers, keeps the busy one at slot 0
  assertStrictEquals(pool.busyCount, 1);

  pool.resize(3); // two fresh workers land in slots 1 and 2
  assertStrictEquals(created.length, 5);
  assertStrictEquals(pool.submit(frame(2), []), true);
  assertStrictEquals(pool.submit(frame(3), []), true);
  assertStrictEquals(pool.submit(frame(4), []), false, "all three are busy");

  created[0]!.reply(new Uint8Array([1]));
  assertStrictEquals(pool.busyCount, 2);
  created[3]!.reply(new Uint8Array([2]));
  created[4]!.reply(new Uint8Array([3]));
  assertStrictEquals(pool.busyCount, 0);
});

Deno.test("a multi-symbol reply fans out one decode per symbol and frees the slot once", () => {
  const { pool, created, decoded } = harness();
  pool.resize(1);
  pool.submit(frame(1), []);

  created[0]!.replyMany([new Uint8Array([0xa0]), new Uint8Array([0xa2])]);
  assertEquals(decoded, [new Uint8Array([0xa0]), new Uint8Array([0xa2])]);
  assertStrictEquals(pool.busyCount, 0, "one reply frees the slot exactly once");

  // An empty symbol list is a miss: slot freed, nothing handed on.
  pool.submit(frame(2), []);
  created[0]!.replyMany([]);
  assertStrictEquals(pool.busyCount, 0);
  assertStrictEquals(decoded.length, 2);
});

Deno.test("symbol boxes ride along to the decode callback", () => {
  const boxes: unknown[] = [];
  const created: FakeWorker[] = [];
  const pool = new DecodeWorkerPool(
    () => {
      const worker = new FakeWorker(0);
      created.push(worker);
      return worker;
    },
    (_bytes, box) => boxes.push(box),
  );
  pool.resize(1);
  pool.submit(frame(1), []);
  created[0]!.onmessage?.({
    data: {
      id: 0,
      symbols: [{ bytes: new Uint8Array([1]), box: { x: 5, y: 6, w: 40, h: 41 } }],
    },
  } as MessageEvent);
  assertEquals(boxes, [{ x: 5, y: 6, w: 40, h: 41 }]);
});

Deno.test("sightings reach the onSighted callback and never the decode path", () => {
  const sighted: unknown[] = [];
  const created: FakeWorker[] = [];
  const pool = new DecodeWorkerPool(
    () => {
      const worker = new FakeWorker(0);
      created.push(worker);
      return worker;
    },
    () => {
      throw new Error("a sighting must not be handed to onDecoded");
    },
    (box) => sighted.push(box),
  );
  pool.resize(1);
  pool.submit(frame(1), []);
  created[0]!.onmessage?.({
    data: { id: 0, symbols: [], sightings: [{ x: 3, y: 4, w: 50, h: 51 }] },
  } as MessageEvent);
  assertEquals(sighted, [{ x: 3, y: 4, w: 50, h: 51 }]);
  assertStrictEquals(pool.busyCount, 0, "a sighting-only reply still frees the slot");

  // Workers built before the sightings field existed omit it entirely.
  pool.submit(frame(2), []);
  created[0]!.onmessage?.({ data: { id: 1, symbols: [] } } as MessageEvent);
  assertStrictEquals(pool.busyCount, 0);
  assertStrictEquals(sighted.length, 1);
});

Deno.test("quad, modules, and tracked flag ride along to the decode callback", () => {
  const infos: unknown[] = [];
  const created: FakeWorker[] = [];
  const pool = new DecodeWorkerPool(
    () => {
      const worker = new FakeWorker(0);
      created.push(worker);
      return worker;
    },
    (_bytes, _box, info) => infos.push(info),
  );
  pool.resize(1);
  pool.submit(frame(1), []);
  const quad = {
    topLeft: { x: 1, y: 2 },
    topRight: { x: 40, y: 2 },
    bottomRight: { x: 40, y: 41 },
    bottomLeft: { x: 1, y: 41 },
  };
  created[0]!.onmessage?.({
    data: {
      id: 0,
      symbols: [{ bytes: new Uint8Array([1]), box: { x: 1, y: 2, w: 39, h: 39 }, quad, modules: 177, tracked: true }],
    },
  } as MessageEvent);
  assertEquals(infos, [{ quad, modules: 177, tracked: true }]);
});

Deno.test("an empty pool accepts nothing", () => {
  const { pool } = harness();
  assertStrictEquals(pool.submit(frame(1), []), false);
  assertStrictEquals(pool.busyCount, 0);
});
