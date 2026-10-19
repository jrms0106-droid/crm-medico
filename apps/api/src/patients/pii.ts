import { createHmac, hkdfSync } from 'node:crypto';
import { SecretBox } from '../identity/crypto.js';

/**
 * Proteção de dados pessoais sensíveis (hoje, o CPF). Da chave mestra saem duas chaves
 * independentes: uma para criptografar (AES-256-GCM) e outra para o resumo HMAC-SHA256,
 * que permite busca exata e unicidade sem decifrar os registros.
 */
export class PiiProtector {
  private readonly box: SecretBox;
  private readonly hmacKey: Buffer;

  constructor(base64Key: string) {
    const master = Buffer.from(base64Key, 'base64');
    if (master.length !== 32) throw new Error('A chave precisa ter 32 bytes.');
    const derive = (info: string) =>
      Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), info, 32));
    this.box = new SecretBox(derive('crm-pii-encryption-v1').toString('base64'));
    this.hmacKey = derive('crm-pii-lookup-v1');
  }

  encrypt(value: string): string {
    return this.box.encrypt(value);
  }

  decrypt(sealed: string): string {
    return this.box.decrypt(sealed);
  }

  /** Resumo determinístico para busca e unicidade. */
  lookupHash(value: string): string {
    return createHmac('sha256', this.hmacKey).update(value).digest('hex');
  }
}
