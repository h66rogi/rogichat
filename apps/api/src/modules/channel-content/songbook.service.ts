import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { Transactions } from '../../infrastructure/database/transactions.js';
import type { CommandCredentials, SessionCredentials } from '../auth/auth-context.js';
import { AuthService } from '../auth/auth.service.js';
import { ApiError } from '../auth/auth-primitives.js';
import { ChannelContentRepository } from './channel-content.repository.js';
import { escapeForLike, normalizeForSearch } from './upstream/search-normalize.js';
import { nextChannelContentId } from './channel-content-id.js';
import { SongHelperService } from './upstream/song-helper.service.js';
import { pickLegacyPrice, sanitizeCurrencyPriceMap } from './upstream/currency-price.util.js';
import { ChannelMusicbookSettingsService } from './upstream/channel-musicbook-settings.service.js';
import { SongExportService } from './upstream/song-export.service.js';

type Query = { page?: number; limit?: number; search?: string; sortBy?: string;
  categoryIds?: number[]; artistIds?: number[]; difficulties?: number[]; proficiencies?: number[] };

const select = { id: true, title: true, artistId: true, channelId: true, albumArt: true,
  karaokeUrl: true, coverUrl: true, originalUrl: true, mrVideoUrl:true, mrVideoKey:true, globalSongId:true,
  difficulty: true, proficiency: true,
  songKey: true, bpm: true, lyricsLink: true, lyricsText:true, description: true, price: true,
  currencyPrices: true, createdAt: true,
  sheetMusics:{select:{id:true,url:true,type:true,fileName:true,fileSize:true,sortOrder:true},orderBy:[{sortOrder:'asc'},{createdAt:'asc'},{id:'asc'}]},
  artist: { select: { id: true, name: true, channelId: true, createdAt: true } },
  songCategories: { select: { id: true, songId: true, categoryId: true,
    category: { select: { id: true, name: true, color: true, price: true, currencyPrices: true,
      channelId: true, createdAt: true, displayOrder: true } } } },
  _count: { select: { userLikes: true } },
} satisfies Prisma.SongSelect;
type SongRow = Prisma.SongGetPayload<{ select: typeof select }>;

function songResponse(song: SongRow, favorite = false, manager = false) {
  const categories = song.songCategories.map(sc => ({ id: sc.category.id, name: sc.category.name,
    color: sc.category.color, price: sc.category.price, currencyPrices: sc.category.currencyPrices,
    channelId: 1, createdAt: sc.category.createdAt?.toISOString() ?? '', displayOrder: sc.category.displayOrder }));
  categories.sort((a,b) => (b.displayOrder ?? -Infinity)-(a.displayOrder ?? -Infinity) || a.name.localeCompare(b.name,'ko'));
  return { id: song.id, title: song.title, artistId: song.artistId, channelId: 1,
    albumArt: song.albumArt ?? '', karaokeUrl: song.karaokeUrl ?? '', coverUrl: song.coverUrl,
    originalUrl: song.originalUrl, mrVideoUrl:song.mrVideoUrl, mrVideoKey:song.mrVideoKey,
    globalSongId:song.globalSongId, difficulty: song.difficulty ?? 1, proficiency: song.proficiency,
    songKey: song.songKey ?? '', bpm: song.bpm, lyricsLink: song.lyricsLink, lyricsText:song.lyricsText,
    description: song.description, price: song.price, currencyPrices: song.currencyPrices,
    createdAt: song.createdAt?.toISOString() ?? '',
    artist: { id: song.artist.id, name: song.artist.name, channelId: 1, createdAt: song.artist.createdAt?.toISOString() ?? '' },
    songCategories: song.songCategories.map(sc => ({ id: sc.id, songId: sc.songId, categoryId: sc.categoryId,
      category: categories.find(c => c.id === sc.categoryId)! })),
    channel: { id: 1, name: '후로기', webPath: 'hurogi', themeColor: '#ff8c9d', profileImageUrl: '/images/hurogi-profile.png',
      user: {id:1,nickname:'후로기'} },
    totalFavorites: song._count.userLikes, categories, isFavorite: favorite,
    ...(manager ? {sheetMusics:song.sheetMusics,sheetMusicUrl:song.sheetMusics[0]?.url ?? null,sheetMusicType:song.sheetMusics[0]?.type ?? null} : {}) };
}

