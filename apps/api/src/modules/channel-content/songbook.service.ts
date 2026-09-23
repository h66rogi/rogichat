import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { Transactions } from '../../infrastructure/database/transactions.js';
import type { CommandCredentials, SessionCredentials } from '../auth/auth-context.js';
import { AuthService } from '../auth/auth.service.js';
import { ApiError } from '../auth/auth-primitives.js';
import { ChannelContentRepository } from './channel-content.repository.js';
import { escapeForLike, normalizeForSearch } from './upstream/search-normalize.js';
import { nextChannelContentId } from './channel-content-id.js';

type Query = { page?: number; limit?: number; search?: string; sortBy?: string;
  categoryIds?: number[]; artistIds?: number[]; difficulties?: number[]; proficiencies?: number[] };

const select = { id: true, title: true, artistId: true, channelId: true, albumArt: true,
  karaokeUrl: true, coverUrl: true, originalUrl: true, difficulty: true, proficiency: true,
  songKey: true, bpm: true, lyricsLink: true, description: true, price: true,
  currencyPrices: true, createdAt: true,
  artist: { select: { id: true, name: true, channelId: true, createdAt: true } },
  songCategories: { select: { id: true, songId: true, categoryId: true,
    category: { select: { id: true, name: true, color: true, price: true, currencyPrices: true,
      channelId: true, createdAt: true, displayOrder: true } } } },
  _count: { select: { userLikes: true } },
} satisfies Prisma.SongSelect;
type SongRow = Prisma.SongGetPayload<{ select: typeof select }>;

function songResponse(song: SongRow, favorite = false) {
  const categories = song.songCategories.map(sc => ({ id: sc.category.id, name: sc.category.name,
    color: sc.category.color, price: sc.category.price, currencyPrices: sc.category.currencyPrices,
    channelId: 1, createdAt: sc.category.createdAt?.toISOString() ?? '', displayOrder: sc.category.displayOrder }));
  categories.sort((a,b) => (b.displayOrder ?? -Infinity)-(a.displayOrder ?? -Infinity) || a.name.localeCompare(b.name,'ko'));
  return { id: song.id, title: song.title, artistId: song.artistId, channelId: 1,
    albumArt: song.albumArt ?? '', karaokeUrl: song.karaokeUrl ?? '', coverUrl: song.coverUrl,
    originalUrl: song.originalUrl, difficulty: song.difficulty ?? 1, proficiency: song.proficiency,
    songKey: song.songKey ?? '', bpm: song.bpm, lyricsLink: song.lyricsLink,
    description: song.description, price: song.price, currencyPrices: song.currencyPrices,
    createdAt: song.createdAt?.toISOString() ?? '',
    artist: { id: song.artist.id, name: song.artist.name, channelId: 1, createdAt: song.artist.createdAt?.toISOString() ?? '' },
    songCategories: song.songCategories.map(sc => ({ id: sc.id, songId: sc.songId, categoryId: sc.categoryId,
      category: categories.find(c => c.id === sc.categoryId)! })),
    channel: { id: 1, name: '후로기', webPath: 'hurogi', themeColor: '#ff8c9d', profileImageUrl: '/images/hurogi-profile.png',
      user: {id:1,nickname:'후로기'} },
    totalFavorites: song._count.userLikes, categories, isFavorite: favorite };
}

function parseSong(value: unknown, create: boolean) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError('INVALID_REQUEST',400);
  const data = value as Record<string,unknown>;
  const allowed = ['title','artistId','artistName','albumArt','karaokeUrl','coverUrl','originalUrl','difficulty',
    'proficiency','songKey','bpm','lyricsLink','lyricsText','description','price','categoryIds'];
  if (Object.keys(data).some(key => !allowed.includes(key))) throw new ApiError('INVALID_REQUEST',400);
  if (create && (typeof data.title !== 'string' || !data.title.trim() ||
    !(typeof data.artistName === 'string' && data.artistName.trim()) && !Number.isSafeInteger(data.artistId))) throw new ApiError('INVALID_REQUEST',400);
  for (const key of ['title','artistName','albumArt','karaokeUrl','coverUrl','originalUrl','songKey','lyricsLink','lyricsText','description']) {
    const v = data[key]; if (v !== undefined && v !== null && (typeof v !== 'string' || v.length > (key === 'title' || key === 'artistName' ? 255 : 10000))) throw new ApiError('INVALID_REQUEST',400);
  }
  if (data.title === null || data.artistName === null || data.artistId === null) throw new ApiError('INVALID_REQUEST',400);
  for (const key of ['albumArt','karaokeUrl','coverUrl','originalUrl','lyricsLink']) {
    const value = data[key];
    if (typeof value !== 'string' || !value) continue;
    try { if (!['http:','https:'].includes(new URL(value).protocol)) throw new Error('invalid_protocol'); }
    catch { throw new ApiError('INVALID_REQUEST',400); }
  }
  for (const key of ['artistId','difficulty','proficiency','bpm','price']) {
    const v = data[key]; if (v !== undefined && v !== null && (!Number.isSafeInteger(v) || Number(v) < (key === 'price' ? 0 : 1))) throw new ApiError('INVALID_REQUEST',400);
  }
  if (data.categoryIds !== undefined && (!Array.isArray(data.categoryIds) || data.categoryIds.length > 50 || data.categoryIds.some(id => !Number.isSafeInteger(id) || id < 1))) throw new ApiError('INVALID_REQUEST',400);
  if (data.title !== undefined && !(data.title as string).trim()) throw new ApiError('INVALID_REQUEST',400);
  return data;
}

