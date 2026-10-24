#!/usr/bin/env node
/**
 * scripts/admin-cli.mjs
 * CLI para gerenciar contas do painel admin do AutoPay RedM Pause.
 * Uso:  node scripts/admin-cli.mjs <command> [opções]
 * Cmds: create | list | deactivate | reset-password | roles
 */

import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import readline from 'readline';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// ─── ANSI Colors ─────────────────────────────────────────────────────────────

const C = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',

  red:     '\x1b[31m',
  green:   '\x1b[32m',
  yellow:  '\x1b[33m',
  blue:    '\x1b[34m',
  magenta: '\x1b[35m',
  cyan:    '\x1b[36m',
  white:   '\x1b[37m',

  bgBlue:  '\x1b[44m',
  bgGreen: '\x1b[42m',
  bgRed:   '\x1b[41m',
};

const paint = (color, text) => `${color}${text}${C.reset}`;
const bold  = (text) => paint(C.bold, text);
const dim   = (text) => paint(C.dim, text);

function banner() {
  console.log();
  console.log(paint(C.cyan + C.bold, '╔══════════════════════════════════════════╗'));
  console.log(paint(C.cyan + C.bold, '║') + paint(C.bold, '  🦊 AutoPay RedM Admin CLI  ·  pause-api     ') + paint(C.cyan + C.bold, '║'));
  console.log(paint(C.cyan + C.bold, '╚══════════════════════════════════════════╝'));
  console.log();
}

function info(msg)    { console.log(`  ${paint(C.blue,  '●')} ${msg}`); }
function success(msg) { console.log(`  ${paint(C.green, '✔')} ${paint(C.green, msg)}`); }
function warn(msg)    { console.log(`  ${paint(C.yellow,'!')} ${paint(C.yellow, msg)}`); }
function error(msg)   { console.log(`  ${paint(C.red,   '✖')} ${paint(C.red, msg)}`); }
function sep()        { console.log(paint(C.dim, '  ' + '─'.repeat(48))); }
function nl()         { console.log(); }

// ─── Roles ───────────────────────────────────────────────────────────────────

const ROLES = {
  super_admin: {
    label:       'Super Admin',
    color:       C.magenta,
    description: 'Acesso total — gerencia contas, produtos, caixas, cupons, analytics e transações.',
  },
  admin: {
    label:       'Admin',
    color:       C.blue,
    description: 'Acesso operacional — gerencia produtos, caixas, cupons e visualiza analytics.',
  },
};

function roleLabel(role) {
  const r = ROLES[role];
  if (!r) return paint(C.dim, role);
  return paint(r.color + C.bold, r.label);
}

// ─── .env loader ─────────────────────────────────────────────────────────────

function loadEnv() {
  const __dirname = dirname(fileURLToPath(import.meta.url));

  // Tenta .env na pasta external-api ou na raiz do script
  const candidates = [
    resolve(__dirname, '../.env'),
    resolve(__dirname, '.env'),
    resolve(process.cwd(), '.env'),
  ];

  for (const p of candidates) {
    if (existsSync(p)) {
      const raw = readFileSync(p, 'utf-8');
      for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
        if (key && !process.env[key]) process.env[key] = val;
      }
      return p;
    }
  }
  return null;
}

// ─── DB Connection ────────────────────────────────────────────────────────────

async function connect() {
  const host     = process.env.MYSQL_HOST     || '127.0.0.1';
  const port     = Number(process.env.MYSQL_PORT || '3306');
  const user     = process.env.MYSQL_USER;
  const password = process.env.MYSQL_PASSWORD || '';
  const database = process.env.MYSQL_DATABASE;

  if (!user || !database) {
    error('MYSQL_USER e MYSQL_DATABASE são obrigatórios.');
    error('Configure o arquivo .env ou defina as variáveis de ambiente.');
    process.exit(1);
  }

  try {
    const conn = await mysql.createConnection({ host, port, user, password, database });
    return conn;
  } catch (e) {
    error(`Falha ao conectar ao banco de dados: ${e.message}`);
    process.exit(1);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SAFE_USERNAME = /^[a-zA-Z0-9_-]{3,64}$/;
const BCRYPT_ROUNDS = 12;

async function promptSecret(label) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input:  process.stdin,
      output: process.stdout,
      terminal: true,
    });

    process.stdout.write(`  ${paint(C.cyan, '?')} ${label}: `);

    // Desabilita echo
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    let input = '';

    process.stdin.on('data', (ch) => {
      const c = ch.toString();
      if (c === '\r' || c === '\n') {
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
        console.log();
        rl.close();
        resolve(input);
      } else if (c === '\x7f' || c === '\x08') {
        if (input.length > 0) { input = input.slice(0, -1); process.stdout.write('\b \b'); }
      } else if (c === '\x03') {
        process.exit(0);
      } else {
        input += c;
        process.stdout.write('*');
      }
    });
  });
}

