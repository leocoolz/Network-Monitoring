import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pool, withTransaction } from "../db/pool.js";

const migrationsDirectory = resolve(process.cwd(), "migrations");

async function migrate() {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(100) PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);

  const files = (await readdir(migrationsDirectory)).filter((file) => file.endsWith(".sql")).sort();
  const applied = new Set((await pool.query("SELECT version FROM schema_migrations")).rows.map((row) => row.version));

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(resolve(migrationsDirectory, file), "utf8");
    await withTransaction(async (client) => {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [file]);
    });
    process.stdout.write(`Applied migration ${file}\n`);
  }
}

migrate()
  .then(() => pool.end())
  .catch(async (error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    await pool.end();
    process.exitCode = 1;
  });
