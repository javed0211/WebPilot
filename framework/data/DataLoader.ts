import * as fs from 'fs';
import * as path from 'path';
import { config } from '@config/ConfigManager';

export class DataLoader {
  /**
   * Loads a JSON file from either root data/ or framework/data/ directory.
   */
  public static loadJson<T = any>(filename: string): T {
    const searchPaths = [
      path.join(process.cwd(), 'data', filename),
      path.join(process.cwd(), 'framework', 'data', filename),
      path.join(process.cwd(), 'data', config.environment, filename),
      path.join(process.cwd(), 'framework', 'data', config.environment, filename),
    ];

    for (const p of searchPaths) {
      if (fs.existsSync(p)) {
        try {
          const raw = fs.readFileSync(p, 'utf8');
          return JSON.parse(raw) as T;
        } catch (err: any) {
          throw new Error(`Failed to parse JSON file at ${p}: ${err.message}`);
        }
      }
    }

    throw new Error(`Data file "${filename}" not found in any standard data directories.`);
  }

  /**
   * Basic CSV parser to support data-driven testing.
   */
  public static loadCsv(filename: string): Record<string, string>[] {
    const searchPaths = [
      path.join(process.cwd(), 'data', filename),
      path.join(process.cwd(), 'framework', 'data', filename),
    ];

    let filePath = '';
    for (const p of searchPaths) {
      if (fs.existsSync(p)) {
        filePath = p;
        break;
      }
    }

    if (!filePath) {
      throw new Error(`CSV file "${filename}" not found.`);
    }

    const raw = fs.readFileSync(filePath, 'utf8').trim();
    const lines = raw.split(/\r?\n/);
    if (lines.length === 0 || !lines[0]) {
      return [];
    }

    const headers = lines[0].split(',').map(h => h.trim());
    const results: Record<string, string>[] = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      
      const values = line.split(',').map(v => v.trim());
      const row: Record<string, string> = {};
      
      headers.forEach((header, index) => {
        row[header] = values[index] !== undefined ? values[index] : '';
      });
      
      results.push(row);
    }

    return results;
  }
}