function parseSong(value: unknown, create: boolean) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError('INVALID_REQUEST',400);
  const data = value as Record<string,unknown>;
  const allowed = ['title','artistId','artistName','albumArt','karaokeUrl','coverUrl','originalUrl','difficulty',
    'proficiency','songKey','bpm','lyricsLink','lyricsText','description','price','categoryIds','categoryNames','currencyPrices','autoSearchAlbumArt'];
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
  if (data.categoryNames !== undefined && (!Array.isArray(data.categoryNames) || data.categoryNames.length > 50 || data.categoryNames.some(name => typeof name !== 'string' || !name.trim() || name.length > 80))) throw new ApiError('INVALID_REQUEST',400);
  if (data.currencyPrices !== undefined && data.currencyPrices !== null &&
    (typeof data.currencyPrices !== 'object' || Array.isArray(data.currencyPrices))) throw new ApiError('INVALID_REQUEST',400);
  if (data.autoSearchAlbumArt !== undefined && typeof data.autoSearchAlbumArt !== 'boolean') throw new ApiError('INVALID_REQUEST',400);
  if (data.title !== undefined && !(data.title as string).trim()) throw new ApiError('INVALID_REQUEST',400);
  return data;
}

function parseSongIds(value: unknown): number[] {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).join(',') !== 'ids') throw new ApiError('INVALID_REQUEST',400);
  const ids = (value as {ids?:unknown}).ids;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 300 || ids.some(id => !Number.isSafeInteger(id) || id < 1)) throw new ApiError('INVALID_REQUEST',400);
  return [...new Set(ids as number[])];
}

