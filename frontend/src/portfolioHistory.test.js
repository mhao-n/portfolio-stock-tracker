import test from "node:test";
import assert from "node:assert/strict";
import { portfolioHistory } from "./portfolioHistory.js";

const snapshots = [
  "2025-01-01",
  "2025-10-15",
  "2026-07-17",
  "2026-09-16",
  "2026-10-08",
  "2026-10-09",
  "2026-10-16",
].map((date, i) => ({ date, totalValue: 100 + i }));
test("chart windows use calendar days, including their boundary", () => {
  assert.deepEqual(
    portfolioHistory(snapshots, "1W").map((row) => row.date),
    ["2026-10-09", "2026-10-16"],
  );
  assert.equal(portfolioHistory(snapshots, "1M")[0].date, "2026-09-16");
  assert.equal(portfolioHistory(snapshots, "3M")[0].date, "2026-09-16");
  assert.equal(portfolioHistory(snapshots, "1Y")[0].date, "2026-07-17");
  assert.equal(portfolioHistory(snapshots, "ALL").length, snapshots.length);
});
test("history sorts without mutating input and preserves a zero balance", () => {
  const input = [
    { date: "2026-10-16", totalValue: 0 },
    { date: "2026-10-09", totalValue: "123.50" },
  ];
  const copy = structuredClone(input);
  assert.deepEqual(portfolioHistory(input), [
    { date: "2026-10-09", totalValue: 123.5 },
    { date: "2026-10-16", totalValue: 0 },
  ]);
  assert.deepEqual(input, copy);
});
test("missing, invalid, and single-day history remain safe", () => {
  assert.deepEqual(portfolioHistory(undefined), []);
  assert.deepEqual(
    portfolioHistory([
      { date: "invalid", totalValue: 10 },
      { date: "2026-10-16", totalValue: null },
      { date: "2026-10-16", totalValue: -1 },
      { date: "2026-10-16", totalValue: "bad" },
    ]),
    [],
  );
  assert.equal(
    portfolioHistory([{ date: "2026-10-16", totalValue: 20 }]).length,
    1,
  );
});
