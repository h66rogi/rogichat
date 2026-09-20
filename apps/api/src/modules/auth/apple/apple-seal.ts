import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export class AppleSeal {
  constructor(private readonly key: Buffer, private readonly audience: string) {}
  seal(value: unknown, id: string, purpose: string): Uint8Array<ArrayBuffer> {
    const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(JSON.stringify(['apple:v1', this.audience, id, purpose])));
    return new Uint8Array(Buffer.concat([iv, cipher.update(JSON.stringify(value)), cipher.final(), cipher.getAuthTag()]));
  }
  open(value: Uint8Array, id: string, purpose: string): unknown {
    const bytes = Buffer.from(value); if (bytes.length < 29) throw new Error('invalid_apple_ciphertext');
    const cipher = createDecipheriv('aes-256-gcm', this.key, bytes.subarray(0, 12));
    cipher.setAAD(Buffer.from(JSON.stringify(['apple:v1', this.audience, id, purpose]))); cipher.setAuthTag(bytes.subarray(-16));
    return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(12, -16)), cipher.final()]).toString('utf8')) as unknown;
  }
}