async function prompt(label, defaultVal = '') {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const hint = defaultVal ? dim(` (${defaultVal})`) : '';
    rl.question(`  ${paint(C.cyan, '?')} ${label}${hint}: `, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultVal);
    });
  });
}

// ─── Commands ─────────────────────────────────────────────────────────────────

/** Listar todos os usuários */
async function cmdList() {
  const conn = await connect();
  try {
    const [rows] = await conn.query(
      'SELECT id, username, role, is_active, failed_attempts, last_login_at, created_at FROM admin_users ORDER BY created_at ASC'
    );

    nl();
    if (!rows.length) {
      warn('Nenhuma conta cadastrada.');
      return;
    }

    console.log(
      paint(C.bold, `  ${'ID'.padEnd(4)} ${'Username'.padEnd(20)} ${'Cargo'.padEnd(18)} ${'Status'.padEnd(10)} ${'Tentativas'.padEnd(12)} ${'Último Login'.padEnd(22)} Criado em`)
    );
    sep();

    for (const u of rows) {
      const statusStr = u.is_active
        ? paint(C.green, '  Ativo  ')
        : paint(C.red,   ' Inativo ');

      const attemptsStr = u.failed_attempts > 0
        ? paint(C.yellow, String(u.failed_attempts).padEnd(12))
        : dim('0'.padEnd(12));

      const loginStr = u.last_login_at
        ? paint(C.dim, new Date(u.last_login_at).toLocaleString('pt-BR').padEnd(22))
        : dim('(nunca)'.padEnd(22));

      const createdStr = dim(new Date(u.created_at).toLocaleDateString('pt-BR'));

      const rolePad = roleLabel(u.role).padEnd(18 + 20); // compensa escape codes

      console.log(
        `  ${paint(C.dim, String(u.id).padEnd(4))} ${bold(u.username.padEnd(20))} ${roleLabel(u.role).padEnd(18 + 14)} ${statusStr}  ${attemptsStr} ${loginStr} ${createdStr}`
      );
    }

    nl();
    info(`${rows.length} conta(s) encontrada(s).`);
  } finally {
    await conn.end();
  }
}

/** Criar novo usuário */
async function cmdCreate(args) {
  let username = args[0];
  let role     = args[1];
  let password = args[2];

  nl();
  if (!username) username = await prompt('Username (3–64 chars, a-z 0-9 _ -)');
  if (!SAFE_USERNAME.test(username)) {
    error('Username inválido. Use apenas letras, números, _ e -. Mínimo 3 caracteres.');
    process.exit(1);
  }

  if (!role || !ROLES[role]) {
    console.log();
    info('Cargos disponíveis:');
    for (const [key, val] of Object.entries(ROLES)) {
      console.log(`    ${paint(val.color + C.bold, key.padEnd(15))} ${dim(val.description)}`);
    }
    nl();
    role = await prompt('Cargo', 'admin');
    if (!ROLES[role]) {
      error(`Cargo inválido. Use: ${Object.keys(ROLES).join(' | ')}`);
      process.exit(1);
    }
  }

  if (!password) {
    password = await promptSecret('Senha');
    const confirm = await promptSecret('Confirme a senha');
    if (password !== confirm) {
      error('As senhas não coincidem.');
      process.exit(1);
    }
  }

  if (password.length < 8) {
    error('Senha muito curta. Mínimo 8 caracteres.');
    process.exit(1);
  }

  nl();
  info(`Criando conta ${bold(username)} com cargo ${roleLabel(role)}...`);

  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const conn = await connect();

  try {
    const [existing] = await conn.query('SELECT id FROM admin_users WHERE username = ? LIMIT 1', [username]);
    if (existing.length > 0) {
      error(`Username "${username}" já está em uso.`);
      process.exit(1);
    }

    await conn.query(
      'INSERT INTO admin_users (username, password_hash, role, is_active, failed_attempts, created_at, updated_at) VALUES (?,?,?,1,0,NOW(),NOW())',
      [username, hash, role]
    );

    nl();
    success(`Conta criada com sucesso!`);
    sep();
    console.log(`  ${dim('Username:')} ${bold(username)}`);
    console.log(`  ${dim('Cargo:')}    ${roleLabel(role)}`);
    console.log(`  ${dim('Status:')}   ${paint(C.green, 'Ativo')}`);
    sep();
  } finally {
    await conn.end();
  }
}

/** Desativar conta */
async function cmdDeactivate(args) {
  let username = args[0];
  if (!username) username = await prompt('Username para desativar');

  const conn = await connect();
  try {
    const [rows] = await conn.query('SELECT id, is_active FROM admin_users WHERE username = ? LIMIT 1', [username]);
    if (!rows.length)           { error(`Usuário "${username}" não encontrado.`); process.exit(1); }
    if (!rows[0].is_active)     { warn(`Usuário "${username}" já está inativo.`); return; }

    await conn.query('UPDATE admin_users SET is_active = 0, updated_at = NOW() WHERE username = ?', [username]);
    success(`Conta "${username}" desativada.`);
  } finally {
    await conn.end();
  }
}

