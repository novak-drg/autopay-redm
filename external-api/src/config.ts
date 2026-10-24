import dotenv from 'dotenv';
dotenv.config();
const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value || /^(replace[-_]|example[-_]|your[-_]|<)/i.test(value)) throw new Error(`Configure ${name} locally`);
  return value;
};
const secret = (name: string): string => {
  const value = required(name);
  if (value.length < 32) throw new Error(`${name} must contain at least 32 characters`);
  return value;
};
const callbackUrl = process.env.REDM_CALLBACK_URL ?? '';
const catalogCallbackUrl = process.env.REDM_CATALOG_CALLBACK_URL ?? '';
for (const configuredUrl of [callbackUrl, catalogCallbackUrl].filter(Boolean)) {
  const url = new URL(configuredUrl);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:'))) {
    throw new Error('REDM_CALLBACK_URL requires HTTPS, or loopback HTTP, without embedded credentials or query parameters');
  }
}
export const config = {
  port: Number(process.env.PORT || 8085), bindHost: process.env.BIND_HOST || '127.0.0.1',
  mysqlHost: process.env.MYSQL_HOST || '127.0.0.1', mysqlPort: Number(process.env.MYSQL_PORT || 3306),
  mysqlUser: required('MYSQL_USER'), mysqlPassword: required('MYSQL_PASSWORD'), mysqlDatabase: required('MYSQL_DATABASE'),
  serviceToken: secret('SERVICE_TOKEN'), serviceHmacSecret: secret('SERVICE_HMAC_SECRET'),
  mercadoPagoAccessToken: required('MP_ACCESS_TOKEN'), mercadoPagoWebhookSecret: secret('MP_WEBHOOK_SECRET'),
  mercadoPagoPayerEmail: process.env.MP_PAYER_EMAIL || '', mercadoPagoNotificationUrl: process.env.MP_NOTIFICATION_URL || '',
  webhookAllowedIps: (process.env.WEBHOOK_ALLOWED_IPS || '').split(',').map(value => value.trim()).filter(Boolean),
  discordAlertWebhook: '', adminToken: '', adminJwtSecret: secret('ADMIN_JWT_SECRET'),
  // Internal compatibility names; public configuration uses REDM_*.
  fivemCallbackUrl: callbackUrl, fivemCatalogCallbackUrl: catalogCallbackUrl,
  fivemCallbackToken: callbackUrl || catalogCallbackUrl ? secret('REDM_CALLBACK_TOKEN') : '',
};
