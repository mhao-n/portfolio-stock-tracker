const SYMBOL = /^[A-Z0-9]+(?:[.-][A-Z0-9]+)*$/;
const MAX_ROWS = 500;

// Validate the entire batch before returning any changes to the file-backed store.
export function mergePortfolio(current, incoming) {
  if (
    !Array.isArray(incoming) ||
    !incoming.length ||
    incoming.length > MAX_ROWS
  ) {
    throw new Error("Import between 1 and 500 holdings.");
  }
  const bySymbol = new Map(current.map((row) => [row.symbol, { ...row }]));
  const seen = new Set();
  for (const [index, row] of incoming.entries()) {
    if (!row || typeof row !== "object" || Array.isArray(row))
      throw new Error(`Row ${index + 1}: invalid holding.`);
    const symbol =
      typeof row.symbol === "string" ? row.symbol.trim().toUpperCase() : "";
    if (!symbol || symbol.length > 15 || !SYMBOL.test(symbol))
      throw new Error(`Row ${index + 1}: enter a valid ticker.`);
    if (seen.has(symbol))
      throw new Error(
        `Duplicate ticker ${symbol}. Combine or remove the extra row.`,
      );
    seen.add(symbol);
    if (
      (typeof row.shares === "string" && row.shares.trim() === "") ||
      row.shares == null ||
      !["string", "number"].includes(typeof row.shares) ||
      !Number.isFinite(Number(row.shares)) ||
      Number(row.shares) < 0
    )
      throw new Error(`${symbol}: enter a valid share quantity.`);
    const existing = bySymbol.get(symbol);
    const missingCost = row.avgCost === "" || row.avgCost == null;
    const cost = missingCost ? existing?.avgCost : row.avgCost;
    if (
      (typeof cost === "string" && cost.trim() === "") ||
      cost == null ||
      !["string", "number"].includes(typeof cost) ||
      !Number.isFinite(Number(cost)) ||
      Number(cost) < 0
    )
      throw new Error(`${symbol}: average cost is required for a new holding.`);
    bySymbol.set(symbol, {
      ...existing,
      symbol,
      shares: Number(row.shares),
      avgCost: Number(cost),
    });
  }
  return [...bySymbol.values()].sort((a, b) =>
    a.symbol.localeCompare(b.symbol),
  );
}
