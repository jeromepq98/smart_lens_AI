import { runRetention } from '../services/retentionService.js';
import { closePool } from '../config/db.js';

const dryRun = process.argv.includes('--dry-run');

const summary = await runRetention({ dryRun });
console.log(JSON.stringify(summary, null, 2));
await closePool();
