import test from "node:test";
import assert from "node:assert/strict";
import { mergePortfolio } from "./portfolioImport.js";
const current = [
  { symbol: "AAPL", shares: 10, avgCost: 180 },
  { symbol: "MSFT", shares: 5, avgCost: 350 },
];
test("updates matching holdings and preserves all other positions", () => {
  const copy = structuredClone(current);
  assert.deepEqual(
    mergePortfolio(current, [
      { symbol: "aapl", shares: "12" },
      { symbol: "VOO", shares: 2, avgCost: 400 },
    ]),
    [
      { symbol: "AAPL", shares: 12, avgCost: 180 },
      { symbol: "MSFT", shares: 5, avgCost: 350 },
      { symbol: "VOO", shares: 2, avgCost: 400 },
    ],
  );
  assert.deepEqual(current, copy);
});
test("rejects an entire invalid batch before any portfolio changes", () => {
  const copy = structuredClone(current);
  for (const incoming of [
    [
      { symbol: "AAPL", shares: 1, avgCost: 100 },
      { symbol: "VOO", shares: 2 },
    ],
    [{ symbol: "AAPL", shares: "", avgCost: 0 }],
    [{ symbol: "AAPL", shares: "NaN", avgCost: 10 }],
    [{ symbol: "AAPL", shares: 1, avgCost: Infinity }],
    [{ symbol: "../../oops", shares: 1, avgCost: 1 }],
    [
      { symbol: "AAPL", shares: 1 },
      { symbol: "AAPL", shares: 2 },
    ],
    [],
  ])
    assert.throws(() => mergePortfolio(current, incoming));
  assert.deepEqual(current, copy);
});
test("zero cost is explicit and accepted, rather than invented for missing data", () => {
  assert.equal(
    mergePortfolio([], [{ symbol: "ABC", shares: 1, avgCost: 0 }])[0].avgCost,
    0,
  );
  assert.throws(() =>
    mergePortfolio([], [{ symbol: "ABC", shares: 1, avgCost: "" }]),
  );
});
