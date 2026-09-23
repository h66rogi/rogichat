import { Inject, Injectable } from '@nestjs/common';
import { Transactions } from '../../../../infrastructure/database/transactions.js';
import { ApiError } from '../../../auth/auth-primitives.js';
import type { CommandCredentials } from '../../../auth/auth-context.js';
import { SongbookService } from '../../songbook.service.js';

type QuickAddRequest = {globalSongId:number;categoryIds?:number[];categoryNames?:string[];
  overrides?:{difficulty?:number;songKey?:string;bpm?:number};albumArt?:string;
  autoSearchAlbumArt?:boolean;karaokeUrl?:string;coverUrl?:string;originalUrl?:string;
  lyricsLink?:string;lyricsText?:string;description?:string;difficulty?:number;
  proficiency?:number;songKey?:string;bpm?:number;price?:number;
  currencyPrices?:Record<string,number|null>|null};

/** Meloming quick-add metadata flow with Rogichat's transactional song mutation. */
@Injectable()
export class GlobalSongQuickAddService {
  constructor(@Inject(Transactions) private readonly transactions:Transactions,
    @Inject(SongbookService) private readonly songs:SongbookService) {}

  async quickAdd(channelId:number, input:unknown, credentials:CommandCredentials) {
    if(channelId!==1)throw new ApiError('NOT_FOUND',404);
    await this.songs.manage(credentials);
    if(!input||typeof input!=='object'||Array.isArray(input))throw new ApiError('INVALID_REQUEST',400);
    const dto=input as QuickAddRequest;
    if(!Number.isSafeInteger(dto.globalSongId)||dto.globalSongId<1)throw new ApiError('INVALID_REQUEST',400);
    const globalSong=await this.transactions.read(tx=>tx.prisma.globalSong.findUnique({
      where:{id:dto.globalSongId},include:{globalArtist:true},
    }));
    if(!globalSong)throw new ApiError('NOT_FOUND',404);
    const existing=await this.transactions.read(async tx=>{
      const song=await tx.prisma.song.findFirst({where:{globalSongId:globalSong.id},select:{id:true}});
      return song?.id??null;
    });
    if(existing!==null)throw new ApiError('CONFLICT',409);
    const song=await this.songs.create(credentials,{
      title:globalSong.title,artistName:globalSong.globalArtist.canonicalName,
      albumArt:dto.albumArt??globalSong.albumArt??undefined,
      autoSearchAlbumArt:dto.autoSearchAlbumArt,categoryIds:dto.categoryIds,
      categoryNames:dto.categoryNames,karaokeUrl:dto.karaokeUrl,
      coverUrl:dto.coverUrl,originalUrl:dto.originalUrl,lyricsLink:dto.lyricsLink,
      lyricsText:dto.lyricsText,description:dto.description,
      difficulty:dto.difficulty??dto.overrides?.difficulty,
      proficiency:dto.proficiency,songKey:dto.songKey??dto.overrides?.songKey,
      bpm:dto.bpm??dto.overrides?.bpm,price:dto.price,
      currencyPrices:dto.currencyPrices,
    },globalSong.id);
    return {song,recommendations:[]};
  }
}
