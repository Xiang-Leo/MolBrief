import { LocalDatabase } from "../lib/storage-core.mjs";

const database = new LocalDatabase();
console.log(JSON.stringify({ database: database.paths.database, applied: database.appliedMigrations, status: "ready" }));
database.close();
