// A small RFC 4180 CSV reader/writer for bulk link import/export, so no parser dependency is needed.

/** CSV text → rows. Handles quoted cells, "" escapes, CRLF/LF, newlines inside quotes and a UTF-8 BOM. */
export function parseCsv(text: string): string[][] {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (s[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const formulaStart = /^[=+\-@\t\r]/;

/** Rows → CSV. Cells a spreadsheet would run as a formula get a leading ' (CSV-injection guard). */
export function toCsv(rows: unknown[][]): string {
  return rows.map((r) => r.map((v) => {
    let s = v == null ? '' : String(v);
    if (formulaStart.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\r\n');
}
