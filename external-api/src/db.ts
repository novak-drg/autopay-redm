import mysql, { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { config } from './config.js';

export const pool = mysql.createPool({
  host: config.mysqlHost,
  port: config.mysqlPort,
  user: config.mysqlUser,
  password: config.mysqlPassword,
  database: config.mysqlDatabase,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

export const ensureTables = async (): Promise<void> => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id            VARCHAR(64)       NOT NULL,
      label         VARCHAR(255)      NOT NULL,
      description   TEXT              NOT NULL DEFAULT '',
      currency      VARCHAR(32)       NOT NULL DEFAULT 'real_money',
      amount_cents  INT UNSIGNED      NOT NULL DEFAULT 0,
      display_price VARCHAR(64)       NOT NULL DEFAULT '',
      diamond_cost  INT UNSIGNED      NULL,
      image         VARCHAR(512)      NOT NULL DEFAULT '',
      category      VARCHAR(64)       NOT NULL DEFAULT '',
      bonus         INT UNSIGNED      NULL,
      reward_json   JSON              NOT NULL,
      sort_order    INT UNSIGNED      NOT NULL DEFAULT 0,
      active        TINYINT(1)        NOT NULL DEFAULT 1,
      created_at    DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at    DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_category_active (category, active),
      INDEX idx_sort (sort_order)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS pix_charges (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      internal_charge_id VARCHAR(64) NOT NULL,
      idempotency_key VARCHAR(150) NOT NULL,
      external_reference VARCHAR(100) NOT NULL,
      gateway_name VARCHAR(50) NOT NULL,
      gateway_charge_id VARCHAR(120) NOT NULL,
      player_identifier VARCHAR(120) NOT NULL,
      product_id VARCHAR(64) NOT NULL,
      amount_cents INT UNSIGNED NOT NULL,
      currency CHAR(3) NOT NULL DEFAULT 'BRL',
      status VARCHAR(16) NOT NULL,
      transaction_id VARCHAR(120) NULL,
      end_to_end_id VARCHAR(120) NULL,
      qr_code_base64 LONGTEXT NOT NULL,
      qr_code_text TEXT NOT NULL,
      metadata_json JSON NULL,
      expires_at DATETIME NOT NULL,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      delivered_at DATETIME NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uk_internal_charge_id (internal_charge_id),
      UNIQUE KEY uk_idempotency_key (idempotency_key),
      UNIQUE KEY uk_external_reference (external_reference),
      INDEX idx_player_status (player_identifier, status),
      INDEX idx_updated_at (updated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // Replay-attack prevention: stores processed endToEndIds for 24h
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pix_processed_events (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      end_to_end_id VARCHAR(120) NOT NULL,
      charge_id VARCHAR(64) NOT NULL,
      processed_at DATETIME NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uk_e2e_id (end_to_end_id),
      INDEX idx_processed_at (processed_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // Offline reward queue: deliver rewards to players who were offline at payment time
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pending_rewards (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      player_identifier VARCHAR(120) NOT NULL,
      charge_id VARCHAR(64) NOT NULL,
      product_id VARCHAR(64) NOT NULL,
      reward_json JSON NOT NULL,
      issued_at DATETIME NOT NULL,
      delivered_at DATETIME NULL,
      PRIMARY KEY (id),
      INDEX idx_identifier_delivered (player_identifier, delivered_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id              BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
      username        VARCHAR(64)      NOT NULL,
      password_hash   VARCHAR(255)     NOT NULL,
      role            ENUM('super_admin','admin') NOT NULL DEFAULT 'admin',
      is_active       TINYINT(1)       NOT NULL DEFAULT 1,
      last_login_at   DATETIME         NULL,
      failed_attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
      locked_until    DATETIME         NULL,
      created_at      DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at      DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_username (username)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_refresh_tokens (
      id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id     BIGINT UNSIGNED NOT NULL,
      token_hash  VARCHAR(255)    NOT NULL,
      ip_address  VARCHAR(45)     NULL,
      expires_at  DATETIME        NOT NULL,
      revoked     TINYINT(1)      NOT NULL DEFAULT 0,
      created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_token_hash (token_hash),
      INDEX idx_user_revoked (user_id, revoked),
      INDEX idx_expires (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_audit_log (
      id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id     BIGINT UNSIGNED NULL,
      username    VARCHAR(64)     NULL,
      action      VARCHAR(80)     NOT NULL,
      ip_address  VARCHAR(45)     NULL,
      details     JSON            NULL,
      created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_user_action (user_id, action),
      INDEX idx_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS product_categories (
      id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
      slug       VARCHAR(64)  NOT NULL,
      label      VARCHAR(128) NOT NULL,
      sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
      active     TINYINT(1)   NOT NULL DEFAULT 1,
      created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_slug (slug)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // ── Coupons ────────────────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS coupons (
      id                          INT UNSIGNED    NOT NULL AUTO_INCREMENT,
      code                        VARCHAR(50)     NOT NULL,
      description                 VARCHAR(255)    NOT NULL DEFAULT '',
      discount_percent            DECIMAL(5,2)    NOT NULL,
      max_uses                    INT UNSIGNED    NULL,
      uses_count                  INT UNSIGNED    NOT NULL DEFAULT 0,
      min_amount_cents            INT UNSIGNED    NULL,
      product_rule                ENUM('all','whitelist','blacklist') NOT NULL DEFAULT 'all',
      referrer_id                 VARCHAR(120)    NULL,
      referrer_name               VARCHAR(120)    NULL,
      referrer_commission_percent DECIMAL(5,2)    NULL,
      active                      TINYINT(1)      NOT NULL DEFAULT 1,
      expires_at                  DATETIME        NULL,
      created_at                  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at                  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_code (code),
      INDEX idx_active_code (active, code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS coupon_products (
      coupon_id  INT UNSIGNED NOT NULL,
      product_id VARCHAR(64)  NOT NULL,
      PRIMARY KEY (coupon_id, product_id),
      INDEX idx_product (product_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS coupon_usage (
      id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      coupon_id             INT UNSIGNED    NOT NULL,
      charge_id             VARCHAR(64)     NOT NULL,
      player_identifier     VARCHAR(120)    NOT NULL,
      product_id            VARCHAR(64)     NOT NULL,
      original_amount_cents INT UNSIGNED    NOT NULL,
      discount_amount_cents INT UNSIGNED    NOT NULL,
      final_amount_cents    INT UNSIGNED    NOT NULL,
      commission_cents      INT UNSIGNED    NULL,
      created_at            DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_charge (charge_id),
      INDEX idx_coupon (coupon_id),
      INDEX idx_player (player_identifier),
      INDEX idx_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // ── Players (pre-cadastro para pagamentos PIX) ──────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS players (
      id                 BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
      player_identifier  VARCHAR(120)     NOT NULL,
      email              VARCHAR(255)     NOT NULL,
      cpf                VARCHAR(20)      NOT NULL,
      full_name          VARCHAR(255)     NOT NULL,
      registered_at      DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at         DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_identifier (player_identifier),
      INDEX idx_email (email)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // Fixed column names only. Do not swallow migration failures.
  for (const [column, definition] of [
    ['coupon_id', 'INT UNSIGNED NULL'],
    ['discount_amount_cents', 'INT UNSIGNED NOT NULL DEFAULT 0'],
    ['delivered_at', 'DATETIME NULL'],
  ]) {
    const [columns] = await pool.query<RowDataPacket[]>(
      'SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
      ['pix_charges', column]);
    if (!columns.length) await pool.query(`ALTER TABLE pix_charges ADD COLUMN ${column} ${definition}`);
  }
  await pool.query(`CREATE TABLE IF NOT EXISTS payment_outbox (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    event_key VARCHAR(160) NOT NULL UNIQUE,
    charge_id VARCHAR(64) NOT NULL,
    payload_json JSON NOT NULL,
    attempts INT UNSIGNED NOT NULL DEFAULT 0,
    next_attempt_at DATETIME NOT NULL,
    locked_by VARCHAR(36) NULL,
    locked_until DATETIME NULL,
    delivered_at DATETIME NULL,
    INDEX idx_due (delivered_at, next_attempt_at), INDEX idx_charge_order (charge_id, id, delivered_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await pool.query(`CREATE TABLE IF NOT EXISTS service_nonces (
    nonce CHAR(64) PRIMARY KEY, expires_at DATETIME NOT NULL, INDEX idx_expiry (expires_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // ── Boxes (caixas) ──────────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS boxes (
      id            VARCHAR(64)   NOT NULL,
      name          VARCHAR(255)  NOT NULL,
      description   TEXT          NOT NULL DEFAULT '',
      currency      VARCHAR(32)   NOT NULL DEFAULT 'diamond',
      price         INT UNSIGNED  NOT NULL DEFAULT 0,
      display_price VARCHAR(64)   NOT NULL DEFAULT '',
      color         VARCHAR(20)   NOT NULL DEFAULT '#4dd0e1',
      image         VARCHAR(512)  NOT NULL DEFAULT '',
      sort_order    INT UNSIGNED  NOT NULL DEFAULT 0,
      active        TINYINT(1)    NOT NULL DEFAULT 1,
      created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_active_sort (active, sort_order)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS box_items (
      id          BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
      box_id      VARCHAR(64)      NOT NULL,
      item_id     VARCHAR(80)      NOT NULL,
      item_name   VARCHAR(200)     NOT NULL,
      rarity      ENUM('common','uncommon','rare','epic','legendary') NOT NULL DEFAULT 'common',
      image       VARCHAR(512)     NOT NULL DEFAULT '',
      chance_pct  DECIMAL(7,3)     NOT NULL DEFAULT 0.000,
      locked      TINYINT(1)       NOT NULL DEFAULT 0,
      reward_json JSON             NOT NULL,
      sort_order  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
      PRIMARY KEY (id),
      UNIQUE KEY uk_box_item (box_id, item_id),
      INDEX idx_box (box_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
};



export const db = {
  /** Returns rows as typed array */
  query: async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> => {
    const [rows] = await pool.query<RowDataPacket[]>(sql, params);
    return rows as unknown as T[];
  },

  /** Returns raw ResultSetHeader — needed for affectedRows / insertId after mutations */
  execute: async (sql: string, params: unknown[] = []): Promise<ResultSetHeader> => {
    // Use query (not execute) since pool.execute has stricter param types in mysql2
    const [header] = await pool.query(sql, params) as unknown as [ResultSetHeader, unknown];
    return header;
  },
};
