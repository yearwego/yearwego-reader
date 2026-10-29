import type { Database, SqlJsStatic, SqlValue } from 'sql.js';
import { ReaderError } from './errors';

export type SqlLoader = () => Promise<SqlJsStatic>;

export type Row = Record<string, SqlValue>;

export class BackupDatabase {
  private readonly db: Database;
  private readonly columnCache = new Map<string, Set<string>>();

  private constructor(db: Database) {
    this.db = db;
  }

  static async open(loadSql: SqlLoader, bytes: Uint8Array): Promise<BackupDatabase> {
    const SQL = await loadSql();
    let db: Database;
    try {
      db = new SQL.Database(bytes);
      db.exec('SELECT count(*) FROM sqlite_master');
    } catch (error) {
      throw new ReaderError('damaged', `The database did not open: ${String(error)}`);
    }
    return new BackupDatabase(db);
  }

  hasTable(table: string): boolean {
    return this.all('SELECT name FROM sqlite_master WHERE type = ? AND name = ?', [
      'table',
      table,
    ]).length > 0;
  }

  columns(table: string): Set<string> {
    let cached = this.columnCache.get(table);
    if (!cached) {
      cached = new Set(
        this.hasTable(table)
          ? this.all(`PRAGMA table_info("${table.replace(/"/g, '""')}")`).map((row) =>
              String(row.name),
            )
          : [],
      );
      this.columnCache.set(table, cached);
    }
    return cached;
  }

  /** `table.column AS alias` when the column exists, `NULL AS alias` when an older archive lacks it. */
  column(table: string, alias: string, column: string, as: string): string {
    return this.columns(table).has(column) ? `${alias}.${column} AS ${as}` : `NULL AS ${as}`;
  }

  all(sql: string, params: SqlValue[] = []): Row[] {
    const statement = this.db.prepare(sql);
    try {
      statement.bind(params);
      const rows: Row[] = [];
      while (statement.step()) rows.push(statement.getAsObject());
      return rows;
    } finally {
      statement.free();
    }
  }

  close(): void {
    this.db.close();
  }
}

export function asString(value: SqlValue | undefined): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? value : String(value);
}

export function asNumber(value: SqlValue | undefined): number | null {
  if (value === null || value === undefined) return null;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

export function asBytes(value: SqlValue | undefined): Uint8Array | null {
  return value instanceof Uint8Array ? value : null;
}
