import type { Prisma } from '../../../../generated/prisma/client.js';
import { normalizeArtist } from './normalizer/artist-normalizer.js';
import { normalizeTitle } from './normalizer/title-normalizer.js';
import { nextChannelContentId } from '../../channel-content-id.js';

/** Index only newly authored Rogichat content using Meloming's normalizers. */
export async function indexNewSong(prisma:Prisma.TransactionClient, title:string, artistName:string, albumArt:string|null):Promise<number> {
  const artist=normalizeArtist(artistName);
  const globalArtist=await prisma.globalArtist.upsert({
    where:{normKey:artist.normKey},update:{},
    create:{id:await nextChannelContentId(prisma),canonicalName:artist.canonicalName,normKey:artist.normKey},select:{id:true},
  });
  for(const alias of artist.aliases){
    if(!await prisma.globalArtistAlias.findUnique({where:{globalArtistId_normAlias:{globalArtistId:globalArtist.id,normAlias:alias}},select:{id:true}}))
      await prisma.globalArtistAlias.create({data:{id:await nextChannelContentId(prisma),globalArtistId:globalArtist.id,alias,normAlias:alias}});
  }
  const normalized=normalizeTitle(title);
  const globalSong=await prisma.globalSong.upsert({
    where:{normTitle_globalArtistId:{normTitle:normalized.normTitle,globalArtistId:globalArtist.id}},update:{},
    create:{id:await nextChannelContentId(prisma),title:normalized.displayTitle,normTitle:normalized.normTitle,globalArtistId:globalArtist.id,albumArt},select:{id:true},
  });
  for(const alias of normalized.aliases){
    if(!await prisma.globalSongAlias.findUnique({where:{globalSongId_normAliasTitle:{globalSongId:globalSong.id,normAliasTitle:alias}},select:{id:true}}))
      await prisma.globalSongAlias.create({data:{id:await nextChannelContentId(prisma),globalSongId:globalSong.id,aliasTitle:alias,normAliasTitle:alias}});
  }
  return globalSong.id;
}

export async function refreshGlobalSongCounts(prisma:Prisma.TransactionClient, ids:Iterable<number|null>):Promise<void> {
  for(const id of new Set([...ids].filter((value):value is number=>value!==null))){
    const count=await prisma.song.count({where:{globalSongId:id}});
    await prisma.globalSong.update({where:{id},data:{channelCount:count>0?1:0}});
  }
}
