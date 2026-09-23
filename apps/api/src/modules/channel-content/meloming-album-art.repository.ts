import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { SongAlbumArtService } from './upstream/song-album-art.service.js';

@Injectable()
export class MelomingAlbumArtRepository {
  search(prisma: Prisma.TransactionClient, title: string, artist: string) {
    return new SongAlbumArtService(prisma).searchAlbumArtFromDB(title, artist);
  }

  bulk(prisma: Prisma.TransactionClient, songs: { title: string; artist: string }[]) {
    return new SongAlbumArtService(prisma).bulkSearchAlbumArtFromDB(songs);
  }
}
