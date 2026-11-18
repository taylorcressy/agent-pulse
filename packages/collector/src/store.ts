import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import {
  sessionSchema,
  usageSchema,
  type Session,
  type Usage,
} from "../../core/src/index";
import { parse } from "./io";

export class Store {
  readonly db: DatabaseSync;
  readonly fallback: boolean;
  constructor(path: string) {
    let db: DatabaseSync | undefined;
    try {
      if (path !== ":memory:")
        mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      db = new DatabaseSync(path);
      if (path !== ":memory:" && process.platform !== "win32")
        chmodSync(path, 0o600);
      this.migrate(db);
      this.fallback = false;
    } catch {
      db?.close();
      db = new DatabaseSync(":memory:");
      this.migrate(db);
      this.fallback = true;
    }
    this.db = db;
  }
  private migrate(db: DatabaseSync) {
    db.exec("PRAGMA busy_timeout=1000; PRAGMA journal_mode=WAL");
    if (Number(db.prepare("PRAGMA user_version").get()?.user_version) > 1)
      throw new Error("Newer database version");
    db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS files (key TEXT PRIMARY KEY, identity TEXT, offset INTEGER, metadata TEXT);
      CREATE TABLE IF NOT EXISTS sessions (key TEXT PRIMARY KEY, time INTEGER, value TEXT);
      CREATE TABLE IF NOT EXISTS usage (key TEXT PRIMARY KEY, time INTEGER, value TEXT);
      CREATE INDEX IF NOT EXISTS sessions_time ON sessions(time);
      CREATE INDEX IF NOT EXISTS usage_time ON usage(time);
      PRAGMA user_version=1;
      COMMIT`);
  }
  checkpoint(key: string) {
    const row = this.db
      .prepare("SELECT identity,offset,metadata FROM files WHERE key=?")
      .get(key);
    if (!row) return;
    return {
      identity: String(row.identity),
      offset: Number(row.offset),
      metadata: parse(String(row.metadata)),
    };
  }
  write(
    key: string,
    identity: string,
    offset: number,
    metadata: unknown,
    session: Session | undefined,
    events: Usage[],
  ) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const insert = this.db.prepare(
        "INSERT INTO usage VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET time=excluded.time,value=excluded.value WHERE excluded.time>=usage.time",
      );
      for (const event of events)
        insert.run(
          event.id,
          event.source.observedAt ?? 0,
          JSON.stringify(event),
        );
      if (session)
        this.db
          .prepare(
            "INSERT INTO sessions VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET time=excluded.time,value=excluded.value WHERE excluded.time>=sessions.time",
          )
          .run(
            session.id,
            session.source.observedAt ?? 0,
            JSON.stringify(session),
          );
      this.db
        .prepare("INSERT OR REPLACE INTO files VALUES(?,?,?,?)")
        .run(key, identity, offset, JSON.stringify(metadata));
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  recent() {
    const sessions = this.db
      .prepare("SELECT value FROM sessions ORDER BY time DESC LIMIT 250")
      .all()
      .flatMap((row) => {
        const value = sessionSchema.safeParse(parse(String(row.value)));
        return value.success ? [value.data] : [];
      });
    const usage = this.db
      .prepare("SELECT value FROM usage ORDER BY time DESC LIMIT 5000")
      .all()
      .flatMap((row) => {
        const value = usageSchema.safeParse(parse(String(row.value)));
        return value.success ? [value.data] : [];
      });
    return { sessions, usage };
  }
  prune(now: number) {
    const cutoff = now - 90 * 86400000;
    for (const table of ["sessions", "usage"]) {
      this.db
        .prepare(`DELETE FROM ${table} WHERE time>0 AND time<?`)
        .run(cutoff);
      this.db.exec(
        `DELETE FROM ${table} WHERE key IN (SELECT key FROM ${table} ORDER BY time DESC LIMIT -1 OFFSET 100000)`,
      );
    }
    this.db.exec(
      "DELETE FROM files WHERE key IN (SELECT key FROM files ORDER BY rowid DESC LIMIT -1 OFFSET 10000)",
    );
  }
}
