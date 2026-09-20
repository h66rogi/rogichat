import { Injectable } from '@nestjs/common';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { ApiError } from '../auth-primitives.js';

// OWASP scrypt profile: N=2^15,r=8,p=3 (32 MiB); two active jobs per process,
// no unbounded libuv queue. Hash work never holds a DB transaction or row lock.
const prefix = 'scrypt-v1$32768$8$3';
const pattern = /^scrypt-v1\$32768\$8\$3\$([a-f0-9]{32})\$([a-f0-9]{64})$/;
@Injectable()
export class PasswordHasher {
  private active = 0;
  private readonly dummySalt = randomBytes(16);
  private readonly dummyKey = randomBytes(32);
  private async derive(password: string, salt: Buffer): Promise<Buffer> {
    if (this.active >= 2) throw new ApiError('AUTH_UNAVAILABLE', 503);
    this.active++;
    try {
      return await new Promise<Buffer>((resolve, reject) => scrypt(password, salt, 32,
        { N: 32768, r: 8, p: 3, maxmem: 48 * 1024 * 1024 }, (error, key) => error ? reject(new ApiError('AUTH_UNAVAILABLE', 503)) : resolve(key)));
    } finally { this.active--; }
  }
  async hash(password: string): Promise<string> {
    const salt = randomBytes(16); const key = await this.derive(password, salt);
    try { return `${prefix}$${salt.toString('hex')}$${key.toString('hex')}`; }
    finally { key.fill(0); }
  }
  async verify(password: string, encoded: string | undefined): Promise<boolean> {
    const match = encoded?.match(pattern);
    const key = await this.derive(password, match ? Buffer.from(match[1]!, 'hex') : this.dummySalt);
    try { return timingSafeEqual(key, match ? Buffer.from(match[2]!, 'hex') : this.dummyKey) && Boolean(match); }
    finally { key.fill(0); }
  }
}
