-- SmartLens AI - canonical database schema (migration 001)
-- Target: MySQL 8 and MariaDB 10.4+ (utf8mb4, InnoDB)
-- No public user tables: only anonymous scan sessions and protected administrators.

CREATE TABLE IF NOT EXISTS schema_migrations (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  filename VARCHAR(255) NOT NULL,
  checksum CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_schema_migrations_filename (filename)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS categories (
  id SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug VARCHAR(40) NOT NULL,
  name_en VARCHAR(80) NOT NULL,
  name_fil VARCHAR(80) NOT NULL,
  name_ceb VARCHAR(80) NOT NULL,
  icon VARCHAR(40) NOT NULL DEFAULT 'bi-collection',
  sort_order TINYINT UNSIGNED NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_categories_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_users (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  username VARCHAR(60) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(120) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  must_change_password TINYINT(1) NOT NULL DEFAULT 1,
  failed_attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  locked_until DATETIME(3) NULL,
  last_login_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_admin_users_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_sessions (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  admin_id INT UNSIGNED NOT NULL,
  csrf_secret CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  ip_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  user_agent VARCHAR(255) NULL,
  expires_at DATETIME(3) NOT NULL,
  last_seen_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_admin_sessions_token (token_hash),
  KEY idx_admin_sessions_admin (admin_id),
  KEY idx_admin_sessions_expires (expires_at),
  CONSTRAINT fk_admin_sessions_admin FOREIGN KEY (admin_id) REFERENCES admin_users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS scans (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  anonymous_session_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  idempotency_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  category_id SMALLINT UNSIGNED NULL,
  source ENUM('camera', 'upload') NOT NULL DEFAULT 'upload',
  language CHAR(5) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'en',
  status ENUM('pending', 'processing', 'completed', 'failed') NOT NULL DEFAULT 'pending',
  error_code VARCHAR(60) NULL,
  has_image TINYINT(1) NOT NULL DEFAULT 0,
  expires_at DATETIME(3) NULL,
  deleted_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_scans_idempotency (anonymous_session_id, idempotency_key),
  KEY idx_scans_session_created (anonymous_session_id, created_at),
  KEY idx_scans_category (category_id),
  KEY idx_scans_status_created (status, created_at),
  KEY idx_scans_expires (expires_at),
  CONSTRAINT fk_scans_category FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS scan_images (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  scan_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  storage_provider ENUM('local', 's3') NOT NULL DEFAULT 'local',
  storage_key VARCHAR(255) NOT NULL,
  mime_type ENUM('image/jpeg', 'image/png', 'image/webp') NOT NULL,
  original_filename VARCHAR(255) NULL,
  width SMALLINT UNSIGNED NOT NULL,
  height SMALLINT UNSIGNED NOT NULL,
  byte_size INT UNSIGNED NOT NULL,
  sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_scan_images_scan (scan_id),
  KEY idx_scan_images_sha256 (sha256),
  CONSTRAINT fk_scan_images_scan FOREIGN KEY (scan_id) REFERENCES scans (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_results (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  scan_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  is_current TINYINT(1) NOT NULL DEFAULT 1,
  model VARCHAR(80) NOT NULL,
  prompt_version VARCHAR(20) NOT NULL,
  locale CHAR(5) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  main_identification VARCHAR(200) NOT NULL,
  category_slug VARCHAR(40) NOT NULL,
  scientific_name VARCHAR(200) NULL,
  confidence ENUM('high', 'moderate', 'low') NOT NULL,
  description TEXT NOT NULL,
  characteristics JSON NOT NULL,
  common_uses JSON NOT NULL,
  interesting_facts JSON NOT NULL,
  safety JSON NOT NULL,
  alternatives JSON NOT NULL,
  observations JSON NOT NULL,
  assumptions JSON NOT NULL,
  follow_up_questions JSON NOT NULL,
  uncertainty_notes TEXT NULL,
  tokens_in INT UNSIGNED NOT NULL DEFAULT 0,
  tokens_out INT UNSIGNED NOT NULL DEFAULT 0,
  latency_ms INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_ai_results_scan_version (scan_id, version),
  KEY idx_ai_results_scan_current (scan_id, is_current),
  CONSTRAINT fk_ai_results_scan FOREIGN KEY (scan_id) REFERENCES scans (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS recommendations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  scan_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  ai_result_id BIGINT UNSIGNED NOT NULL,
  kind ENUM('care', 'recipe', 'usage', 'maintenance', 'safety', 'activity', 'other') NOT NULL,
  title VARCHAR(160) NOT NULL,
  body TEXT NOT NULL,
  priority TINYINT UNSIGNED NOT NULL DEFAULT 0,
  locale CHAR(5) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_recommendations_result_priority (ai_result_id, priority),
  KEY idx_recommendations_scan (scan_id),
  CONSTRAINT fk_recommendations_scan FOREIGN KEY (scan_id) REFERENCES scans (id) ON DELETE CASCADE,
  CONSTRAINT fk_recommendations_ai_result FOREIGN KEY (ai_result_id) REFERENCES ai_results (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS conversations (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  scan_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  anonymous_session_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_conversations_scan (scan_id),
  KEY idx_conversations_session (anonymous_session_id),
  CONSTRAINT fk_conversations_scan FOREIGN KEY (scan_id) REFERENCES scans (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  conversation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  role ENUM('user', 'assistant') NOT NULL,
  content MEDIUMTEXT NOT NULL,
  locale CHAR(5) CHARACTER SET ascii COLLATE ascii_bin NULL,
  model VARCHAR(80) NULL,
  tokens_in INT UNSIGNED NOT NULL DEFAULT 0,
  tokens_out INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_messages_conversation_created (conversation_id, created_at),
  CONSTRAINT fk_messages_conversation FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS system_settings (
  setting_key VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  setting_value JSON NOT NULL,
  is_public TINYINT(1) NOT NULL DEFAULT 0,
  updated_by INT UNSIGNED NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (setting_key),
  CONSTRAINT fk_system_settings_updated_by FOREIGN KEY (updated_by) REFERENCES admin_users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS usage_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  anonymous_session_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  scan_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  kind ENUM('vision', 'chat', 'learning', 'other') NOT NULL,
  endpoint VARCHAR(80) NULL,
  model VARCHAR(80) NULL,
  tokens_in INT UNSIGNED NOT NULL DEFAULT 0,
  tokens_out INT UNSIGNED NOT NULL DEFAULT 0,
  estimated_cost_usd DECIMAL(12,6) NOT NULL DEFAULT 0,
  status ENUM('success', 'error') NOT NULL,
  error_code VARCHAR(60) NULL,
  latency_ms INT UNSIGNED NULL,
  ip_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_usage_created (created_at),
  KEY idx_usage_status_created (status, created_at),
  KEY idx_usage_session_created (anonymous_session_id, created_at),
  KEY idx_usage_scan (scan_id),
  CONSTRAINT fk_usage_logs_scan FOREIGN KEY (scan_id) REFERENCES scans (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  admin_id INT UNSIGNED NULL,
  action VARCHAR(60) NOT NULL,
  entity VARCHAR(40) NULL,
  entity_id VARCHAR(64) NULL,
  metadata JSON NULL,
  ip_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_audit_logs_admin_created (admin_id, created_at),
  KEY idx_audit_logs_action_created (action, created_at),
  CONSTRAINT fk_audit_logs_admin FOREIGN KEY (admin_id) REFERENCES admin_users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS app_versions (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  version VARCHAR(20) NOT NULL,
  released_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  notes TEXT NULL,
  is_current TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_app_versions_version (version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sync_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  anonymous_session_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  scan_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  client_scan_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  action ENUM('queue', 'sync', 'duplicate', 'error') NOT NULL,
  status VARCHAR(20) NOT NULL,
  detail VARCHAR(255) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_sync_logs_session_created (anonymous_session_id, created_at),
  KEY idx_sync_logs_scan (scan_id),
  CONSTRAINT fk_sync_logs_scan FOREIGN KEY (scan_id) REFERENCES scans (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS error_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  level ENUM('warn', 'error', 'fatal') NOT NULL DEFAULT 'error',
  code VARCHAR(60) NULL,
  message VARCHAR(1000) NOT NULL,
  path VARCHAR(255) NULL,
  metadata JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_error_logs_created (created_at),
  KEY idx_error_logs_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  anonymous_session_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  endpoint_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  subscription JSON NOT NULL,
  user_agent VARCHAR(255) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_push_subscriptions_endpoint (endpoint_hash),
  KEY idx_push_subscriptions_session (anonymous_session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
