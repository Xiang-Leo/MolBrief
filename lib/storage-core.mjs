import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { constants, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import path from "node:path";

export function storagePaths(dataDir = process.env.DATA_DIR || "./var") {
  const root = path.resolve(dataDir);
  return { root, database: path.join(root, "molbrief.sqlite"), audio: path.join(root, "audio") };
}

/** Migrations are immutable files; a changed applied migration is an error. */
export function migrateDatabase(connection, migrationsDir = process.env.MIGRATIONS_DIR || path.join(process.cwd(), "drizzle")) {
  const directory = path.resolve(migrationsDir);
  const names = readdirSync(directory).filter((name) => /^\d{4}_[a-zA-Z0-9_-]+\.sql$/.test(name)).sort();
  if (!names.length) throw new Error("No SQLite migration files found.");
  connection.exec("CREATE TABLE IF NOT EXISTS __molbrief_migrations (name TEXT PRIMARY KEY NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)");
  const applied = [];
  for (const name of names) {
    const sql = readFileSync(path.join(directory, name), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    connection.exec("BEGIN IMMEDIATE");
    try {
      const existing = connection.prepare("SELECT checksum FROM __molbrief_migrations WHERE name=?").get(name);
      if (existing) {
        if (existing.checksum !== checksum) throw new Error(`Applied migration changed: ${name}`);
      } else {
        connection.exec(sql);
        connection.prepare("INSERT INTO __molbrief_migrations(name,checksum,applied_at) VALUES(?,?,?)").run(name, checksum, new Date().toISOString());
        applied.push(name);
      }
      connection.exec("COMMIT");
    } catch (error) {
      connection.exec("ROLLBACK");
      throw error;
    }
  }
  return applied;
}

class LocalStatement {
  constructor(owner, sql, values = []) { this.owner = owner; this.sql = sql; this.values = values; }
  bind(...values) { return new LocalStatement(this.owner, this.sql, values); }
  first() { return this.owner.connection.prepare(this.sql).get(...this.values) ?? null; }
  all() { return { results: this.owner.connection.prepare(this.sql).all(...this.values) }; }
  run() {
    const result = this.owner.connection.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
  }
}

export class LocalDatabase {
  constructor({ dataDir, migrationsDir } = {}) {
    this.paths = storagePaths(dataDir);
    mkdirSync(this.paths.root, { recursive: true, mode: 0o700 });
    this.connection = new DatabaseSync(this.paths.database);
    try {
      this.connection.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
      this.appliedMigrations = migrateDatabase(this.connection, migrationsDir);
    } catch (error) {
      this.connection.close();
      throw error;
    }
  }
  prepare(sql) { return new LocalStatement(this, sql); }
  batch(statements) {
    if (statements.some((statement) => !(statement instanceof LocalStatement) || statement.owner !== this)) throw new Error("Batch statements must use the same database.");
    this.connection.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((statement) => statement.run());
      this.connection.exec("COMMIT");
      return results;
    } catch (error) {
      this.connection.exec("ROLLBACK");
      throw error;
    }
  }
  snapshotTo(destination) {
    if (existsSync(destination)) throw new Error("Backup destination already exists.");
    this.connection.prepare("VACUUM INTO ?").run(path.resolve(destination));
  }
  close() { this.connection.close(); }
}

/** Only generated content-addressed MP3 objects are addressable. */
export function audioObjectPath(objectKey, dataDir) {
  if (typeof objectKey !== "string" || !/^audio\/[a-f0-9]{64}\.mp3$/.test(objectKey)) throw new Error("Invalid audio object key.");
  return path.join(storagePaths(dataDir).audio, path.basename(objectKey));
}

export async function writeAudioObject(objectKey, bytes, dataDir) {
  const destination = audioObjectPath(objectKey, dataDir);
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, destination);
  } catch (error) {
    await handle?.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

export async function readAudioObject(objectKey, dataDir) {
  const filename = audioObjectPath(objectKey, dataDir);
  let handle;
  try {
    handle = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error("Audio object is not a regular file.");
    return new Uint8Array(await handle.readFile()).buffer;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  } finally {
    await handle?.close();
  }
}

export async function audioObjectExists(objectKey, dataDir) {
  const filename = audioObjectPath(objectKey, dataDir);
  let handle;
  try {
    handle = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    return (await handle.stat()).isFile();
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  } finally { await handle?.close(); }
}
