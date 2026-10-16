import { parseAmount } from "./screenshotParser.js";

// Only combine compatible observations from different screenshots. Quantities
// describe a position, so overlapping screenshots must never add them together.
export function combineScreenshotRows(observations) {
  const groups = [];
  const compatible = (a, b) =>
    ["shares", "avgCost"].every((field) => {
      if (
        a[field] === "" ||
        a[field] == null ||
        b[field] === "" ||
        b[field] == null
      )
        return true;
      const left = parseAmount(a[field]),
        right = parseAmount(b[field]);
      return left !== "" && right !== "" && Number(left) === Number(right);
    });
  for (const row of observations) {
    const symbol = row.symbol.trim().toUpperCase();
    const candidates = groups.filter(
      (group) =>
        symbol &&
        row.screenshotId &&
        group.symbol === symbol &&
        group.selected === row.selected &&
        group.sources.every(
          (source) =>
            source.screenshotId && source.screenshotId !== row.screenshotId,
        ) &&
        compatible(group, row),
    );
    // An incomplete observation cannot safely choose between conflicting rows.
    const target = candidates.length === 1 ? candidates[0] : null;
    const source = {
      screenshotId: row.screenshotId,
      name: row.screenshotName || "Manual entry",
      text: row.source,
    };
    if (target) {
      for (const field of ["shares", "avgCost"]) {
        if (target[field] === "" || target[field] == null)
          target[field] = row[field];
      }
      target.observationIds.push(row.id);
      target.sources.push(source);
      target.notes = [...new Set([...target.notes, ...(row.notes || [])])];
      target.confidence = Math.min(
        target.confidence ?? 100,
        row.confidence ?? 100,
      );
    } else {
      groups.push({
        ...row,
        symbol,
        notes: [...(row.notes || [])],
        observationIds: [row.id],
        sources: [source],
      });
    }
  }
  return groups;
}

export function validateScreenshotBatch(current, incoming) {
  if (current.length + incoming.length > 12)
    throw new Error("Use up to 12 screenshots per import.");
  if (
    [...current, ...incoming].reduce((sum, file) => sum + file.size, 0) >
    50 * 1024 * 1024
  )
    throw new Error("Keep the combined screenshots under 50 MB.");
}
