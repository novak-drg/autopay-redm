#!/usr/bin/env node
import mysql from 'mysql2/promise';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dir, '../.env');

if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (k && !process.env[k]) process.env[k] = v;
  }
}

const conn = await mysql.createConnection({
  host:     process.env.MYSQL_HOST     || '127.0.0.1',
  port:     Number(process.env.MYSQL_PORT || 3306),
  user:     process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE,
});

const [rows] = await conn.query(
  "SELECT id, internal_charge_id, player_identifier, product_id, status, amount_cents, created_at FROM pix_charges ORDER BY created_at DESC LIMIT 10"
);

console.log('\n📊 Últimos 10 registros em pix_charges:\n');
for (const r of rows) {
  const status  = r.status === 'PENDING' ? '\x1b[33mPENDING\x1b[0m'
                : r.status === 'PAID'    ? '\x1b[32mPAID\x1b[0m'
                : '\x1b[2m' + r.status + '\x1b[0m';
  console.log(`  [${String(r.id).padEnd(4)}] ${r.internal_charge_id}  ${status}  R$ ${(r.amount_cents/100).toFixed(2).padStart(8)}  ${String(r.created_at).slice(0,19)}`);
}

await conn.end();
process.exit(0);
