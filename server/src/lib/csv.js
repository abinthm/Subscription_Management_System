function cell(value) {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const CSV_LIMIT = 10_000;

export function sendCsv(res, filename, columns, rows) {
  const lines = [columns.map(([header]) => cell(header)).join(',')];
  for (const row of rows) lines.push(columns.map(([, key]) => cell(row[key])).join(','));
  res.set({
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}-${new Date().toISOString().slice(0, 10)}.csv"`,
  });
  res.send(`﻿${lines.join('\r\n')}\r\n`);
}

export const wantsCsv = (req) => req.query.format === 'csv';
