import assert from "node:assert/strict";
import { test } from "node:test";
import { serializedRouting } from "@/services/server/http";

test("serialized jobs started within the minimum interval wait for the remainder", async (context) => {
  let now = Date.now() + 10_000;
  context.mock.method(Date, "now", () => { now += 1099; return now; });
  const order: number[] = [];
  const jobs = [1, 2].map((id) => serializedRouting(async () => { order.push(id); return id; }));
  assert.deepEqual(await Promise.all(jobs), [1, 2]);
  assert.deepEqual(order, [1, 2]);
});
