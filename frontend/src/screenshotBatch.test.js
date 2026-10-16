import test from "node:test";
import assert from "node:assert/strict";
import {
  combineScreenshotRows,
  validateScreenshotBatch,
} from "./screenshotBatch.js";
import { reviewIssues } from "./screenshotParser.js";

const row = (id, screenshotId, patch = {}) => ({
  id,
  screenshotId,
  screenshotName: `Image ${screenshotId}`,
  symbol: "AAPL",
  shares: "10",
  avgCost: "150",
  selected: true,
  notes: [],
  confidence: 95,
  ...patch,
});

test("overlapping screenshots produce one position without adding shares", () => {
  const input = [
    row(1, 1),
    row(2, 2, { shares: "10.00", avgCost: "$150.00" }),
    row(3, 3, { symbol: "MSFT" }),
  ];
  const merged = combineScreenshotRows(input);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].shares, "10");
  assert.deepEqual(merged[0].observationIds, [1, 2]);
  assert.equal(merged[0].sources.length, 2);
  assert.equal(input[0].sources, undefined);
});
test("complementary screenshot fields combine in either order, including zero", () => {
  const input = [
    row(1, 1, { avgCost: "" }),
    row(2, 2, { shares: "", avgCost: "0" }),
  ];
  for (const observations of [input, [...input].reverse()]) {
    const merged = combineScreenshotRows(observations);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].shares, "10");
    assert.equal(merged[0].avgCost, "0");
    assert.deepEqual(reviewIssues(merged), [[]]);
  }
});
test("conflicting costs or shares require explicit resolution", () => {
  for (const patch of [
    { shares: "20" },
    { avgCost: "160" },
    { shares: "unreadable" },
  ]) {
    const merged = combineScreenshotRows([row(1, 1), row(2, 2, patch)]);
    assert.equal(merged.length, 2);
    assert.match(reviewIssues(merged)[0].join(" "), /Duplicate/);
    merged[1].selected = false;
    assert.deepEqual(reviewIssues(merged), [[], []]);
  }
});
test("ambiguous partial observations do not pick between conflicting positions", () => {
  assert.equal(
    combineScreenshotRows([
      row(1, 1),
      row(2, 2, { shares: "20" }),
      row(3, 3, { shares: "" }),
    ]).length,
    3,
  );
});
test("same-image rows, manual rows and different selection states remain separate", () => {
  assert.equal(combineScreenshotRows([row(1, 1), row(2, 1)]).length, 2);
  assert.equal(
    combineScreenshotRows([row(1, undefined), row(2, undefined)]).length,
    2,
  );
  assert.equal(
    combineScreenshotRows([row(1, 1), row(2, 2, { selected: false })]).length,
    2,
  );
});
test("removing a source removes only its data and adding images preserves edits", () => {
  const input = [row(1, 1, { avgCost: "" }), row(2, 2, { shares: "" })];
  assert.equal(
    combineScreenshotRows(input.filter((row) => row.screenshotId !== 2))[0]
      .avgCost,
    "",
  );
  const merged = combineScreenshotRows(input)[0];
  const edited = input.map((row) =>
    merged.observationIds.includes(row.id) ? { ...row, shares: "12" } : row,
  );
  assert.equal(
    combineScreenshotRows([...edited, row(3, 3, { symbol: "MSFT" })])[0].shares,
    "12",
  );
});
test("batch limits count existing images and reject the whole addition", () => {
  const file = { size: 5 * 1024 * 1024 };
  assert.doesNotThrow(() =>
    validateScreenshotBatch(Array(9).fill(file), [file]),
  );
  assert.throws(
    () => validateScreenshotBatch(Array(10).fill(file), [file]),
    /50 MB/,
  );
  assert.throws(
    () => validateScreenshotBatch(Array(12).fill({ size: 1 }), [{ size: 1 }]),
    /12 screenshots/,
  );
});

test("manually entered positions never silently merge with screenshot observations", () => {
  for (const input of [
    [row(1, undefined), row(2, 2)],
    [row(2, 2), row(1, undefined)],
  ]) {
    assert.equal(combineScreenshotRows(input).length, 2);
  }
});
