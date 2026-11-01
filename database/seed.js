import bcrypt from 'bcryptjs';
import config from '../config/env.js';
import { closePool, query } from '../config/db.js';
import { CATEGORY_SEED, SETTINGS_DEFAULTS } from '../config/defaults.js';

async function seedCategories() {
  for (const category of CATEGORY_SEED) {
    await query(
      `INSERT INTO categories (slug, name_en, name_fil, name_ceb, icon, sort_order, is_active)
       VALUES (?, ?, ?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE
         name_en = ?, name_fil = ?, name_ceb = ?, icon = ?, sort_order = ?, is_active = 1`,
      [
        category.slug,
        category.nameEn,
        category.nameFil,
        category.nameCeb,
        category.icon,
        category.sortOrder,
        category.nameEn,
        category.nameFil,
        category.nameCeb,
        category.icon,
        category.sortOrder,
      ],
    );
  }
  console.log(`Categories ready (${CATEGORY_SEED.length}).`);
}

async function seedSettings() {
  for (const [key, definition] of Object.entries(SETTINGS_DEFAULTS)) {
    await query(
      `INSERT IGNORE INTO system_settings (setting_key, setting_value, is_public)
       VALUES (?, ?, ?)`,
      [key, JSON.stringify(definition.value), definition.isPublic ? 1 : 0],
    );
  }
  console.log(`System settings ready (${Object.keys(SETTINGS_DEFAULTS).length} keys).`);
}

async function seedAdmin() {
  const rows = await query('SELECT id, username FROM admin_users ORDER BY id LIMIT 1');
  if (rows.length > 0) {
    console.log(`Administrator already exists ("${rows[0].username}"); password unchanged.`);
    return;
  }

  if (!config.admin.initialPassword) {
    console.warn(
      'No administrator created: set ADMIN_INITIAL_PASSWORD in .env (12+ characters) and run npm run db:seed.',
    );
    return;
  }

  const hash = await bcrypt.hash(config.admin.initialPassword, config.security.bcryptRounds);
  await query(
    `INSERT INTO admin_users (username, password_hash, display_name, is_active, must_change_password)
     VALUES (?, ?, ?, 1, 1)`,
    [config.admin.username, hash, 'Administrator'],
  );
  console.log(`Administrator "${config.admin.username}" created. The initial password comes from .env.`);
}

async function seedVersion() {
  await query(
    `INSERT INTO app_versions (version, notes, is_current)
     VALUES (?, ?, 1)
     ON DUPLICATE KEY UPDATE notes = VALUES(notes)`,
    [config.version, 'Initial SmartLens AI release'],
  );
  await query('UPDATE app_versions SET is_current = (version = ?)', [config.version]);
  console.log(`App version ${config.version} recorded.`);
}

async function main() {
  await seedCategories();
  await seedSettings();
  await seedAdmin();
  await seedVersion();
  console.log('Seed complete.');
}

main()
  .catch((error) => {
    console.error(`Seed failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
