import { execFileSync } from 'node:child_process';
import path from 'node:path';
import mysql from 'mysql2/promise';
import config, { rootDir } from '../config/env.js';

if (!process.argv.includes('--yes')) {
  console.error('Refusing to reset. Re-run with: npm run db:reset -- --yes');
  process.exit(1);
}

if (config.isProd) {
  console.error('Refusing to reset a production database.');
  process.exit(1);
}

if (!/^[A-Za-z0-9_]{1,64}$/.test(config.db.name)) {
  console.error('DB_NAME contains unsupported characters.');
  process.exit(1);
}

const connection = await mysql.createConnection({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
});

await connection.query(`DROP DATABASE IF EXISTS \`${config.db.name}\``);
await connection.end();
console.log(`Dropped database "${config.db.name}".`);

execFileSync(process.execPath, [path.join(rootDir, 'database', 'migrate.js')], { stdio: 'inherit' });
execFileSync(process.execPath, [path.join(rootDir, 'database', 'seed.js')], { stdio: 'inherit' });