/** Meloming Song/Artist/Category query contract, with Rogichat owner and session IDs. */
@Injectable()
export class SongbookService {
  constructor(@Inject(Transactions) private readonly transactions: Transactions,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ChannelContentRepository) private readonly repository: ChannelContentRepository) {}

  manage(credentials: SessionCredentials) {
    return this.transactions.read(async tx => {
      const actor = await this.auth.require(tx,credentials,true);
      await this.repository.requireOwner(tx,actor.userId);
      return {canManage:true};
    });
  }

  list(query: Query) {
    return this.transactions.read(async tx => {
      const { roomId } = await this.repository.primary(tx);
      const page = Math.max(1,Math.min(100000,query.page ?? 1)), limit = Math.max(1,Math.min(100,query.limit ?? 40));
      const where: Prisma.SongWhereInput = { channelId: roomId };
      if (query.search) {
        const key = normalizeForSearch(query.search);
        if (!key) return { songs: [], total: 0, page, limit };
        const escaped = escapeForLike(key);
        where.OR = [{ titleSearchable: { contains: escaped } }, { artist: { nameSearchable: { contains: escaped } } }];
      }
      if (query.categoryIds?.length) where.songCategories = { some: { categoryId: { in: query.categoryIds } } };
      if (query.artistIds?.length) where.artistId = { in: query.artistIds };
      if (query.difficulties?.length) where.difficulty = { in: query.difficulties };
      if (query.proficiencies?.length) where.proficiency = { in: query.proficiencies };
      const asc: Prisma.SortOrder = 'asc', desc: Prisma.SortOrder = 'desc';
      const orderBy: Prisma.SongOrderByWithRelationInput[] = query.sortBy === 'oldest' ? [{createdAt:asc},{id:asc}]
        : query.sortBy === 'title' ? [{title:asc},{id:asc}]
        : query.sortBy === 'artist' ? [{artist:{name:asc}},{id:asc}]
        : query.sortBy === 'likes_desc' ? [{userLikes:{_count:desc}},{id:desc}]
        : [{createdAt:desc},{id:desc}];
      const [total,rows] = await Promise.all([tx.prisma.song.count({where}),
        tx.prisma.song.findMany({where,select,orderBy,skip:(page-1)*limit,take:limit})]);
      return { songs: rows.map(row => songResponse(row)), total, page, limit };
    });
  }

  detail(id: number) {
    return this.transactions.read(async tx => {
      const { roomId } = await this.repository.primary(tx);
      const row = await tx.prisma.song.findFirst({ where: { id, channelId: roomId }, select });
      if (!row) throw new ApiError('NOT_FOUND', 404);
      return songResponse(row);
    });
  }

  filters() {
    return this.transactions.read(async tx => {
      const { roomId } = await this.repository.primary(tx);
      const [artists,categories] = await Promise.all([
        tx.prisma.artist.findMany({where:{channelId:roomId},select:{id:true,name:true},orderBy:[{name:'asc'},{id:'asc'}]}),
        tx.prisma.category.findMany({where:{channelId:roomId},select:{id:true,name:true,color:true,displayOrder:true},orderBy:[{displayOrder:'desc'},{name:'asc'}]}),
      ]);
      return { artists, categories };
    });
  }

  categories() {
    return this.transactions.read(async tx => {
      const { roomId } = await this.repository.primary(tx);
      const rows = await tx.prisma.category.findMany({ where: { channelId: roomId },
        orderBy: [{ displayOrder: 'desc' }, { name: 'asc' }],
        select: { id: true, name: true, color: true, price: true, currencyPrices: true, createdAt: true,
          displayOrder: true, _count: { select: { songCategories: true } } } });
      return rows.map(row => ({ id: row.id, name: row.name, color: row.color,
        channelId: 1, createdAt: row.createdAt?.toISOString() ?? '', songCount: row._count.songCategories,
        displayOrder: row.displayOrder, price: row.price, currencyPrices: row.currencyPrices,
        channel: { id: 1, name: '후로기', user: { id: 1, nickname: '후로기' } } }));
    });
  }

  artists() {
    return this.transactions.read(async tx => {
      const { roomId } = await this.repository.primary(tx);
      const rows = await tx.prisma.artist.findMany({ where: { channelId: roomId },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        select: { id: true, name: true, createdAt: true, _count: { select: { songs: true } } } });
      return rows.map(row => ({ id: row.id, name: row.name, channelId: 1,
        createdAt: row.createdAt?.toISOString() ?? '', songCount: row._count.songs,
        channel: { id: 1, name: '후로기', user: { id: 1, nickname: '후로기' } } }));
    });
  }

  create(credentials: CommandCredentials, value: unknown) {
    const data = parseSong(value,true);
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx,credentials,true);
      const roomId = await this.repository.requireOwner(tx,actor.userId);
      await this.repository.lockPrimary(tx);
      const artist = data.artistId ? await tx.prisma.artist.findFirst({where:{id:data.artistId as number,channelId:roomId},select:{id:true}})
        : await (async () => { const name = (data.artistName as string).trim();
          const existing = await tx.prisma.artist.findFirst({where:{channelId:roomId,name},select:{id:true}});
          return existing ?? tx.prisma.artist.create({data:{id:await nextChannelContentId(tx.prisma),channelId:roomId,name,nameSearchable:normalizeForSearch(name)},select:{id:true}}); })();
      if (!artist) throw new ApiError('INVALID_REQUEST',400);
      const categoryIds = (data.categoryIds as number[] | undefined) ?? [];
      const count = await tx.prisma.category.count({where:{channelId:roomId,id:{in:categoryIds}}});
      if (count !== new Set(categoryIds).size) throw new ApiError('INVALID_REQUEST',400);
      const links = [];
      for (const categoryId of new Set(categoryIds)) links.push({id:await nextChannelContentId(tx.prisma),categoryId});
      const songData: Prisma.SongUncheckedCreateInput = { id:await nextChannelContentId(tx.prisma),channelId:roomId, artistId:artist.id,
        title:(data.title as string).trim(), titleSearchable:normalizeForSearch(data.title as string),
        ...(data.albumArt !== undefined ? {albumArt:data.albumArt as string | null} : {}),
        ...(data.karaokeUrl !== undefined ? {karaokeUrl:data.karaokeUrl as string | null} : {}),
        ...(data.coverUrl !== undefined ? {coverUrl:data.coverUrl as string | null} : {}),
        ...(data.originalUrl !== undefined ? {originalUrl:data.originalUrl as string | null} : {}),
        ...(data.difficulty !== undefined ? {difficulty:data.difficulty as number | null} : {}),
        ...(data.proficiency !== undefined ? {proficiency:data.proficiency as number | null} : {}),
        ...(data.songKey !== undefined ? {songKey:data.songKey as string | null} : {}),
        ...(data.bpm !== undefined ? {bpm:data.bpm as number | null} : {}),
        ...(data.lyricsLink !== undefined ? {lyricsLink:data.lyricsLink as string | null} : {}),
        ...(data.lyricsText !== undefined ? {lyricsText:data.lyricsText as string | null} : {}),
        ...(data.description !== undefined ? {description:data.description as string | null} : {}),
        ...(data.price !== undefined ? {price:data.price as number | null} : {}),
        songCategories:{create:links},
      };
      const row = await tx.prisma.song.create({ data:songData,select});
      return songResponse(row);
    });
  }

  update(credentials: CommandCredentials, id: number, value: unknown) {
    const data = parseSong(value,false);
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx,credentials,true);
      const roomId = await this.repository.requireOwner(tx,actor.userId);
      await this.repository.lockPrimary(tx);
      const existing = await tx.prisma.song.findFirst({where:{id,channelId:roomId},select:{id:true}});
      if (!existing) throw new ApiError('NOT_FOUND',404);
      let artistId: number | undefined;
      if (data.artistId !== undefined) {
        const artist = await tx.prisma.artist.findFirst({where:{id:data.artistId as number,channelId:roomId},select:{id:true}});
        if (!artist) throw new ApiError('INVALID_REQUEST',400);
        artistId = artist.id;
      } else if (typeof data.artistName === 'string' && data.artistName.trim()) {
        const name = data.artistName.trim();
        const artist = await tx.prisma.artist.findFirst({where:{channelId:roomId,name},select:{id:true}})
          ?? await tx.prisma.artist.create({data:{id:await nextChannelContentId(tx.prisma),channelId:roomId,name,nameSearchable:normalizeForSearch(name)},select:{id:true}});
        artistId = artist.id;
      }
      const categoryIds = data.categoryIds as number[] | undefined;
      if (categoryIds) {
        const count = await tx.prisma.category.count({where:{channelId:roomId,id:{in:categoryIds}}});
        if (count !== new Set(categoryIds).size) throw new ApiError('INVALID_REQUEST',400);
      }
      const update: Prisma.SongUncheckedUpdateInput = {
        ...(artistId !== undefined ? {artistId} : {}),
        ...(data.title !== undefined ? {title:(data.title as string).trim(),titleSearchable:normalizeForSearch(data.title as string)} : {}),
        ...Object.fromEntries(['albumArt','karaokeUrl','coverUrl','originalUrl','difficulty','proficiency','songKey','bpm','lyricsLink','lyricsText','description','price']
          .filter(key => data[key] !== undefined).map(key => [key,data[key]])),
      };
      await tx.prisma.song.update({where:{id},data:update,select:{id:true}});
      if (categoryIds) {
        await tx.prisma.songCategory.deleteMany({where:{songId:id}});
        if (categoryIds.length) {
          const links=[];
          for (const categoryId of new Set(categoryIds)) links.push({id:await nextChannelContentId(tx.prisma),songId:id,categoryId});
          await tx.prisma.songCategory.createMany({data:links});
        }
      }
      const row = await tx.prisma.song.findUniqueOrThrow({where:{id},select});
      return songResponse(row);
    });
  }

  createCategory(credentials: CommandCredentials, value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError('INVALID_REQUEST',400);
    const data = value as Record<string,unknown>;
    if (Object.keys(data).some(key => !['name','color'].includes(key)) || typeof data.name !== 'string' || !data.name.trim() || data.name.length > 80 ||
      (data.color !== undefined && (typeof data.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(data.color)))) throw new ApiError('INVALID_REQUEST',400);
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx,credentials,true);
      const roomId = await this.repository.requireOwner(tx,actor.userId);
      await this.repository.lockPrimary(tx);
      const last = await tx.prisma.category.aggregate({where:{channelId:roomId},_max:{displayOrder:true}});
      const created = await tx.prisma.category.create({data:{id:await nextChannelContentId(tx.prisma),channelId:roomId,name:(data.name as string).trim(),color:(data.color as string | undefined) ?? '#f59e0b',displayOrder:(last._max.displayOrder ?? 0)+1},select:{id:true,name:true,color:true,displayOrder:true}});
      return created;
    });
  }

  remove(credentials: CommandCredentials, id: number) {
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx,credentials,true);
      const roomId = await this.repository.requireOwner(tx,actor.userId);
      const song = await tx.prisma.song.findFirst({where:{id,channelId:roomId},select:{id:true}});
      if (!song) throw new ApiError('NOT_FOUND',404);
      await tx.prisma.userSongLike.deleteMany({where:{songId:id}});
      await tx.prisma.songCategory.deleteMany({where:{songId:id}});
      await tx.prisma.song.delete({where:{id},select:{id:true}});
    });
  }

  favorites(credentials: SessionCredentials) {
    return this.transactions.read(async tx => {
      const actor = await this.auth.require(tx,credentials,true);
      const {roomId} = await this.repository.primary(tx);
      const likes = await tx.prisma.userSongLike.findMany({where:{userId:actor.userId,song:{channelId:roomId}},select:{songId:true}});
      return { songIds:likes.map(like => like.songId) };
    });
  }

  favorite(credentials: CommandCredentials,id:number,liked:boolean) {
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx,credentials,true);
      const {roomId} = await this.repository.primary(tx);
      const song = await tx.prisma.song.findFirst({where:{id,channelId:roomId},select:{id:true}});
      if (!song) throw new ApiError('NOT_FOUND',404);
      if (liked) await tx.prisma.userSongLike.createMany({data:[{id:await nextChannelContentId(tx.prisma),userId:actor.userId,songId:id}],skipDuplicates:true});
      else await tx.prisma.userSongLike.deleteMany({where:{userId:actor.userId,songId:id}});
      return {liked};
    });
  }
}
