import { Inject, Injectable } from '@nestjs/common';
import { Transactions } from '../../../../infrastructure/database/transactions.js';
import { ChannelContentRepository } from '../../channel-content.repository.js';

/** Meloming matcher index contract backed by Rogichat's MySQL registry. */
@Injectable()
export class GlobalSongRedisService {
  constructor(@Inject(Transactions) private readonly transactions: Transactions,
    @Inject(ChannelContentRepository) private readonly channels: ChannelContentRepository) {}

  isReady() { return true; }
  lookupSong(normTitle: string, artistId: number) {
    return this.transactions.read(async tx =>
      (await tx.prisma.globalSong.findUnique({where:{normTitle_globalArtistId:{normTitle,globalArtistId:artistId}},select:{id:true}}))?.id ?? null);
  }
  lookupTitleAlias(normAliasTitle: string) {
    return this.transactions.read(async tx =>
      (await tx.prisma.globalSongAlias.findMany({where:{normAliasTitle},select:{globalSongId:true}})).map(row=>row.globalSongId));
  }
  lookupArtistAlias(normAlias: string) {
    return this.transactions.read(async tx =>
      (await tx.prisma.globalArtistAlias.findMany({where:{normAlias},select:{globalArtistId:true}})).map(row=>row.globalArtistId));
  }
  getPrefixCandidates(prefix: string, limit: number) {
    return this.transactions.read(async tx =>
      (await tx.prisma.globalSong.findMany({where:{normTitle:{startsWith:prefix}},orderBy:[{channelCount:'desc'},{id:'asc'}],take:limit,select:{id:true}})).map(row=>row.id));
  }
  getTopCategories(globalSongId: number, limit: number) {
    return this.transactions.read(async tx => {
      const rows=await tx.prisma.songCategory.findMany({where:{song:{globalSongId}},select:{category:{select:{name:true}}}});
      const counts=new Map<string,number>();
      for(const row of rows)counts.set(row.category.name,(counts.get(row.category.name)??0)+1);
      return [...counts].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'ko')).slice(0,limit).map(([name])=>name);
    });
  }
  getChannelSongMapping(globalSongId: number, channelId: number) {
    if(channelId!==1)return Promise.resolve(null);
    return this.transactions.read(async tx => {
      const {roomId}=await this.channels.primary(tx);
      return (await tx.prisma.song.findFirst({where:{channelId:roomId,globalSongId},select:{id:true}}))?.id??null;
    });
  }
  async getChannelRecommendations(channelId:number):Promise<Array<{globalSongId:number;score:number;reason:string}>|null> { void channelId; return null; }
  getChannelSongSetCount(channelId:number) {
    if(channelId!==1)return Promise.resolve(0);
    return this.transactions.read(async tx=>{
      const {roomId}=await this.channels.primary(tx);
      return tx.prisma.song.count({where:{channelId:roomId,globalSongId:{not:null}}});
    });
  }
}
