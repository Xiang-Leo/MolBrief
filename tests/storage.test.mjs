import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, cp, appendFile, rm, readFile, stat, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { LocalDatabase, audioObjectPath, audioObjectExists, readAudioObject, writeAudioObject } from "../lib/storage-core.mjs";

async function fixture(t) {
  const root=await mkdtemp(path.join(os.tmpdir(), "molbrief-storage-"));
  const migrationsDir=path.join(root,"migrations");
  await cp(new URL("../drizzle/",import.meta.url),migrationsDir,{recursive:true});
  t.after(()=>rm(root,{recursive:true,force:true}));
  return {root,dataDir:path.join(root,"data"),migrationsDir};
}

test("fresh migrations apply once and persisted articles survive reopening",async t=>{
  const options=await fixture(t);
  let database=new LocalDatabase(options);
  assert.equal(database.appliedMigrations.length,1);
  database.prepare("INSERT INTO articles(id,canonical_url,payload,collected_at) VALUES(?,?,?,?)").bind("saved-article","https://example.org/paper","{}","2026-10-27").run();
  database.close();
  database=new LocalDatabase(options);
  assert.equal(database.appliedMigrations.length,0);
  assert.equal(database.prepare("SELECT count(*) AS n FROM __molbrief_migrations").first().n,1);
  assert.equal(database.prepare("SELECT canonical_url FROM articles WHERE id=?").bind("saved-article").first().canonical_url,"https://example.org/paper");
  database.close();
});

test("batch rollback prevents partially saved article groups",async t=>{
  const options=await fixture(t), database=new LocalDatabase(options);
  const sql="INSERT INTO articles(id,canonical_url,payload,collected_at) VALUES(?,?,?,?)";
  assert.throws(()=>database.batch([
    database.prepare(sql).bind("one","https://example.org/same","{}","2026-10-27"),
    database.prepare(sql).bind("two","https://example.org/same","{}","2026-10-27"),
  ]),/UNIQUE/);
  assert.equal(database.prepare("SELECT count(*) AS n FROM articles").first().n,0);
  database.close();
});

test("an applied migration cannot silently change",async t=>{
  const options=await fixture(t), database=new LocalDatabase(options);
  database.close();
  await appendFile(path.join(options.migrationsDir,"0000_puzzling_ben_parker.sql"),"\n-- modified\n");
  assert.throws(()=>new LocalDatabase(options),/Applied migration changed/);
});

test("failed migration rolls back its schema and version entry",async t=>{
  const options=await fixture(t);
  await appendFile(path.join(options.migrationsDir,"0001_invalid.sql"),"CREATE TABLE rollback_probe(id TEXT);\nINVALID SQL HERE;\n");
  assert.throws(()=>new LocalDatabase(options));
  const raw=new DatabaseSync(path.join(options.dataDir,"molbrief.sqlite"));
  assert.equal(raw.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='rollback_probe'").get().n,0);
  assert.equal(raw.prepare("SELECT count(*) AS n FROM __molbrief_migrations WHERE name='0001_invalid.sql'").get().n,0);
  raw.close();
});

test("audio writes are atomic and keys cannot escape the data directory",async t=>{
  const {dataDir}=await fixture(t), key="audio/"+"a".repeat(64)+".mp3";
  for(const invalid of ["../outside.mp3","audio/../../outside.mp3","audio/%2e%2e%2fsecret", "A".repeat(64)+".mp3"])
    assert.throws(()=>audioObjectPath(invalid,dataDir),/Invalid audio/);
  assert.equal(await audioObjectExists(key,dataDir),false);
  assert.equal(await readAudioObject(key,dataDir),null);
  const bytes=new Uint8Array([73,68,51,1,2,3]);
  await writeAudioObject(key,bytes,dataDir);
  assert.equal(await audioObjectExists(key,dataDir),true);
  assert.deepEqual(new Uint8Array(await readAudioObject(key,dataDir)),bytes);
  assert.equal((await stat(audioObjectPath(key,dataDir))).mode&0o777,0o600);
});

test("audio reads do not follow a substituted file symlink",async t=>{
  const {root,dataDir}=await fixture(t), key="audio/"+"b".repeat(64)+".mp3";
  await mkdir(path.join(dataDir,"audio"),{recursive:true});
  const external=path.join(root,"not-audio.txt");
  await appendFile(external,"outside file");
  await symlink(external,audioObjectPath(key,dataDir));
  await assert.rejects(readAudioObject(key,dataDir));
});

test("SQLite snapshot includes committed WAL data without overwriting old backups",async t=>{
  const options=await fixture(t), database=new LocalDatabase(options);
  database.prepare("INSERT INTO preferences(user_id,payload) VALUES(?,?)").bind("owner",'{"speed":1.2}').run();
  const destination=path.join(options.root,"snapshot.sqlite");
  database.snapshotTo(destination);
  assert.throws(()=>database.snapshotTo(destination),/already exists/);
  const snapshot=new DatabaseSync(destination,{readOnly:true});
  assert.equal(snapshot.prepare("SELECT payload FROM preferences WHERE user_id='owner'").get().payload,'{"speed":1.2}');
  snapshot.close();database.close();
});
