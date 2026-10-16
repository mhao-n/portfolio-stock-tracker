const RANGE_DAYS = { "1W": 7, "1M": 30, "3M": 90, "1Y": 365 };

// Anchor ranges to the latest saved day so an older portfolio remains inspectable.
export function portfolioHistory(snapshots, range = "1M") {
  const rows = (snapshots || [])
    .filter(
      (row) =>
        row.date &&
        Number.isFinite(Date.parse(row.date)) &&
        row.totalValue !== null &&
        row.totalValue !== "" &&
        Number.isFinite(Number(row.totalValue)) &&
        Number(row.totalValue) >= 0,
    )
    .map((row) => ({
      date: String(row.date).slice(0, 10),
      totalValue: Number(row.totalValue),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!rows.length || !RANGE_DAYS[range]) return rows;
  const cutoff = Date.parse(rows.at(-1).date) - RANGE_DAYS[range] * 86400000;
  return rows.filter((row) => Date.parse(row.date) >= cutoff);
}
