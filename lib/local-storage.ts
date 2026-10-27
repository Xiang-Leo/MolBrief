import { LocalDatabase, audioObjectExists, readAudioObject, storagePaths, writeAudioObject } from "./storage-core.mjs";

export interface LocalRunResult {
  success: boolean;
  meta: { changes: number; last_row_id: number };
}
export interface LocalPreparedStatement {
  bind(...values: (string | number | bigint | Uint8Array | null)[]): LocalPreparedStatement;
  first<T = Record<string, unknown>>(): T | null;
  all<T = Record<string, unknown>>(): { results: T[] };
  run(): LocalRunResult;
}
export interface LocalDatabaseAdapter {
  prepare(sql: string): LocalPreparedStatement;
  batch(statements: LocalPreparedStatement[]): LocalRunResult[];
}

const databases = globalThis as typeof globalThis & { __molbriefDatabases?: Map<string, LocalDatabaseAdapter> };

export function getDatabase(): LocalDatabaseAdapter {
  const key = storagePaths().database;
  databases.__molbriefDatabases ??= new Map();
  let database = databases.__molbriefDatabases.get(key);
  if (!database) {
    database = new LocalDatabase() as unknown as LocalDatabaseAdapter;
    databases.__molbriefDatabases.set(key, database);
  }
  return database;
}

export { audioObjectExists, readAudioObject, storagePaths, writeAudioObject };