/** Reativar conta */
async function cmdActivate(args) {
  let username = args[0];
  if (!username) username = await prompt('Username para reativar');

  const conn = await connect();
  try {
    const [rows] = await conn.query('SELECT id, is_active FROM admin_users WHERE username = ? LIMIT 1', [username]);
    if (!rows.length)         { error(`Usuário "${username}" não encontrado.`); process.exit(1); }
    if (rows[0].is_active)    { warn(`Usuário "${username}" já está ativo.`); return; }

    await conn.query('UPDATE admin_users SET is_active = 1, failed_attempts = 0, locked_until = NULL, updated_at = NOW() WHERE username = ?', [username]);
    success(`Conta "${username}" reativada e tentativas resetadas.`);
  } finally {
    await conn.end();
  }
}

/** Resetar senha */
async function cmdResetPassword(args) {
  let username = args[0];
  if (!username) username = await prompt('Username');

  const conn = await connect();
  try {
    const [rows] = await conn.query('SELECT id FROM admin_users WHERE username = ? LIMIT 1', [username]);
    if (!rows.length) { error(`Usuário "${username}" não encontrado.`); process.exit(1); }

    const password = await promptSecret('Nova senha');
    const confirm  = await promptSecret('Confirme a nova senha');
    if (password !== confirm)  { error('As senhas não coincidem.'); process.exit(1); }
    if (password.length < 8)   { error('Senha muito curta. Mínimo 8 caracteres.'); process.exit(1); }

    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await conn.query(
      'UPDATE admin_users SET password_hash = ?, failed_attempts = 0, locked_until = NULL, updated_at = NOW() WHERE username = ?',
      [hash, username]
    );
    success(`Senha de "${username}" atualizada com sucesso.`);
  } finally {
    await conn.end();
  }
}

/** Listar cargos disponíveis */
function cmdRoles() {
  nl();
  console.log(bold('  Cargos disponíveis no sistema:'));
  nl();
  for (const [key, val] of Object.entries(ROLES)) {
    console.log(`  ${paint(val.color + C.bold, ('  ' + val.label).padEnd(16))}  ${paint(C.dim, key)}`);
    console.log(`  ${' '.repeat(16)}  ${val.description}`);
    nl();
  }
}

function cmdHelp() {
  nl();
  console.log(bold('  Comandos disponíveis:'));
  nl();
  const cmds = [
    ['list',            '',                              'Lista todas as contas cadastradas'],
    ['create',          '[user] [role] [senha]',         'Cria nova conta (interativo se omitido)'],
    ['deactivate',      '[user]',                        'Desativa uma conta'],
    ['activate',        '[user]',                        'Reativa uma conta e libera bloqueio'],
    ['reset-password',  '[user]',                        'Redefine a senha de uma conta'],
    ['roles',           '',                              'Lista os cargos disponíveis'],
    ['help',            '',                              'Exibe esta ajuda'],
  ];
  for (const [cmd, args, desc] of cmds) {
    const cmdStr  = paint(C.cyan + C.bold, cmd.padEnd(18));
    const argStr  = args ? paint(C.yellow, args.padEnd(26)) : ' '.repeat(26);
    console.log(`  ${cmdStr} ${argStr} ${dim(desc)}`);
  }
  nl();
  console.log(dim('  Exemplo:'));
  console.log(`  ${paint(C.dim, 'node scripts/admin-cli.mjs create novak super_admin')}`);
  nl();
}

// ─── Entry Point ──────────────────────────────────────────────────────────────

const envFile = loadEnv();

banner();

if (envFile) {
  info(dim(`Configuração carregada de: ${envFile}`));
} else {
  warn('Arquivo .env não encontrado. Usando variáveis de ambiente do sistema.');
}
nl();

const [,, cmd, ...rest] = process.argv;

try {
  switch (cmd) {
    case 'list':           await cmdList();                  break;
    case 'create':         await cmdCreate(rest);            break;
    case 'deactivate':     await cmdDeactivate(rest);        break;
    case 'activate':       await cmdActivate(rest);          break;
    case 'reset-password': await cmdResetPassword(rest);     break;
    case 'roles':          cmdRoles();                       break;
    case 'help':
    case '--help':
    case '-h':
    case undefined:        cmdHelp();                        break;
    default:
      error(`Comando desconhecido: "${cmd}"`);
      cmdHelp();
      process.exit(1);
  }
} catch (e) {
  error(`Erro inesperado: ${e.message}`);
  process.exit(1);
}

nl();