function parseBulkUpdate(value: unknown): Array<Record<string,unknown> & {id:number}> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).join(',') !== 'songs') throw new ApiError('INVALID_REQUEST',400);
  const input = (value as {songs?:unknown}).songs;
  if (!Array.isArray(input) || input.length < 1 || input.length > 300) throw new ApiError('INVALID_REQUEST',400);
  return input.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new ApiError('INVALID_REQUEST',400);
    const {id,...fields} = item as Record<string,unknown>;
    if (!Number.isSafeInteger(id) || Number(id) < 1) throw new ApiError('INVALID_REQUEST',400);
    if (Object.keys(fields).some(key => !['artistId','artistName','categoryIds','categoryNames','difficulty','proficiency','price','currencyPrices'].includes(key))) throw new ApiError('INVALID_REQUEST',400);
    const validated = parseSong(fields,false);
    return {id:id as number,...validated} as Record<string,unknown> & {id:number};
  });
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

  list(query: Query, credentials?: SessionCredentials) {
    return this.transactions.read(async tx => {
      const { roomId, ownerId } = await this.repository.primary(tx);
      const actor = credentials?.token ? await this.auth.require(tx, credentials, true) : null;
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
      const favorites = actor && rows.length ? await tx.prisma.userSongLike.findMany({ where: { userId: actor.userId, songId: { in: rows.map(row => row.id) } }, select: { songId: true } }) : [];
      const favoriteIds = new Set(favorites.map(row => row.songId));
      return { songs: rows.map(row => songResponse(row, favoriteIds.has(row.id), actor?.userId === ownerId)), total, page, limit };
    });
  }

  /** SongQueryService.getRandomSongsByChannelId sampling and response contract. */
  random(count: number, categoryIds: number[], credentials?: SessionCredentials) {
    return this.transactions.read(async tx => {
      const {roomId,ownerId} = await this.repository.primary(tx);
      const actor = credentials?.token ? await this.auth.require(tx,credentials,true) : null;
      const where: Prisma.SongWhereInput = {channelId:roomId};
      if (categoryIds.length) where.songCategories = {some:{categoryId:{in:categoryIds}}};
      const pool = (await tx.prisma.song.findMany({where,select:{id:true}})).map(row=>row.id);
      if (!pool.length) return {songs:[],total:0,page:1,limit:count};
      const take = Math.min(count,pool.length);
      for (let index=pool.length-1; index>pool.length-1-take; index--) {
        const position = Math.floor(Math.random()*(index+1));
        [pool[index],pool[position]] = [pool[position]!,pool[index]!];
      }
      const chosen = pool.slice(pool.length-take);
      const rows = await tx.prisma.song.findMany({where:{id:{in:chosen},channelId:roomId},select});
      const order = new Map(chosen.map((id,index)=>[id,index]));
      rows.sort((left,right)=>(order.get(left.id)??0)-(order.get(right.id)??0));
      const likes = actor && rows.length ? await tx.prisma.userSongLike.findMany({where:{userId:actor.userId,songId:{in:chosen}},select:{songId:true}}) : [];
      const favorites = new Set(likes.map(like=>like.songId));
      return {songs:rows.map(row=>songResponse(row,favorites.has(row.id),actor?.userId===ownerId)),total:take,page:1,limit:take};
    });
  }

  detail(id: number, credentials?: SessionCredentials) {
    return this.transactions.read(async tx => {
      const { roomId, ownerId } = await this.repository.primary(tx);
      const actor = credentials?.token ? await this.auth.require(tx, credentials, true) : null;
      const row = await tx.prisma.song.findFirst({ where: { id, channelId: roomId }, select });
      if (!row) throw new ApiError('NOT_FOUND', 404);
      const favorite = actor ? await tx.prisma.userSongLike.findUnique({ where: { userId_songId: { userId: actor.userId, songId: id } }, select: { id: true } }) : null;
      return songResponse(row, !!favorite, actor?.userId === ownerId);
    });
  }

  favoriteSongsByChannel(credentials: SessionCredentials, query: Query) {
    return this.transactions.read(async tx => {
      const actor = await this.auth.require(tx, credentials, true);
      const { roomId } = await this.repository.primary(tx);
      const page = Math.max(1, Math.min(100000, query.page ?? 1));
      const limit = Math.max(1, Math.min(100, query.limit ?? 30));
      const where: Prisma.SongWhereInput = { channelId: roomId, userLikes: { some: { userId: actor.userId } } };
      const asc: Prisma.SortOrder = 'asc', desc: Prisma.SortOrder = 'desc';
      const orderBy: Prisma.SongOrderByWithRelationInput[] = query.sortBy === 'oldest' ? [{ createdAt: asc }, { id: asc }]
        : query.sortBy === 'title' ? [{ title: asc }, { id: asc }]
        : query.sortBy === 'artist' ? [{ artist: { name: asc } }, { id: asc }]
        : query.sortBy === 'likes_desc' ? [{ userLikes: { _count: desc } }, { id: desc }]
        : [{ createdAt: desc }, { id: desc }];
      const [total, rows] = await Promise.all([
        tx.prisma.song.count({ where }),
        tx.prisma.song.findMany({ where, select, orderBy, skip: (page - 1) * limit, take: limit }),
      ]);
      return { songs: rows.map(row => songResponse(row, true)), total, page, limit };
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
    if (!(data.categoryIds as number[] | undefined)?.length && !(data.categoryNames as string[] | undefined)?.length) throw new ApiError('INVALID_REQUEST',400);
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx,credentials,true);
      const roomId = await this.repository.requireOwner(tx,actor.userId);
      await this.repository.lockPrimary(tx);
      const artist = data.artistId ? await tx.prisma.artist.findFirst({where:{id:data.artistId as number,channelId:roomId},select:{id:true}})
        : await (async () => { const name = (data.artistName as string).trim();
          const existing = await tx.prisma.artist.findFirst({where:{channelId:roomId,name},select:{id:true}});
          return existing ?? tx.prisma.artist.create({data:{id:await nextChannelContentId(tx.prisma),channelId:roomId,name,nameSearchable:normalizeForSearch(name)},select:{id:true}}); })();
      if (!artist) throw new ApiError('INVALID_REQUEST',400);
      if (await tx.prisma.song.findFirst({where:{channelId:roomId,artistId:artist.id,title:(data.title as string).trim()},select:{id:true}})) throw new ApiError('CONFLICT',409);
      const helper = new SongHelperService(tx.prisma);
      const categoryIds = [...((data.categoryIds as number[] | undefined) ?? [])];
      const count = await tx.prisma.category.count({where:{channelId:roomId,id:{in:categoryIds}}});
      if (count !== new Set(categoryIds).size) throw new ApiError('INVALID_REQUEST',400);
      categoryIds.push(...await helper.createNewCategoriesByChannel((data.categoryNames as string[] | undefined) ?? [],roomId));
      const links = [];
      for (const categoryId of new Set(categoryIds)) links.push({id:await nextChannelContentId(tx.prisma),categoryId});
      const prices = sanitizeCurrencyPriceMap(data.currencyPrices);
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
        ...(data.price !== undefined ? {price:data.price as number | null} : prices ? {price:pickLegacyPrice(prices)} : {}),
        ...(data.currencyPrices !== undefined ? {currencyPrices: prices ?? Prisma.DbNull} : {}),
        songCategories:{create:links},
      };
      const row = await tx.prisma.song.create({ data:songData,select});
      return songResponse(row);
    });
  }

  /** Meloming SongMutationService.bulkCreateSongsByChannelId behavior in one Rogichat transaction. */
  bulkCreate(credentials: CommandCredentials, value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).join(',') !== 'songs') throw new ApiError('INVALID_REQUEST',400);
    const input = (value as { songs?: unknown }).songs;
    if (!Array.isArray(input) || input.length < 1 || input.length > 500) throw new ApiError('INVALID_REQUEST',400);
    const songs = input.map(item => parseSong(item,true));
    if (songs.some(item => !(item.categoryIds as number[] | undefined)?.length && !(item.categoryNames as string[] | undefined)?.length)) throw new ApiError('INVALID_REQUEST',400);
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx,credentials,true);
      const roomId = await this.repository.requireOwner(tx,actor.userId);
      await this.repository.lockPrimary(tx);
      const helper = new SongHelperService(tx.prisma);
      const useProficiencyAsPrimary = await new ChannelMusicbookSettingsService(tx.prisma).usesProficiencyAsPrimary(roomId);
      const seen = new Set<string>();
      const skippedSongs: Array<{title:string;artistName?:string;artistId?:number;reason:'duplicate_in_request'|'already_exists'}> = [];
      const created: Array<{id:number;title:string}> = [];
      let newArtistsCount = 0, newCategoriesCount = 0;
      for (const item of songs) {
        const title = (item.title as string).trim();
        const name = typeof item.artistName === 'string' ? item.artistName.trim() : '';
        const artistId = item.artistId as number | undefined;
        const key = `${artistId ?? name.normalize('NFKC').toLowerCase()}|${title.normalize('NFKC').toLowerCase()}`;
        if (seen.has(key)) {
          skippedSongs.push({title,...(name?{artistName:name}:{}),...(artistId?{artistId}:{}),reason:'duplicate_in_request'});
          continue;
        }
        seen.add(key);
        const existingArtist = artistId
          ? await tx.prisma.artist.findFirst({where:{id:artistId,channelId:roomId},select:{id:true}})
          : await tx.prisma.artist.findFirst({where:{channelId:roomId,name},select:{id:true}});
        if (artistId && !existingArtist) throw new ApiError('INVALID_REQUEST',400);
        if (existingArtist && await tx.prisma.song.findFirst({where:{channelId:roomId,artistId:existingArtist.id,title},select:{id:true}})) {
          skippedSongs.push({title,...(name?{artistName:name}:{}),artistId:existingArtist.id,reason:'already_exists'});
          continue;
        }
        let finalArtistId = existingArtist?.id;
        if (!finalArtistId) {
          finalArtistId = (await tx.prisma.artist.create({data:{id:await nextChannelContentId(tx.prisma),channelId:roomId,name,nameSearchable:normalizeForSearch(name)},select:{id:true}})).id;
          newArtistsCount++;
        }
        const categoryIds = [...((item.categoryIds as number[] | undefined) ?? [])];
        if (await tx.prisma.category.count({where:{channelId:roomId,id:{in:categoryIds}}}) !== new Set(categoryIds).size) throw new ApiError('INVALID_REQUEST',400);
        const before = await tx.prisma.category.count({where:{channelId:roomId}});
        categoryIds.push(...await helper.createNewCategoriesByChannel((item.categoryNames as string[] | undefined) ?? [],roomId));
        newCategoriesCount += await tx.prisma.category.count({where:{channelId:roomId}}) - before;
        const prices = sanitizeCurrencyPriceMap(item.currencyPrices);
        const proficiency = typeof item.proficiency === 'number' ? item.proficiency
          : useProficiencyAsPrimary && typeof item.difficulty === 'number' ? item.difficulty : null;
        const id = await nextChannelContentId(tx.prisma);
        await tx.prisma.song.create({data:{id,channelId:roomId,artistId:finalArtistId,title,titleSearchable:normalizeForSearch(title),
          ...(item.albumArt!==undefined?{albumArt:item.albumArt as string|null}:{}),
          ...(item.karaokeUrl!==undefined?{karaokeUrl:item.karaokeUrl as string|null}:{}),
          ...(item.coverUrl!==undefined?{coverUrl:item.coverUrl as string|null}:{}),
          ...(item.originalUrl!==undefined?{originalUrl:item.originalUrl as string|null}:{}),
          difficulty:(item.difficulty as number|undefined)??1,proficiency,
          ...(item.songKey!==undefined?{songKey:item.songKey as string|null}:{}),
          ...(item.bpm!==undefined?{bpm:item.bpm as number|null}:{}),
          ...(item.lyricsLink!==undefined?{lyricsLink:item.lyricsLink as string|null}:{}),
          ...(item.lyricsText!==undefined?{lyricsText:item.lyricsText as string|null}:{}),
          ...(item.description!==undefined?{description:item.description as string|null}:{}),
          price:(item.price as number|null|undefined)??pickLegacyPrice(prices),
          currencyPrices:prices??Prisma.DbNull},select:{id:true}});
        for (const categoryId of new Set(categoryIds)) await tx.prisma.songCategory.create({data:{id:await nextChannelContentId(tx.prisma),songId:id,categoryId}});
        created.push({id,title});
      }
      return { success:true as const,createdCount:created.length,skippedCount:skippedSongs.length,
        newArtistsCount,newCategoriesCount,songs:created,skippedSongs };
    });
  }

  /** Port of SongMutationService.bulkUpdateSongsByChannelId with the channel's UUID boundary. */
  bulkUpdate(credentials: CommandCredentials, value: unknown) {
    const songs = parseBulkUpdate(value);
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx,credentials,true);
      const roomId = await this.repository.requireOwner(tx,actor.userId);
      await this.repository.lockPrimary(tx);
      const uniqueIds = [...new Set(songs.map(song => song.id))];
      const existing = await tx.prisma.song.findMany({where:{channelId:roomId,id:{in:uniqueIds}},select:{id:true,proficiency:true}});
      if (existing.length !== uniqueIds.length) throw new ApiError('INVALID_REQUEST',400);
      const useProficiencyAsPrimary = await new ChannelMusicbookSettingsService(tx.prisma).usesProficiencyAsPrimary(roomId);
      if (useProficiencyAsPrimary) {
        const byId = new Map(existing.map(song => [song.id,song.proficiency]));
        if (songs.some(song => !Number.isInteger(song.proficiency === undefined ? byId.get(song.id) : song.proficiency))) throw new ApiError('INVALID_REQUEST',400);
      }
      const helper = new SongHelperService(tx.prisma);
      const updatedIds: number[] = [];
      for (const item of songs) {
        let artistId: number | undefined;
        if (item.artistId !== undefined) {
          const artist = await tx.prisma.artist.findFirst({where:{id:item.artistId as number,channelId:roomId},select:{id:true}});
          if (!artist) throw new ApiError('INVALID_REQUEST',400);
          artistId = artist.id;
        } else if (typeof item.artistName === 'string' && item.artistName.trim()) {
          const name = item.artistName.trim();
          const artist = await tx.prisma.artist.findFirst({where:{name,channelId:roomId},select:{id:true}})
            ?? await tx.prisma.artist.create({data:{id:await nextChannelContentId(tx.prisma),name,nameSearchable:normalizeForSearch(name),channelId:roomId},select:{id:true}});
          artistId = artist.id;
        }
        const prices = sanitizeCurrencyPriceMap(item.currencyPrices);
        const data: Prisma.SongUncheckedUpdateInput = {
          ...(artistId !== undefined ? {artistId} : {}),
          ...(item.difficulty !== undefined ? {difficulty:item.difficulty as number} : {}),
          ...(item.proficiency !== undefined ? {proficiency:item.proficiency as number} : {}),
          ...(item.price !== undefined ? {price:item.price as number|null} : item.currencyPrices !== undefined ? {price:pickLegacyPrice(prices)} : {}),
          ...(item.currencyPrices !== undefined ? {currencyPrices:prices ?? Prisma.DbNull} : {}),
        };
        if (Object.keys(data).length) await tx.prisma.song.update({where:{id:item.id},data});
        if (item.categoryIds !== undefined || item.categoryNames !== undefined) {
          const categoryIds = (item.categoryIds as number[]|undefined) ?? [];
          if (await tx.prisma.category.count({where:{channelId:roomId,id:{in:categoryIds}}}) !== new Set(categoryIds).size) throw new ApiError('INVALID_REQUEST',400);
          const resolved = [...new Set([...categoryIds,...await helper.createNewCategoriesByChannel((item.categoryNames as string[]|undefined) ?? [],roomId)])];
          await tx.prisma.songCategory.deleteMany({where:{songId:item.id}});
          for (const categoryId of resolved) await tx.prisma.songCategory.create({data:{id:await nextChannelContentId(tx.prisma),songId:item.id,categoryId}});
        }
        updatedIds.push(item.id);
      }
      return {success:true,updatedCount:updatedIds.length,updatedIds};
    });
  }

  /** Rogichat has no Clip model; the copied preview contract has zero dependent clips. */
  affectedClips(credentials: SessionCredentials, value: unknown) {
    const ids = parseSongIds(value);
    return this.transactions.read(async tx => {
      const actor = await this.auth.require(tx,credentials,true);
      const roomId = await this.repository.requireOwner(tx,actor.userId);
      const count = await tx.prisma.song.count({where:{id:{in:ids},channelId:roomId}});
      if (count !== ids.length) throw new ApiError('NOT_FOUND',404);
      return {orphanClipCount:0};
    });
  }

  /** Port of SongMutationService.bulkDeleteSongsByChannelId without Meloming Clip events. */
  bulkDelete(credentials: CommandCredentials, value: unknown) {
    const ids = parseSongIds(value);
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx,credentials,true);
      const roomId = await this.repository.requireOwner(tx,actor.userId);
      await this.repository.lockPrimary(tx);
      await tx.prisma.userSongLike.deleteMany({where:{songId:{in:ids},song:{channelId:roomId}}});
      await tx.prisma.songCategory.deleteMany({where:{songId:{in:ids},song:{channelId:roomId}}});
      const {count} = await tx.prisma.song.deleteMany({where:{id:{in:ids},channelId:roomId}});
      return {success:true,deletedCount:count,deletedClipIds:[]};
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
      const helper = new SongHelperService(tx.prisma);
      const categoryIds = data.categoryIds as number[] | undefined;
      if (categoryIds) {
        const count = await tx.prisma.category.count({where:{channelId:roomId,id:{in:categoryIds}}});
        if (count !== new Set(categoryIds).size) throw new ApiError('INVALID_REQUEST',400);
      }
      const resolvedCategoryIds = data.categoryNames !== undefined
        ? [...new Set([...(categoryIds ?? []), ...await helper.createNewCategoriesByChannel(data.categoryNames as string[],roomId)])]
        : categoryIds;
      const prices = sanitizeCurrencyPriceMap(data.currencyPrices);
      const update: Prisma.SongUncheckedUpdateInput = {
        ...(artistId !== undefined ? {artistId} : {}),
        ...(data.title !== undefined ? {title:(data.title as string).trim(),titleSearchable:normalizeForSearch(data.title as string)} : {}),
        ...Object.fromEntries(['albumArt','karaokeUrl','coverUrl','originalUrl','difficulty','proficiency','songKey','bpm','lyricsLink','lyricsText','description','price']
          .filter(key => data[key] !== undefined).map(key => [key,data[key]])),
        ...(data.currencyPrices !== undefined ? {currencyPrices:prices ?? Prisma.DbNull} : {}),
      };
      if (data.price === undefined && data.currencyPrices !== undefined) update.price = pickLegacyPrice(prices);
      await tx.prisma.song.update({where:{id},data:update,select:{id:true}});
      if (resolvedCategoryIds) {
        await tx.prisma.songCategory.deleteMany({where:{songId:id}});
        if (resolvedCategoryIds.length) {
          const links=[];
          for (const categoryId of new Set(resolvedCategoryIds)) links.push({id:await nextChannelContentId(tx.prisma),songId:id,categoryId});
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

  exportCsv(credentials: SessionCredentials, ipAddress?: string, userAgent?: string) {
    return this.transactions.write(async tx => {
      const actor = await this.auth.require(tx,credentials,true);
      await this.repository.lockPrimary(tx);
      const {roomId} = await this.repository.primary(tx);
      const room = await tx.prisma.rooms.findUniqueOrThrow({where:{id:roomId},select:{name:true}});
      return new SongExportService(tx.prisma).exportSongsAsCsv(roomId,room.name,actor.userId,ipAddress,userAgent);
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
