import test from "node:test";
import assert from "node:assert/strict";
import {
  extractHoldings,
  parseAmount,
  reviewIssues,
} from "./screenshotParser.js";
function table(headers, rows) {
  const line = (cells, y) => ({
    words: cells.map((text, i) => ({
      text,
      confidence: 96,
      bbox: { x0: i * 220 + 20, x1: i * 220 + 100, y0: y, y1: y + 20 },
    })),
  });
  return {
    blocks: [
      {
        paragraphs: [
          {
            lines: [
              line(headers, 10),
              ...rows.map((row, i) => line(row, 50 + i * 40)),
            ],
          },
        ],
      },
    ],
  };
}
test("extracts reordered broker columns without confusing price with purchase cost", () => {
  const result = extractHoldings(
    table(
      ["Symbol", "Current Price", "Quantity", "Average Cost"],
      [
        ["AAPL", "$225.00", "10.5", "$180.25"],
        ["BRK.B", "$450.00", "2", "$310.00"],
      ],
    ),
  );
  assert.deepEqual(
    result.rows.map(({ symbol, shares, avgCost }) => ({
      symbol,
      shares,
      avgCost,
    })),
    [
      { symbol: "AAPL", shares: "10.5", avgCost: "180.25" },
      { symbol: "BRK.B", shares: "2", avgCost: "310" },
    ],
  );
});
test("never substitutes current price for missing average cost", () => {
  const result = extractHoldings(
    table(
      ["Ticker", "Shares", "Price", "Value"],
      [["MSFT", "5", "$420.00", "$2,100.00"]],
    ),
  );
  assert.equal(result.rows[0].shares, "5");
  assert.equal(result.rows[0].avgCost, "");
});
test("derives average cost only from an explicitly labeled total cost basis", () => {
  const result = extractHoldings(
    table(
      ["Ticker", "Quantity", "Cost Basis", "Market Value"],
      [["VOO", "4", "$1,600.00", "$2,000.00"]],
    ),
  );
  assert.equal(result.rows[0].avgCost, "400");
  assert.match(result.rows[0].notes[0], /calculated/);
});
test("can remap a detected table instead of relying on one brokerage layout", () => {
  const data = table(
    ["Symbol", "Quantity", "Cost", "Price"],
    [["AAPL", "3", "$180", "$225"]],
  );
  assert.equal(extractHoldings(data).rows[0].avgCost, "");
  assert.equal(extractHoldings(data, { avgCost: "2" }).rows[0].avgCost, "180");
});
test("recognizes labeled mobile position cards and fractional shares", () => {
  const result = extractHoldings(
    "AAPL\nApple Inc.\n0.125 shares\nAverage cost $180.50\nMSFT\nMicrosoft Corp.\nQuantity: 2\nPrice $420",
  );
  assert.deepEqual(
    result.rows.map((r) => [r.symbol, r.shares, r.avgCost]),
    [
      ["AAPL", "0.125", "180.5"],
      ["MSFT", "2", ""],
    ],
  );
});
test("handles separators and rejects percentages, negatives, and ambiguous cells", () => {
  assert.equal(parseAmount("$1,234.50"), "1234.5");
  assert.equal(parseAmount("1.234,50"), "1234.5");
  assert.equal(parseAmount("0,25"), "0.25");
  assert.equal(parseAmount("0"), "0");
  for (const value of ["", null, "-2", "2%", "15 $200", "NaN", "Infinity"])
    assert.equal(parseAmount(value), "");
});
test("flags incomplete and duplicate positions, with cost preservation for existing holdings", () => {
  const rows = [
    { symbol: "AAPL", shares: "2", avgCost: "" },
    { symbol: "AAPL", shares: "", avgCost: "" },
    { symbol: "MSFT", shares: "1", avgCost: "", selected: false },
  ];
  const issues = reviewIssues(rows, [{ symbol: "AAPL", avgCost: 170 }]);
  assert.equal(issues[0].length, 1);
  assert.equal(issues[1].length, 2);
  assert.deepEqual(issues[2], []);
  assert.match(
    reviewIssues([{ symbol: "VOO", shares: "1", avgCost: "" }])[0][0],
    /average cost/,
  );
});
test("foreign purchase prices are not silently treated as dollars", () => {
  const result = extractHoldings(
    table(["Symbol", "Shares", "Average Cost"], [["VOD", "5", "£100.00"]]),
  );
  assert.equal(result.rows[0].avgCost, "");
  assert.match(result.rows[0].notes[0], /USD/);
});
test("blank and unsupported layouts safely return no inferred holdings", () => {
  assert.deepEqual(extractHoldings({ text: "" }).rows, []);
  assert.deepEqual(
    extractHoldings({ text: "Portfolio value $10,000" }).rows,
    [],
  );
});
test("headerless tables require manual mapping instead of assuming numeric column meanings", () => {
  const data = table(
    ["AAPL", "10", "225", "180"],
    [["MSFT", "5", "420", "350"]],
  );
  const auto = extractHoldings(data);
  assert.equal(auto.rows.length, 2);
  assert.equal(auto.rows[0].shares, "");
  assert.equal(auto.rows[0].avgCost, "");
  const mapped = extractHoldings(data, { shares: "1", avgCost: "3" });
  assert.equal(mapped.rows[1].shares, "5");
  assert.equal(mapped.rows[1].avgCost, "350");
});
test("valid symbols that resemble headings can still be imported", () => {
  const data = table(
    ["Symbol", "Shares", "Average Cost"],
    [["COST", "2", "$500"]],
  );
  assert.equal(extractHoldings(data).rows[0].symbol, "COST");
  assert.deepEqual(
    reviewIssues([{ symbol: "CASH", shares: "1", avgCost: "50" }]),
    [[]],
  );
});

test("extracts cost-only tables and mobile cards for combining with quantity screenshots", () => {
  const data = table(["Symbol", "Average Cost"], [["AAPL", "$150.00"]]);
  for (const result of [
    extractHoldings(data),
    extractHoldings("AAPL\nAverage cost: $150.00"),
  ]) {
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].symbol, "AAPL");
    assert.equal(result.rows[0].shares, "");
    assert.equal(result.rows[0].avgCost, "150");
  }
});
