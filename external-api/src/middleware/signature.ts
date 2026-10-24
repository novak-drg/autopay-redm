import { db } from '../db.js';
import { config } from '../config.js';
import { createRequestSignature } from '../requestSignature.js';
export const requireSignature = createRequestSignature({
  secret: config.serviceHmacSecret,
  async consumeNonce(nonce) {
    await db.execute('DELETE FROM service_nonces WHERE expires_at < NOW() LIMIT 100');
    try {
      await db.execute('INSERT INTO service_nonces (nonce, expires_at) VALUES (?, DATE_ADD(NOW(), INTERVAL 90 SECOND))', [nonce]);
      return true;
    } catch (error) {
      if ((error as { code?: string }).code === 'ER_DUP_ENTRY') return false;
      throw error;
    }
  },
});
