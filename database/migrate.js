import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';
import config, { rootDir } from '../config/env.js';

const migrationsDir = path.join(rootDir, 'database', 'migrations');

const connectionOptions = {
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  charset: 'utf8mb4',
  multipleStatements: true,
};

async function main() {
  const dbName = config.db.name;
  if (!/^[A-Za-z0-9_]{1,64}$/.test(dbName)) {
    throw new Error('DB_NAME contains unsupported characters.');
  }

  const serverConnection = await mysql.createConnection(connectionOptions);
  await serverConnection.query(
    `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
  await serverConnection.end();

  const connection = await mysql.createConnection({ ...connectionOptions, database: dbName });
  await connection.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      filename VARCHAR(255) NOT NULL,
      checksum CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (id),
      UNIQUE KEY uq_schema_migrations_filename (filename)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const files = (await fs.readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort();
  let applied = 0;

  for (const filename of files) {
    const sql = await fs.readFile(path.join(migrationsDir, filename), 'utf8');
    const checksum = crypto.createHash('sha256').update(sql).digest('hex');
    const [rows] = await connection.query(
      'SELECT checksum FROM schema_migrations WHERE filename = ?',
      [filename],
    );

    if (rows.length > 0) {
      if (rows[0].checksum !== checksum) {
        throw new Error(
          `Migration ${filename} was modified after being applied. Create a new migration instead.`,
        );
      }
      continue;
    }

    await connection.query(sql);
    await connection.query('INSERT INTO schema_migrations (filename, checksum) VALUES (?, ?)', [
      filename,
      checksum,
    ]);
    applied += 1;
    console.log(`Applied migration: ${filename}`);
  }

  await connection.end();
  console.log(
    applied === 0
      ? `Database "${dbName}" is up to date.`
      : `Database "${dbName}" migrated (${applied} migration${applied === 1 ? '' : 's'} applied).`,
  );
}

main().catch((error) => {
  console.error(`Migration failed: ${error.message}`);
  process.exit(1);
});
