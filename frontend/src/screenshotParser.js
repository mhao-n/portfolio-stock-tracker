const HEADER_PATTERNS = [
  [
    "avgCost",
    /\b(?:avg\.?\s*(?:cost|price)|average\s+(?:cost|price)|cost\s+per\s+(?:share|unit)|purchase\s+price|unit\s+cost)\b/gi,
  ],
  [
    "costBasis",
    /\b(?:total\s+cost|cost\s+basis|book\s+(?:cost|value)|amount\s+invested)\b/gi,
  ],
  ["shares", /\b(?:shares(?:\s+owned)?|quantity|qty|units)\b/gi],
  [
    "symbol",
    /\b(?:ticker(?:\s+symbol)?|symbol|security|investments?|holdings?|assets?)\b/gi,
  ],
  [
    "",
    /\b(?:current\s+price|market\s+price|market\s+value|position\s+value|total\s+return|day(?:'s)?\s+(?:change|return)|gain(?:\s*\/\s*loss)?|price|value|name|cost|return|weight|allocation)\b/gi,
  ],
];
const FOREIGN_CURRENCY = /[€£¥₹]|\b(?:EUR|GBP|CAD|AUD|HKD|JPY|INR)\b/i;
const IGNORE =
  /^(?:symbol|ticker|name|security|holding|total|cash|usd|eur|gbp|shares|quantity|balance|account|portfolio|investments|stock|stocks|value|price|avg|average)$/i;

export function parseAmount(value) {
  if (/\d\s+[$€£¥]/.test(String(value))) return "";
  let text = String(value ?? "")
    .trim()
    .replace(/(?:USD|EUR|GBP|CAD|AUD|HKD|JPY)/gi, "")
    .replace(/[$€£¥\s]/g, "");
  if (!/^[+]?\d[\d,.]*$|^[+]?\.\d+$/.test(text)) return "";
  if (text.includes(",") && text.includes(".")) {
    text =
      text.lastIndexOf(",") > text.lastIndexOf(".")
        ? text.replaceAll(".", "").replace(",", ".")
        : text.replaceAll(",", "");
  } else if (/^\d{1,3}(?:,\d{3})+$/.test(text)) text = text.replaceAll(",", "");
  else if (/^\d+,\d{1,2}$/.test(text)) text = text.replace(",", ".");
  const number = Number(text);
  return Number.isFinite(number) && number >= 0 ? String(number) : "";
}

function symbolOf(text) {
  const value = String(text || "")
    .trim()
    .replace(/^\$|[,:;]$/g, "")
    .toUpperCase();
  return value.length <= 15 &&
    /^[A-Z0-9]+(?:[.-][A-Z0-9]+)*$/.test(value) &&
    !IGNORE.test(value)
    ? value
    : "";
}

function ocrLines(data) {
  const words = (data.blocks || [])
    .flatMap((block) =>
      (block.paragraphs || []).flatMap((paragraph) =>
        (paragraph.lines || []).flatMap((line) => line.words || []),
      ),
    )
    .filter((word) => word.text?.trim() && word.bbox)
    .sort((a, b) => (a.bbox.y0 + a.bbox.y1) / 2 - (b.bbox.y0 + b.bbox.y1) / 2);
  if (!words.length)
    return String(data.text || "")
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((text, i) => ({
        y: i * 30,
        height: 20,
        words: [...text.matchAll(/\S+/g)].map((match) => ({
          text: match[0],
          confidence: 90,
          bbox: {
            x0: match.index * 10,
            x1: (match.index + match[0].length) * 10,
            y0: i * 30,
            y1: i * 30 + 20,
          },
        })),
      }));
  const lines = [];
  for (const word of words) {
    const center = (word.bbox.y0 + word.bbox.y1) / 2,
      height = word.bbox.y1 - word.bbox.y0;
    const last = lines.at(-1);
    if (
      last &&
      Math.abs(last.y - center) <= Math.max(last.height, height) * 0.55
    )
      last.words.push(word);
    else lines.push({ y: center, height, words: [word] });
  }
  for (const line of lines) line.words.sort((a, b) => a.bbox.x0 - b.bbox.x0);
  return lines;
}

function headerHits(line) {
  let offset = 0;
  const positions = line.words.map((word) => {
    const start = offset;
    offset += word.text.length + 1;
    return { ...word, start, end: offset - 1 };
  });
  const text = line.words.map((word) => word.text).join(" "),
    hits = [];
  for (const [role, pattern] of HEADER_PATTERNS) {
    for (const match of text.matchAll(new RegExp(pattern))) {
      const start = match.index,
        end = start + match[0].length;
      if (hits.some((h) => start < h.end && end > h.start)) continue;
      const parts = positions.filter(
        (word) => word.start < end && word.end > start,
      );
      if (parts.length)
        hits.push({
          role,
          label: match[0],
          x: (parts[0].bbox.x0 + parts.at(-1).bbox.x1) / 2,
          start,
          end,
        });
    }
  }
  return hits.sort((a, b) => a.x - b.x);
}

function mobileRows(lines) {
  const rows = [];
  const texts = lines.map((line) =>
    line.words.map((word) => word.text).join(" "),
  );
  for (let i = 0; i < texts.length; i++) {
    const match = texts[i].match(
      /^(?:(?:symbol|ticker)\s*:\s*)?([A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*)(?:\s+(.+))?$/i,
    );
    const symbol = match && symbolOf(match[1]);
    if (!symbol || (/^\d/.test(symbol) && !/[A-Z]/.test(symbol))) continue;
    const explicitlyLabeled = /^(?:symbol|ticker)\s*:/i.test(texts[i]);
    if (
      !explicitlyLabeled &&
      (match[1] !== match[1].toUpperCase() ||
        (match[2] &&
          !/(?:shares|quantity|qty|units|average|avg)/i.test(match[2])))
    )
      continue;
    let chunk = match[2] || "";
    for (let j = i + 1; j < Math.min(i + 9, texts.length); j++) {
      if (
        symbolOf(texts[j]) &&
        /[A-Z]/.test(texts[j]) &&
        texts[j] === texts[j].toUpperCase()
      )
        break;
      chunk += " " + texts[j];
    }
    const shares =
      chunk.match(
        /(?:shares(?:\s+owned)?|quantity|qty|units)\s*[:=]?\s*([\d,.]+)/i,
      ) || chunk.match(/([\d,.]+)\s*(?:shares|units)\b/i);
    if (!shares) continue;
    const cost = chunk.match(
      /(?:avg\.?\s*(?:cost|price)|average\s+(?:cost|price)|cost\s+per\s+(?:share|unit)|purchase\s+price)\s*[:=]?\s*([$€£¥]?\s*[\d,.]+)/i,
    );
    const basis = chunk.match(
      /(?:total\s+cost|cost\s+basis|book\s+cost)\s*[:=]?\s*([$€£¥]?\s*[\d,.]+)/i,
    );
    const quantity = parseAmount(shares[1]);
    const foreign = FOREIGN_CURRENCY.test(chunk);
    const basisValue = basis ? parseAmount(basis[1]) : "";
    rows.push({
      symbol,
      shares: quantity,
      avgCost: foreign
        ? ""
        : cost
          ? parseAmount(cost[1])
          : basisValue !== "" && Number(quantity) > 0
            ? String(Number(basisValue) / Number(quantity))
            : "",
      notes: foreign
        ? ["Convert the cost to USD before importing."]
        : basis && !cost
          ? ["Average cost calculated from total cost."]
          : [],
      source: texts[i] + " " + chunk,
      confidence: Math.min(...lines[i].words.map((w) => w.confidence ?? 90)),
    });
  }
  return rows;
}

export function extractHoldings(data, mapping = {}) {
  const lines = ocrLines(typeof data === "string" ? { text: data } : data);
  const headers = lines
    .map((line, index) => ({ index, hits: headerHits(line) }))
    .filter(
      (row) =>
        row.hits.length >= 2 &&
        row.hits.some((h) => h.role === "shares") &&
        row.hits.some((h) => h.role === "symbol"),
    );
  let header = headers.sort((a, b) => b.hits.length - a.hits.length)[0];
  if (!header) {
    const mobile = mobileRows(lines);
    if (mobile.length) return { rows: mobile, columns: [], mapping: {} };
    const first = lines.find(
      (line) =>
        symbolOf(line.words[0]?.text) &&
        line.words.slice(1).filter((word) => parseAmount(word.text) !== "")
          .length >= 1,
    );
    if (!first) return { rows: [], columns: [], mapping: {} };
    const cells = first.words.filter(
      (word, i) => i === 0 || parseAmount(word.text) !== "",
    );
    header = {
      index: -1,
      hits: cells.map((word, i) => ({
        role: i === 0 ? "symbol" : "",
        label: i === 0 ? "Ticker" : `Column ${i + 1}: ${word.text}`,
        x: (word.bbox.x0 + word.bbox.x1) / 2,
      })),
    };
  }
  const columns = header.hits.map((hit, i, all) => ({
    ...hit,
    id: String(i),
    left: i ? (all[i - 1].x + hit.x) / 2 : -Infinity,
    right: i < all.length - 1 ? (hit.x + all[i + 1].x) / 2 : Infinity,
  }));
  const active = Object.fromEntries(
    ["symbol", "shares", "avgCost", "costBasis"].map((role) => [
      role,
      mapping[role] ?? columns.find((c) => c.role === role)?.id ?? "",
    ]),
  );
  const rows = [];
  for (const line of lines.slice(header.index + 1)) {
    const cells = columns.map((column) =>
      line.words
        .filter((word) => {
          const x = (word.bbox.x0 + word.bbox.x1) / 2;
          return x >= column.left && x < column.right;
        })
        .map((word) => word.text)
        .join(" "),
    );
    const ticker = cells[Number(active.symbol)]
      ?.split(/\s+/)
      .map(symbolOf)
      .find(Boolean);
    if (active.symbol === "" || !ticker) continue;
    const get = (role) =>
      active[role] === "" ? "" : parseAmount(cells[Number(active[role])]);
    const shares = get("shares"),
      totalCost = get("costBasis");
    let avgCost = get("avgCost");
    const notes = [];
    const foreign =
      FOREIGN_CURRENCY.test(cells[Number(active.avgCost)] || "") ||
      FOREIGN_CURRENCY.test(cells[Number(active.costBasis)] || "");
    if (foreign) {
      avgCost = "";
      notes.push("Convert the cost to USD before importing.");
    }
    if (!foreign && !avgCost && totalCost !== "" && Number(shares) > 0) {
      avgCost = String(Number(totalCost) / Number(shares));
      notes.push("Average cost calculated from total cost.");
    }
    if (shares === "" && !cells.some((cell) => /\d/.test(cell))) continue;
    rows.push({
      symbol: ticker,
      shares,
      avgCost,
      notes,
      source: line.words.map((w) => w.text).join(" "),
      confidence: Math.min(...line.words.map((w) => w.confidence ?? 90)),
    });
  }
  return { rows, columns, mapping: active };
}

export function reviewIssues(rows, existingHoldings = []) {
  const existing = new Map(existingHoldings.map((row) => [row.symbol, row]));
  const selected = rows.filter((row) => row.selected !== false),
    counts = new Map();
  selected.forEach((row) => {
    const symbol = String(row.symbol).trim().toUpperCase();
    counts.set(symbol, (counts.get(symbol) || 0) + 1);
  });
  return rows.map((row) => {
    if (row.selected === false) return [];
    const symbol = String(row.symbol).trim().toUpperCase(),
      issues = [];
    if (
      !symbol ||
      symbol.length > 15 ||
      !/^[A-Z0-9]+(?:[.-][A-Z0-9]+)*$/.test(symbol)
    )
      issues.push("Enter a valid ticker.");
    if (counts.get(symbol) > 1)
      issues.push("Duplicate ticker. Combine or remove the extra row.");
    if (parseAmount(row.shares) === "")
      issues.push("Enter the share quantity.");
    if (row.avgCost === "" || row.avgCost == null) {
      if (!existing.has(symbol))
        issues.push("Enter average cost for this new holding.");
    } else if (FOREIGN_CURRENCY.test(String(row.avgCost)))
      issues.push("Convert average cost to USD before importing.");
    else if (parseAmount(row.avgCost) === "")
      issues.push("Enter a valid average cost.");
    return issues;
  });
}
