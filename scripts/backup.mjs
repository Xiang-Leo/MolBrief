import { mkdir, readdir, copyFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { LocalDatabase, storagePaths } from "../lib/storage-core.mjs";

// Usage: node --env-file=.env scripts/backup.mjs [backup-parent-directory]
// A SQLite snapshot includes committed WAL data. Audio files are immutable.
const parent = path.resolve(process.argv[2] || path.join(storagePaths().root, "backups"));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const destination = path.join(parent, `molbrief-${stamp}-${randomUUID().slice(0,8)}`);
await mkdir(destination, { recursive: true, mode: 0o700 });
const database = new LocalDatabase();
try {
  database.snapshotTo(path.join(destination, "molbrief.sqlite"));
  await mkdir(path.join(destination, "audio"), { mode: 0o700 });
  let audioCount = 0;
  const objects = await readdir(database.paths.audio, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  for (const object of objects) {
    if (!object.isFile() || !/^[a-f0-9]{64}\.mp3$/.test(object.name)) continue;
    await copyFile(path.join(database.paths.audio, object.name), path.join(destination, "audio", object.name));
    audioCount++;
  }
  await writeFile(path.join(destination, "backup.json"), JSON.stringify({ version: 1, createdAt: new Date().toISOString(), audioCount, includesSecrets: false }, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify({ destination, audioCount, secretsIncluded: false }));
} finally { database.close(); }
