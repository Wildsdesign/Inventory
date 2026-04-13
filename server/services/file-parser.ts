/**
 * File parser — reads CSV or Excel files and returns normalized rows.
 *
 * Supported formats: .csv, .xlsx, .xls
 * Returns: { headers: string[], rows: Record<string, string>[] }
 */

import { log } from '../utils/logger';

export interface ParsedFile {
  headers: string[];
  rows: Record<string, string>[];
}

/**
 * Parse a CSV string into headers + rows.
 * Handles quoted fields with commas and escaped double quotes.
 */
export function parseCsv(text: string): ParsedFile {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };

  function parseLine(line: string): string[] {
    const fields: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') { current += '"'; i++; }
          else inQuotes = false;
        } else {
          current += ch;
        }
      } else {
        if (ch === ',') { fields.push(current); current = ''; }
        else if (ch === '"') { inQuotes = true; }
        else { current += ch; }
      }
    }
    fields.push(current);
    return fields;
  }

  const headers = parseLine(lines[0]).map((h) => h.trim());
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((header, idx) => {
      row[header] = (values[idx] || '').trim();
    });
    // Skip fully empty rows
    if (Object.values(row).some((v) => v.length > 0)) {
      rows.push(row);
    }
  }

  return { headers, rows };
}

/**
 * Parse file content (base64 or raw string) based on file extension.
 * For CSV: fileContent is the raw CSV string.
 * For XLSX/XLS: fileContent is a base64-encoded binary.
 */
export function parseFile(fileContent: string, fileName: string): ParsedFile {
  const ext = fileName.split('.').pop()?.toLowerCase();

  if (ext === 'csv') {
    return parseCsv(fileContent);
  }

  if (ext === 'xlsx' || ext === 'xls') {
    try {
      // Dynamic import to avoid bundling issues
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const XLSX = require('xlsx') as typeof import('xlsx');
      const buffer = Buffer.from(fileContent, 'base64');
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json<unknown>(worksheet, {
        header: 1,
        defval: '',
      }) as Array<Array<unknown>>;

      if (jsonData.length === 0) return { headers: [], rows: [] };

      const headers = (jsonData[0] as Array<unknown>)
        .map((h) => String(h ?? '').trim())
        .filter((h) => h.length > 0);

      const rows: Record<string, string>[] = [];
      for (let i = 1; i < jsonData.length; i++) {
        const rawRow = jsonData[i] as Array<unknown>;
        const row: Record<string, string> = {};
        headers.forEach((header, idx) => {
          row[header] = String(rawRow[idx] ?? '').trim();
        });
        if (Object.values(row).some((v) => v.length > 0)) {
          rows.push(row);
        }
      }

      return { headers, rows };
    } catch (error) {
      log.error(error, { operation: 'parseExcel', fileName });
      return { headers: [], rows: [] };
    }
  }

  log.warn(`Unsupported file extension: ${ext}`);
  return { headers: [], rows: [] };
}
