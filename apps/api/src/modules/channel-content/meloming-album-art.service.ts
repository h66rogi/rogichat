import { Inject, Injectable } from '@nestjs/common';
import { Transactions } from '../../infrastructure/database/transactions.js';
import type { SessionCredentials } from '../auth/auth-context.js';
import { AuthService } from '../auth/auth.service.js';
import { MelomingAlbumArtRepository } from './meloming-album-art.repository.js';

@Injectable()
export class MelomingAlbumArtService {
  constructor(@Inject(Transactions) private readonly transactions: Transactions,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(MelomingAlbumArtRepository) private readonly repository: MelomingAlbumArtRepository) {}

  search(credentials: SessionCredentials, title: string, artist: string) {
    return this.transactions.read(async tx => {
      await this.auth.require(tx, credentials, true);
      return this.repository.search(tx.prisma, title, artist);
    });
  }

  bulk(credentials: SessionCredentials, songs: { title: string; artist: string }[]) {
    return this.transactions.read(async tx => {
      await this.auth.require(tx, credentials, true);
      return this.repository.bulk(tx.prisma, songs);
    });
  }
}
