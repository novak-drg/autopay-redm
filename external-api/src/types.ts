export type ChargeStatus = 'CREATED' | 'PENDING' | 'PAID' | 'EXPIRED' | 'FAILED' | 'CANCELED' | 'REFUNDED' | 'CHARGEDBACK';

export interface CreateChargeInput {
  internalChargeId: string;
  idempotencyKey: string;
  amountCents: number;
  currency: 'BRL';
  playerIdentifier: string;
  productId: string;
  expiresInSeconds: number;
  metadata?: Record<string, unknown>;
}

export interface ChargeRecord {
  internalChargeId: string;
  idempotencyKey: string;
  playerIdentifier: string;
  productId: string;
  amountCents: number;
  currency: 'BRL';
  status: ChargeStatus;
  externalReference: string;
  gatewayName: string;
  gatewayChargeId: string;
  qrCodeBase64: string;
  qrCodeText: string;
  transactionId: string | null;
  endToEndId: string | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
  deliveredAt: Date | null;
  metadataJson: Record<string, unknown>;
}

export interface CreateChargeOutput {
  externalReference: string;
  gatewayName: string;
  gatewayChargeId: string;
  qrCodeBase64: string;
  qrCodeText: string;
  status: ChargeStatus;
  expiresAtEpoch: number;
}

export interface StatusOutput {
  status: ChargeStatus;
  transactionId?: string;
  endToEndId?: string;
  qrCodeBase64?: string;
  qrCodeText?: string;
}

export interface GatewayCreateChargeResult {
  gatewayName: string;
  gatewayChargeId: string;
  externalReference: string;
  qrCodeBase64: string;
  qrCodeText: string;
  status: ChargeStatus;
  expiresAt: Date;
}

export interface GatewayStatusResult {
  status: ChargeStatus;
  endToEndId?: string;
  transactionId?: string;
  qrCodeText?: string;
  qrCodeBase64?: string;
}

export interface GatewayWebhookPayload {
  amountCents: number;
  currency: string;
  externalReference: string;
  gatewayChargeId: string;
  status: ChargeStatus;
  transactionId?: string;
  endToEndId?: string;
  /** true when the webhook represents a refund/chargeback */
  isRefund?: boolean;
}

/** Returned by the repository's atomic webhook update */
export interface AtomicUpdateResult {
  record: ChargeRecord | null;
  /** false = already processed (race condition guard) or not found */
  updated: boolean;
  /** previous status before this update */
  previousStatus: ChargeStatus | null;
}
