import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createConnection } from 'mysql2/promise';
import { readConfig } from '../../dist/infrastructure/config/config.js';
import { PrismaDatabase } from '../../dist/infrastructure/database/database.js';
import { migrationManifest } from '../../dist/infrastructure/database/schema-manifest.js';
import { ChannelContentRepository } from '../../dist/modules/channel-content/channel-content.repository.js';
import { MelomingChannelService } from '../../dist/modules/channel-content/meloming-channel.service.js';
import { MelomingProfileService } from '../../dist/modules/channel-content/meloming-profile.service.js';
import { MelomingUserService } from '../../dist/modules/channel-content/meloming-user.service.js';
import { MelomingMusicbookSettingsService } from '../../dist/modules/channel-content/meloming-musicbook-settings.service.js';
import { MelomingCategoryService } from '../../dist/modules/channel-content/meloming-category.service.js';
import { MelomingArtistService } from '../../dist/modules/channel-content/meloming-artist.service.js';
import { MelomingSongAddRequestService } from '../../dist/modules/channel-content/meloming-song-add-request.service.js';
import { MelomingSetlistService } from '../../dist/modules/channel-content/meloming-setlist.service.js';
import { MelomingSongRequestSettingsService } from '../../dist/modules/channel-content/meloming-song-request-settings.service.js';
import { MelomingLiveSessionService } from '../../dist/modules/channel-content/meloming-live-session.service.js';
import { MelomingLiveSongRequestService } from '../../dist/modules/channel-content/meloming-live-song-request.service.js';
import { ChannelScheduleService } from '../../dist/modules/channel-content/schedule.service.js';
import { MelomingCalendarService } from '../../dist/modules/channel-content/meloming-calendar.service.js';
import { SongbookService } from '../../dist/modules/channel-content/songbook.service.js';
import { RecurringScheduleService } from '../../dist/modules/channel-content/recurring-schedule.service.js';
import { ChannelWardrobeService } from '../../dist/modules/channel-content/upstream/channel-wardrobe.service.js';
import { nextChannelContentId } from '../../dist/modules/channel-content/channel-content-id.js';
import { AccountCleanupRepository } from '../../dist/modules/deletion/account-cleanup.repository.js';
import { MelomingUploadService } from '../../dist/modules/channel-content/meloming-upload.service.js';
import { MelomingFavoritesService } from '../../dist/modules/channel-content/meloming-favorites.service.js';
import { MelomingSheetMusicService } from '../../dist/modules/channel-content/meloming-sheet-music.service.js';
import { SongSuggestService } from '../../dist/modules/channel-content/upstream/song-suggest.service.js';
import { SongAutocompleteService } from '../../dist/modules/channel-content/upstream/song-autocomplete.service.js';
import { MelomingMrVideoService } from '../../dist/modules/channel-content/meloming-mr-video.service.js';
import { MelomingPricingService } from '../../dist/modules/channel-content/meloming-pricing.service.js';
import { MelomingOmakaseService } from '../../dist/modules/channel-content/meloming-omakase.service.js';
import { SongAlbumArtService } from '../../dist/modules/channel-content/upstream/song-album-art.service.js';
import { Readable } from 'node:stream';

async function fixture(t) {
  assert.equal(process.env.ROGICHAT_TEST_MYSQL,'disposable');
  const url=new URL(process.env.TEST_ADMIN_URL);
  const original=url.pathname.slice(1),schema=`channel_${randomBytes(8).toString('hex')}`;
  assert.match(original,/^rogichat_test_[a-f0-9]+$/);
  const admin=await createConnection({host:url.hostname,port:Number(url.port||3306),user:decodeURIComponent(url.username),
    password:decodeURIComponent(url.password),database:original,multipleStatements:true});
  const runtimeUser=`channel_${randomBytes(8).toString('hex')}`,runtimePassword=randomBytes(24).toString('hex');
  let db;
  t.after(async()=>{await db?.close();await admin.query(`DROP DATABASE IF EXISTS \`${schema}\``);
    await admin.query("DROP USER IF EXISTS ?@'%'",[runtimeUser]);await admin.end();});
  await admin.query(`CREATE DATABASE \`${schema}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
  await admin.query(`USE \`${schema}\``);
  for(const migration of migrationManifest) await admin.query(await readFile(new URL(`../../prisma/migrations/${migration.name}/migration.sql`,import.meta.url),'utf8'));
  await admin.query(`CREATE TABLE _prisma_migrations LIKE \`${original}\`._prisma_migrations`);
  await admin.query(`INSERT INTO _prisma_migrations SELECT * FROM \`${original}\`._prisma_migrations`);
  await admin.query("CREATE USER ?@'%' IDENTIFIED BY ?",[runtimeUser,runtimePassword]);
  await admin.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON \`${schema}\`.* TO ?@'%'`,[runtimeUser]);
  url.pathname=`/${schema}`;url.username=runtimeUser;url.password=runtimePassword;
  db=new PrismaDatabase(readConfig('worker',{...process.env,DATABASE_URL:url.href,DB_POOL_SIZE:'2'}));
  const roomId=randomUUID(),ownerId=randomUUID(),fanId=randomUUID(),memberId=randomUUID();
  await db.transactions.write(async tx=>{
    await tx.prisma.users.create({data:{id:ownerId,profile:{create:{nickname:'소유자'}}}});
    await tx.prisma.users.create({data:{id:fanId,profile:{create:{nickname:'팬'}}}});
    await tx.prisma.rooms.create({data:{id:roomId,name:'후로기',mode:'FAN'}});
    await tx.prisma.room_members.create({data:{id:memberId,room_id:roomId,user_id:ownerId,role:'STREAMER'}});
    await tx.prisma.rooms.update({where:{id:roomId},data:{owner_member_id:memberId}});
    await tx.prisma.default_room_bindings.create({data:{key:'primary',room_id:roomId,owner_bound:true}});
    await tx.prisma.creator_accounts.create({data:{user_id:ownerId,enabled:true}});
  });
  return {db,roomId,ownerId,fanId};
}

test('ported channel schema serves empty content, persists wardrobe/songbook, generates recurring dates and purges account data',async t=>{
  const {db,roomId,ownerId,fanId}=await fixture(t);
  const repository=new ChannelContentRepository();
  const auth={require:async(_tx,credentials)=>({userId:credentials.token,sessionId:randomUUID()})};
  const channel=new MelomingChannelService(db.transactions,auth,repository);
  const users=new MelomingUserService(db.transactions,auth,repository);
  const musicbookSettings=new MelomingMusicbookSettingsService(db.transactions,auth,repository);
  const categories=new MelomingCategoryService(db.transactions,auth,repository);
  const artists=new MelomingArtistService(db.transactions,auth,repository);
  const profile=new MelomingProfileService(db.transactions,auth,repository);
  const schedule=new ChannelScheduleService(db.transactions,auth,repository);
  const calendar=new MelomingCalendarService(db.transactions,auth,repository,schedule);
  const songbook=new SongbookService(db.transactions,{},repository);
  const recurring=new RecurringScheduleService(db.transactions,{},repository);
  const allocated=await Promise.all(Array.from({length:8},()=>db.transactions.write(tx=>nextChannelContentId(tx.prisma))));
  assert.equal(new Set(allocated).size,8);
  assert.equal((await schedule.list({})).total,0);
  assert.equal((await songbook.list({})).total,0);
  assert.deepEqual(await musicbookSettings.getSettings(),{useProficiencyAsPrimary:false,hasExplicitUseProficiencyAsPrimary:false,canEnableProficiencyAsPrimary:true,totalSongs:0,songsMissingProficiency:0});
  const ownerAlias=await users.me({token:ownerId});
  const fanAlias=await users.me({token:fanId});
  assert.equal((await users.me({token:ownerId})).id,ownerAlias.id);
  assert.notEqual(ownerAlias.id,fanAlias.id);
  assert.equal(ownerAlias.nickname,'소유자');
  const detail=await channel.detail();
  assert.equal(detail.id,1);
  assert.equal(detail.name,'후로기');
  assert.deepEqual(detail._count,{songs:0,artists:0,categories:0});
  assert.deepEqual((await channel.features()).items.filter(item=>item.isEnabled).map(item=>item.key),['musicbook','schedule','setlist','wardrobe']);
  assert.equal((await channel.permission({token:ownerId})).manageContent,true);
  assert.equal((await channel.permission({token:fanId})).manageContent,false);
  assert.equal((await channel.detail()).scheduleNotice,null);
  await assert.rejects(channel.updateScheduleNotice({token:fanId},{scheduleNotice:'private'}));
  assert.equal((await channel.updateScheduleNotice({token:ownerId},{scheduleNotice:'이번 주 휴방'})).scheduleNotice,'이번 주 휴방');
  assert.equal((await channel.detail()).scheduleNotice,'이번 주 휴방');
  assert.deepEqual(await profile.public(),{channelId:1});
  await assert.rejects(profile.save({token:fanId},{birthday:'2000-09-25'}));
  const savedProfile=await profile.save({token:ownerId},{birthday:'2000-09-25',debutDate:'2024-05-01'});
  assert.equal(savedProfile.channelId,1);
  assert.ok(savedProfile.anniversaries?.birthday);
  assert.ok(savedProfile.anniversaries?.milestones);
  const calendarWindow={from:'2026-09-01',to:'2026-10-01'};
  const initialCalendar=await calendar.getCalendar(calendarWindow,{});
  assert.equal(initialCalendar.anniversaries.filter(item=>item.type==='BIRTHDAY').length,1);
  assert.deepEqual(initialCalendar.setlists,[]);
  const first=await db.transactions.write(tx=>new ChannelWardrobeService(tx.prisma).getPublicWardrobe(roomId));
  assert.deepEqual(first.categories.map(row=>row.name),['의상','헤어']);
  assert.equal(first.items.length,0);
  let privateScheduleId;
  await db.transactions.write(async tx=>{
    const wardrobe=new ChannelWardrobeService(tx.prisma);
    await wardrobe.createItem(roomId,{title:'검증 의상',imageUrl:'https://example.org/outfit.png',categoryId:first.categories[0].id,tags:['검증']});
    const artistId=await nextChannelContentId(tx.prisma),categoryId=await nextChannelContentId(tx.prisma);
    await tx.prisma.artist.create({data:{id:artistId,name:'가 수',nameSearchable:'가수',channelId:roomId}});
    await tx.prisma.category.create({data:{id:categoryId,name:'방송곡',color:'#ff0000',channelId:roomId}});
    const songId=await nextChannelContentId(tx.prisma);
    await tx.prisma.song.create({data:{id:songId,title:'테 스트 노래',titleSearchable:'테스트노래',artistId,channelId:roomId}});
    await tx.prisma.songCategory.create({data:{id:await nextChannelContentId(tx.prisma),songId,categoryId}});
    await tx.prisma.userSongLike.create({data:{id:await nextChannelContentId(tx.prisma),userId:fanId,songId}});
    await tx.prisma.songAddRequest.create({data:{id:await nextChannelContentId(tx.prisma),requesterId:fanId,channelId:roomId,title:'신청 노래',artistName:'신청 가수'}});
    privateScheduleId=await nextChannelContentId(tx.prisma);
    await tx.prisma.channelSchedule.create({data:{id:privateScheduleId,channelId:roomId,authorUserId:ownerId,title:'비공개',startAt:new Date(),visibility:'PRIVATE'}});
    await tx.prisma.channelRecurringSchedule.create({data:{id:await nextChannelContentId(tx.prisma),channelId:roomId,dayOfWeek:new Date(Date.now()+86400000+9*3600000).getUTCDay(),title:'정기 방송',startTime:'20:00',status:'LIVE'}});
  });
  const publicWardrobe=await db.transactions.write(tx=>new ChannelWardrobeService(tx.prisma).getPublicWardrobe(roomId));
  assert.equal(publicWardrobe.items[0].title,'검증 의상');
  assert.equal((await songbook.list({search:'테스트'})).total,1);
  const copiedSong=(await songbook.list({search:'테스트'})).songs[0];
  assert.equal(copiedSong.channelId,1);
  assert.equal(copiedSong.artist.channelId,1);
  assert.equal(copiedSong.categories[0].channelId,1);
  assert.equal((await songbook.detail(copiedSong.id)).title,'테 스트 노래');
  await assert.rejects(songbook.detail(copiedSong.id+1000));
  assert.equal((await songbook.categories())[0].songCount,1);
  assert.equal((await songbook.artists())[0].songCount,1);
  assert.deepEqual((await channel.detail())._count,{songs:1,artists:1,categories:1});
  assert.equal((await songbook.list({search:'가수'})).total,1);
  assert.equal((await musicbookSettings.getSettings()).songsMissingProficiency,1);
  await assert.rejects(musicbookSettings.updateSettings({token:ownerId},{useProficiencyAsPrimary:true}));
  await assert.rejects(musicbookSettings.copyDifficultyToProficiency({token:fanId}));
  assert.equal((await musicbookSettings.copyDifficultyToProficiency({token:ownerId})).updatedCount,1);
  assert.equal((await musicbookSettings.updateSettings({token:ownerId},{useProficiencyAsPrimary:true})).useProficiencyAsPrimary,true);
  assert.equal((await musicbookSettings.getSettings()).hasExplicitUseProficiencyAsPrimary,true);
  await assert.rejects(categories.create({token:fanId},{name:'팬 분류',color:'#ffffff'}));
  await assert.rejects(categories.create({token:ownerId},{name:'방 송 곡',color:'#ffffff'}));
  const addedCategory=await categories.create({token:ownerId},{name:'새 분류',color:'#112233',currencyPrices:{SOOP_BALLOON:20}});
  assert.equal(addedCategory.channelId,1);
  assert.equal(addedCategory.price,20);
  const editedCategory=await categories.update({token:ownerId},addedCategory.id,{name:'변경된 분류',displayOrder:10});
  assert.equal(editedCategory.name,'변경된 분류');
  const swapped=await categories.swap({token:ownerId},{categoryId:copiedSong.categories[0].id,targetCategoryId:addedCategory.id});
  assert.equal(swapped.length,2);
  assert.notEqual(swapped[0].displayOrder,swapped[1].displayOrder);
  assert.deepEqual(await categories.remove({token:ownerId},copiedSong.categories[0].id),{message:'카테고리가 삭제되었습니다.'});
  assert.equal((await songbook.detail(copiedSong.id)).categories.length,0);
  await assert.rejects(artists.create({token:fanId},{name:'팬 가수'}));
  await assert.rejects(artists.create({token:ownerId},{name:'가 수'}));
  const newArtist=await artists.create({token:ownerId},{name:'새 가수'});
  assert.equal(newArtist.channelId,1);
  assert.equal((await artists.update({token:ownerId},newArtist.id,{name:'바뀐 가수'})).name,'바뀐 가수');
  assert.equal((await schedule.list({})).total,0);
  assert.equal((await schedule.listForViewer({},{})).total,0);
  assert.equal((await schedule.listForViewer({token:fanId},{})).total,0);
  assert.equal((await schedule.listForViewer({token:ownerId},{})).total,1);
  const publicSchedule=await schedule.create({token:ownerId},{title:'공개 방송',startAt:'2026-09-26T11:00:00Z'});
  const publicCalendar=await calendar.getCalendar(calendarWindow,{});
  assert.ok(publicCalendar.schedules.some(item=>item.id===publicSchedule.id));
  assert.ok(!publicCalendar.schedules.some(item=>item.id===privateScheduleId));
  const ownerCalendar=await calendar.getCalendar(calendarWindow,{token:ownerId});
  assert.ok(ownerCalendar.schedules.some(item=>item.id===privateScheduleId));
  assert.equal((await calendar.searchCalendar({...calendarWindow,q:'비공개'},{})).total,0);
  assert.equal((await calendar.searchCalendar({...calendarWindow,q:'비공개'},{token:ownerId})).total,1);
  assert.equal((await calendar.searchCalendar({...calendarWindow,q:'생일'},{})).items[0].type,'ANNIVERSARY');
  await assert.rejects(schedule.getOne({},privateScheduleId));
  await assert.rejects(schedule.getOne({token:fanId},privateScheduleId));
  assert.equal((await schedule.getOne({token:ownerId},privateScheduleId)).channelId,1);
  await recurring.refreshUpcoming();
  const generated=await schedule.list({limit:100});
  assert.ok(generated.total>=4);
  await recurring.refreshUpcoming();
  assert.equal((await schedule.list({limit:100})).total,generated.total);
  const cleanup=new AccountCleanupRepository();
  assert.equal(await db.transactions.write(tx=>cleanup.channelContent(tx,fanId,100)),1);
  assert.equal(await db.transactions.read(tx=>tx.prisma.songAddRequest.count()),0);
  assert.equal(await db.transactions.write(tx=>cleanup.channelContent(tx,fanId,100)),1);
  assert.equal(await db.transactions.read(tx=>tx.prisma.userSongLike.count()),0);
  assert.deepEqual(await artists.remove({token:ownerId},copiedSong.artistId),{message:'가수가 삭제되었습니다.'});
  await assert.rejects(songbook.detail(copiedSong.id));
  for(let page=0;page<30;page++){
    const changed=await db.transactions.write(tx=>cleanup.channelContent(tx,ownerId,100));
    if(!changed)break;
  }
  const remaining=await db.transactions.read(async tx=>({songs:await tx.prisma.song.count(),schedules:await tx.prisma.channelSchedule.count(),items:await tx.prisma.channelWardrobeItem.count(),profiles:await tx.prisma.channelProfile.count(),layouts:await tx.prisma.channelOverlayLayout.count()}));
  assert.deepEqual(remaining,{songs:0,schedules:0,items:0,profiles:0,layouts:0});
  await db.transactions.write(tx=>cleanup.privateFields(tx,ownerId));
  assert.equal(await db.transactions.read(tx=>tx.prisma.melomingUserAlias.count({where:{userId:ownerId}})),0);
});

test('Meloming manual and Excel song registration creates categories and skips duplicate rows atomically',async t=>{
  const {db,ownerId,fanId}=await fixture(t);
  const repository=new ChannelContentRepository();
  const auth={require:async(_tx,credentials)=>({userId:credentials.token,sessionId:randomUUID()})};
  const songs=new SongbookService(db.transactions,auth,repository);
  await assert.rejects(songs.create({token:fanId},{title:'수동',artistName:'가수',categoryNames:['발라드']}));
  const manual=await songs.create({token:ownerId},{title:'수동',artistName:'가수',categoryNames:['발라드'],autoSearchAlbumArt:true});
  assert.equal(manual.categories[0].name,'발라드');
  const result=await songs.bulkCreate({token:ownerId},{songs:[
    {title:'새 노래',artistName:'가수',categoryNames:['발라드','팝']},
    {title:'새 노래',artistName:'가수',categoryNames:['팝']},
    {title:'수동',artistName:'가수',categoryNames:['발라드']},
  ]});
  assert.equal(result.createdCount,1);
  assert.equal(result.skippedCount,2);
  assert.equal(result.newCategoriesCount,1);
  assert.equal((await songs.list({})).total,2);
  const random=await songs.random(2,[],{token:ownerId});
  assert.equal(random.songs.length,2);
  assert.equal(new Set(random.songs.map(song=>song.id)).size,2);
  assert.equal((await new SongSuggestService(db.transactions,repository).suggestSongs(1,'새 노래',5)).suggestions[0].title,'새 노래');
  const autocomplete=new SongAutocompleteService(db.transactions,repository);
  assert.equal((await autocomplete.autocompleteTitles(1,'새',5)).suggestions[0].title,'새 노래');
  assert.equal((await autocomplete.suggestArtists(1,'수동',5)).suggestions[0].artistName,'가수');
  const exported=await songs.exportCsv({token:ownerId});
  assert.equal(exported.songCount,2);
  assert.match(exported.csv,/노래,가수,카테고리,난이도,숙련도/);
  assert.equal(await db.transactions.read(tx=>tx.prisma.songExportLog.count()),1);
  await assert.rejects(songs.bulkCreate({token:ownerId},{songs:[
    {title:'롤백 대상',artistName:'가수',categoryNames:['팝']},
    {title:'잘못된 곡',artistId:9999,categoryNames:['팝']},
  ]}));
  assert.equal((await songs.list({})).total,2);
  await assert.rejects(songs.bulkUpdate({token:fanId},{songs:[{id:manual.id,difficulty:4}]}));
  const changed=await songs.bulkUpdate({token:ownerId},{songs:[{id:manual.id,artistName:'새 가수',categoryNames:['팝'],difficulty:4,price:20}]});
  assert.deepEqual(changed,{success:true,updatedCount:1,updatedIds:[manual.id]});
  assert.equal((await songs.detail(manual.id)).artist.name,'새 가수');
  assert.equal((await songs.detail(manual.id)).categories[0].name,'팝');
  await assert.rejects(songs.bulkUpdate({token:ownerId},{songs:[{id:manual.id,difficulty:2},{id:9999,difficulty:3}]}));
  assert.equal((await songs.detail(manual.id)).difficulty,4);
  await assert.rejects(songs.affectedClips({token:fanId},{ids:[manual.id]}));
  assert.deepEqual(await songs.affectedClips({token:ownerId},{ids:[manual.id]}),{orphanClipCount:0});
  assert.deepEqual(await songs.bulkDelete({token:ownerId},{ids:[manual.id,9999]}),{success:true,deletedCount:1,deletedClipIds:[]});
  await assert.rejects(songs.detail(manual.id));
  assert.equal((await songs.list({})).total,1);
});

test('copied sheet-music rules store validated files, replace MusicXML and reorder slots',async t=>{
  const {db,ownerId,fanId}=await fixture(t);
  const repository=new ChannelContentRepository();
  const auth={require:async(_tx,credentials)=>({userId:credentials.token,sessionId:randomUUID()})};
  const songs=new SongbookService(db.transactions,auth,repository);
  const song=await songs.create({token:ownerId},{title:'악보곡',artistName:'악보가수',categoryNames:['연습']});
  const objects=new Map();
  const store={
    put:async(key,path,bytes,type)=>{const buffer=await readFile(path);assert.equal(buffer.length,bytes);objects.set(key,{buffer,type});},
    read:async key=>{const value=objects.get(key);if(!value) throw new Error('missing');return {stream:Readable.from(value.buffer),bytes:value.buffer.length};},
    remove:async key=>{objects.delete(key);},
  };
  const sheets=new MelomingSheetMusicService(db.transactions,auth,repository,store,'qa');
  const pdf={buffer:Buffer.from('%PDF-1.4\n1 0 obj\n'),size:19,mimetype:'application/pdf',originalname:'first.pdf'};
  pdf.size=pdf.buffer.length;
  await assert.rejects(sheets.append({token:fanId},song.id,pdf));
  await assert.rejects(sheets.append({token:ownerId},song.id,{...pdf,buffer:Buffer.from('not a PDF'),size:9}));
  const first=await sheets.append({token:ownerId},song.id,pdf);
  assert.equal(first.type,'PDF');
  assert.equal(first.sortOrder,0);
  const second=await sheets.append({token:ownerId},song.id,{...pdf,originalname:'second.pdf'});
  assert.equal(second.sortOrder,1);
  assert.equal((await sheets.list({token:ownerId},song.id)).length,2);
  assert.equal((await sheets.read(first.url.split('/').at(-1))).contentType,'application/pdf');
  assert.deepEqual((await sheets.reorder({token:ownerId},song.id,{orderedIds:[second.id,first.id]})).map(slot=>slot.id),[second.id,first.id]);
  const xml=Buffer.from('<?xml version="1.0"?><score-partwise version="4.0"></score-partwise>');
  const music={buffer:xml,size:xml.length,mimetype:'application/xml',originalname:'score.musicxml'};
  const third=await sheets.append({token:ownerId},song.id,music);
  await sheets.append({token:ownerId},song.id,music);
  assert.equal((await sheets.list({token:ownerId},song.id)).filter(slot=>slot.type==='MUSICXML').length,1);
  assert.equal(objects.size,3);
  assert.equal((await songs.detail(song.id,{token:ownerId})).sheetMusics.length,3);
  assert.equal((await songs.detail(song.id)).sheetMusics,undefined);
  await assert.rejects(sheets.remove({token:ownerId},song.id,third.id));
  assert.deepEqual(await sheets.remove({token:ownerId},song.id),{deleted:true});
  assert.equal(objects.size,0);
});

test('MR multipart contract binds signed parts to owner song and serves completed video',async t=>{
  const {db,ownerId,fanId}=await fixture(t);
  const repository=new ChannelContentRepository();
  const auth={require:async(_tx,credentials)=>({userId:credentials.token,sessionId:randomUUID()})};
  const songs=new SongbookService(db.transactions,auth,repository);
  const song=await songs.create({token:ownerId},{title:'MR곡',artistName:'가수',categoryNames:['MR']});
  const objects=new Map();
  const store={
    beginMultipart:async(key,type)=>{assert.equal(type,'video/mp4');objects.set(key,{bytes:0});return {uploadId:'upload-1'};},
    signMultipartPart:async(_key,_id,part)=>`https://example.org/part/${part}`,
    finishMultipart:async(key,_id,parts)=>{assert.equal(parts.length,1);objects.set(key,{bytes:1024});return 1024;},
    abortMultipart:async key=>{objects.delete(key);},
    remove:async key=>{objects.delete(key);},
    readRange:async key=>{assert.equal(objects.get(key)?.bytes,1024);return {stream:Readable.from(Buffer.from('video')),bytes:5,total:1024,contentType:'video/mp4',contentRange:'bytes 0-4/1024'};},
  };
  const videos=new MelomingMrVideoService(db.transactions,auth,repository,store,'qa');
  await assert.rejects(videos.initiate({token:fanId},song.id,{fileName:'mr.mp4',contentType:'video/mp4',fileSizeBytes:1024}));
  const upload=await videos.initiate({token:ownerId},song.id,{fileName:'mr.mp4',contentType:'video/mp4',fileSizeBytes:1024});
  assert.equal(upload.partSizeBytes,64*1024*1024);
  assert.equal((await videos.signPart({token:ownerId},song.id,{key:upload.key,uploadId:upload.uploadId,partNumber:1})).partNumber,1);
  await assert.rejects(videos.signPart({token:ownerId},song.id+1,{key:upload.key,uploadId:upload.uploadId,partNumber:1}));
  const completed=await videos.complete({token:ownerId},song.id,{key:upload.key,uploadId:upload.uploadId,fileSizeBytes:1024,parts:[{partNumber:1,etag:'etag'}]});
  assert.match(completed.mrVideoUrl,/api\.qa\.rogi\.chat/);
  assert.equal((await songs.detail(song.id)).mrVideoUrl,completed.mrVideoUrl);
  assert.equal((await videos.read(song.id,upload.key.split('/')[2],'bytes=0-4')).total,1024);
  await assert.rejects(videos.read(song.id+1,upload.key.split('/')[2]));
  assert.equal((await videos.remove({token:ownerId},song.id)).mrVideoUrl,null);
  assert.equal(objects.size,0);
});

test('wardrobe image upload requires owner and returns a public durable image stream',async t=>{
  const {db,ownerId,fanId}=await fixture(t);
  const objects=new Map();
  const store={
    put:async(key,path,bytes,type)=>{
      const buffer=await readFile(path);
      assert.equal(buffer.length,bytes);
      objects.set(key,{buffer,type});
    },
    read:async key=>{
      const object=objects.get(key);
      if(!object)throw new Error('missing');
      return {stream:Readable.from(object.buffer),bytes:object.buffer.length};
    },
  };
  const auth={require:async(_tx,credentials)=>({userId:credentials.token,sessionId:randomUUID()})};
  const uploads=new MelomingUploadService(db.transactions,auth,new ChannelContentRepository(),store,'qa');
  const file={buffer:Buffer.from('synthetic-image-bytes'),size:21,mimetype:'image/png'};
  await assert.rejects(uploads.uploadImage({token:fanId},file));
  const created=await uploads.uploadImage({token:ownerId},file);
  assert.match(created.imageUrl,/^https:\/\/api\.qa\.rogi\.chat\/v1\/upload\/image\/[a-f0-9-]+\.png$/);
  assert.equal(objects.get(created.fileKey).type,'image/png');
  const image=await uploads.readImage(created.fileName);
  assert.equal(image.contentType,'image/png');
  assert.equal(image.bytes,file.size);
  await assert.rejects(uploads.readImage('../private'));
});

test('Meloming favorite channel and song routes persist counts, status, lists and account cleanup',async t=>{
  const {db,roomId,ownerId,fanId}=await fixture(t);
  const repository=new ChannelContentRepository();
  const auth={require:async(_tx,credentials)=>({userId:credentials.token,sessionId:randomUUID()})};
  const favorites=new MelomingFavoritesService(db.transactions,auth,repository);
  const songbook=new SongbookService(db.transactions,auth,repository);
  await db.transactions.write(async tx=>{
    const artistId=await nextChannelContentId(tx.prisma);
    await tx.prisma.artist.create({data:{id:artistId,name:'가수',nameSearchable:'가수',channelId:roomId}});
    await tx.prisma.song.create({data:{id:await nextChannelContentId(tx.prisma),title:'노래',titleSearchable:'노래',artistId,channelId:roomId}});
  });
  const songId=(await db.transactions.read(tx=>tx.prisma.song.findFirstOrThrow({select:{id:true}}))).id;
  assert.deepEqual(await favorites.channelCount(1),{channelId:1,totalFavorites:0});
  assert.equal((await favorites.toggleChannel({token:fanId},1)).isFavorite,true);
  assert.equal((await favorites.toggleChannel({token:fanId},1,true)).isFavorite,true);
  assert.equal((await favorites.channelStatus({token:fanId},1)).isFavorite,true);
  assert.equal((await favorites.channels({token:fanId},{})).total,1);
  assert.equal((await favorites.toggleSong({token:fanId},songId)).isFavorite,true);
  assert.equal((await favorites.songStatus({token:fanId},songId)).isFavorite,true);
  assert.equal((await favorites.songCount(songId)).totalFavorites,1);
  assert.equal((await songbook.list({},{token:fanId})).songs[0].isFavorite,true);
  assert.equal((await songbook.detail(songId,{token:fanId})).isFavorite,true);
  assert.equal((await songbook.favoriteSongsByChannel({token:fanId},{})).total,1);
  assert.equal((await favorites.songs({token:fanId},{})).favorites[0].songTitle,'노래');
  assert.deepEqual(await favorites.stats({token:fanId}),{myChannelFavorites:1,mySongFavorites:1});
  assert.equal((await favorites.users({token:ownerId},1,{})).total,1);
  assert.equal((await favorites.anniversaries({token:fanId})).items.length,1);
  assert.equal((await favorites.reorder({token:fanId},[1])).success,true);
  assert.equal((await favorites.removeSong({token:fanId},songId)).isFavorite,false);
  assert.equal((await songbook.favoriteSongsByChannel({token:fanId},{})).total,0);
  assert.equal((await favorites.toggleChannel({token:fanId},1)).isFavorite,false);
  assert.deepEqual(await favorites.stats({token:fanId}),{myChannelFavorites:0,mySongFavorites:0});
  await favorites.toggleChannel({token:fanId},1);
  const cleanup=new AccountCleanupRepository();
  assert.equal(await db.transactions.write(tx=>cleanup.channelContent(tx,fanId,100)),1);
  assert.equal((await favorites.channelCount(1)).totalFavorites,0);
});

test('copied song add request flow creates, approves, rejects and cancels against one owner room',async t=>{
  const {db,ownerId,fanId}=await fixture(t);
  const repository=new ChannelContentRepository();
  const auth={require:async(_tx,credentials)=>({userId:credentials.token,sessionId:randomUUID()})};
  const requests=new MelomingSongAddRequestService(db.transactions,auth,repository);
  assert.deepEqual(await requests.permission({token:fanId}),{channelId:1,hasPermission:false,canRequestSong:true});
  assert.deepEqual(await requests.permission({token:ownerId}),{channelId:1,hasPermission:true,canRequestSong:false});
  const input={channelId:1,title:'테스트 노래',artistName:'새 가수',categoryNames:['발라드','재즈']};
  const created=await requests.create({token:fanId},input);
  assert.equal(created.status,'PENDING');
  assert.equal(created.requester.nickname,'팬');
  assert.equal(created.channel.id,1);
  await assert.rejects(requests.create({token:fanId},input));
  assert.equal((await requests.my({token:fanId},{})).items.length,1);
  assert.equal((await requests.channelRequests({token:ownerId},{})).pendingCount,1);
  await assert.rejects(requests.approve({token:fanId},created.id,{}));
  const approved=await requests.approve({token:ownerId},created.id,{});
  assert.equal(approved.status,'APPROVED');
  assert.ok(approved.approvedSong?.id);
  assert.equal(approved.processedBy.nickname,'소유자');
  assert.equal(await db.transactions.read(tx=>tx.prisma.song.count()),1);
  assert.equal(await db.transactions.read(tx=>tx.prisma.category.count()),2);
  await assert.rejects(requests.approve({token:ownerId},created.id,{}));
  const rejected=await requests.create({token:fanId},{channelId:1,title:'거절 노래',artistName:'가수'});
  assert.equal((await requests.reject({token:ownerId},rejected.id,{reason:'중복'})).status,'REJECTED');
  const canceled=await requests.create({token:fanId},{channelId:1,title:'취소 노래',artistName:'가수'});
  await assert.rejects(requests.cancel({token:ownerId},canceled.id));
  assert.equal((await requests.cancel({token:fanId},canceled.id)).status,'CANCELED');
  assert.equal((await requests.my({token:fanId},{status:'PENDING'})).items.length,0);
});

test('copied setlist methods filter completed public sessions and enforce owner visibility',async t=>{
  const {db,roomId,ownerId,fanId}=await fixture(t);
  const repository=new ChannelContentRepository();
  const auth={require:async(_tx,credentials)=>({userId:credentials.token,sessionId:randomUUID()})};
  const setlists=new MelomingSetlistService(db.transactions,auth,repository);
  assert.deepEqual(await setlists.availability({identifier:'hurogi'}),{available:false,count:0});
  const sessionId=await db.transactions.write(async tx=>{
    const id=await nextChannelContentId(tx.prisma);
    await tx.prisma.liveSession.create({data:{id,channelId:roomId,userId:ownerId,status:'ENDED',
      startedAt:new Date('2026-09-01T10:00:00Z'),endedAt:new Date('2026-09-01T11:00:00Z'),overlayToken:'test-only'}});
    await tx.prisma.liveSessionSettings.create({data:{id:await nextChannelContentId(tx.prisma),liveSessionId:id,showRequesterName:false}});
    await tx.prisma.songRequest.create({data:{id:await nextChannelContentId(tx.prisma),liveSessionId:id,
      rawArtist:'가수',rawTitle:'노래',requesterPlatformId:'test-fan',requesterNickname:'팬',
      requestUserId:fanId,status:'COMPLETED',playedAt:new Date('2026-09-01T10:15:00Z')}});
    await tx.prisma.songRequest.create({data:{id:await nextChannelContentId(tx.prisma),liveSessionId:id,
      rawArtist:'가수',rawTitle:'대기곡',requesterPlatformId:'test-fan',requesterNickname:'팬',status:'PENDING'}});
    return id;
  });
  assert.deepEqual(await setlists.availability({identifier:'hurogi'}),{available:true,count:1});
  const listed=await setlists.publicList({identifier:'hurogi'});
  assert.equal(listed.total,1);
  assert.equal(listed.setlists[0].sessionId,sessionId);
  assert.equal(listed.setlists[0].completedCount,1);
  const detail=await setlists.detail(sessionId,{identifier:'hurogi'});
  assert.equal(detail.songs.length,1);
  assert.equal(detail.songs[0].requesterNickname,'');
  assert.equal(detail.songs[0].isAnonymous,true);
  assert.equal(detail.songs[0].clip,null);
  await assert.rejects(setlists.manage({token:fanId},{identifier:'hurogi'}));
  assert.equal((await setlists.manage({token:ownerId},{identifier:'hurogi'})).total,1);
  await assert.rejects(setlists.visibility({token:fanId},sessionId,{identifier:'hurogi'},{visibility:'PRIVATE'}));
  assert.deepEqual(await setlists.visibility({token:ownerId},sessionId,{identifier:'hurogi'},{visibility:'PRIVATE'}),
    {sessionId,visibility:'PRIVATE'});
  assert.deepEqual(await setlists.availability({identifier:'hurogi'}),{available:false,count:0});
  await assert.rejects(setlists.detail(sessionId,{identifier:'hurogi'}));
  assert.equal((await setlists.manage({token:ownerId},{identifier:'hurogi'})).setlists[0].visibility,'PRIVATE');
  await assert.rejects(setlists.publicList({identifier:'hurogi',from:'2026-09-01T00:00:00Z'}));
});

test('copied channel song request settings persist while no live session exists',async t=>{
  const {db,ownerId,fanId}=await fixture(t);
  const repository=new ChannelContentRepository();
  const auth={require:async(_tx,credentials)=>({userId:credentials.token,sessionId:randomUUID()})};
  const settings=new MelomingSongRequestSettingsService(db.transactions,auth,repository);
  await assert.rejects(settings.get({token:fanId}));
  const original=await settings.get({token:ownerId});
  assert.equal(original.channelId,1);
  assert.equal(original.maxQueueSize,50);
  await assert.rejects(settings.update({token:fanId},{maxQueueSize:12}));
  assert.throws(()=>settings.update({token:ownerId},{maxQueueSize:0}));
  const saved=await settings.update({token:ownerId},{maxQueueSize:12,allowAnonymous:true,blockedCategoryIds:[3]});
  assert.equal(saved.maxQueueSize,12);
  assert.equal(saved.allowAnonymous,true);
  assert.deepEqual(saved.blockedCategoryIds,[3]);
  assert.deepEqual(await settings.get({token:ownerId}),saved);
});

test('ported live session start, public active, end and history use owner room',async t=>{
  const {db,ownerId,fanId}=await fixture(t);
  await db.transactions.write(tx=>tx.prisma.platform_soop.create({data:{id:randomUUID(),user_id:ownerId,
    provider_subject:Buffer.from('hurogi'),status:'VERIFIED',verified_at:new Date()}}));
  const repository=new ChannelContentRepository();
  const auth={require:async(_tx,credentials)=>({userId:credentials.token,sessionId:randomUUID()})};
  const live=new MelomingLiveSessionService(db.transactions,auth,repository);
  const channel=new MelomingChannelService(db.transactions,auth,repository);
  assert.deepEqual((await channel.detail()).verifications,[{platform:'SOOP',platformChannelId:'hurogi'}]);
  const requests=new MelomingLiveSongRequestService(db.transactions,auth,repository);
  await assert.rejects(live.start({token:fanId},{identifier:'hurogi'},{}));
  const started=await live.start({token:ownerId},{identifier:'hurogi'},{platform:'SOOP'});
  assert.equal(started.channelId,1);
  assert.equal(started.status,'ACTIVE');
  assert.equal(started.platformChannelId,'hurogi');
  assert.equal(started.settings.maxQueueSize,50);
  assert.equal((await live.active({token:ownerId},{identifier:'hurogi'})).id,started.id);
  assert.equal((await live.publicActive({},{identifier:'hurogi'})).sessionId,started.id);
  await assert.rejects(live.start({token:ownerId},{identifier:'hurogi'},{}));
  await assert.rejects(live.updateSettings({token:fanId},started.id,{maxQueueSize:12}));
  const updated=await live.updateSettings({token:ownerId},started.id,{maxQueueSize:12,requestEnabled:false,paused:true});
  assert.equal(updated.maxQueueSize,12);
  assert.equal(updated.requestEnabled,false);
  assert.equal(updated.paused,false);
  assert.equal((await live.active({token:ownerId},{identifier:'hurogi'})).settings.maxQueueSize,12);
  await assert.rejects(live.end({token:fanId},started.id));
  const ended=await live.end({token:ownerId},started.id);
  assert.equal(ended.status,'ENDED');
  assert.equal(await live.active({token:ownerId},{identifier:'hurogi'}),null);
  assert.equal((await live.history({token:ownerId},{identifier:'hurogi'})).pagination.total,1);
  assert.equal((await live.detail({token:ownerId},started.id)).id,started.id);
  await assert.rejects(live.clone({token:fanId},started.id,{identifier:'hurogi'}));
  const cloned=await live.clone({token:ownerId},started.id,{identifier:'hurogi'});
  assert.equal(cloned.status,'ACTIVE');
  assert.equal(cloned.settings.requestEnabled,false);
  assert.notEqual(cloned.id,started.id);
  await live.end({token:ownerId},cloned.id);
  const privateSession=await live.start({token:ownerId},{identifier:'hurogi'},{practiceMode:true});
  assert.equal((await live.publicActive({},{identifier:'hurogi'})).isLive,false);
  assert.equal((await live.publicActive({token:ownerId},{identifier:'hurogi'})).sessionId,privateSession.id);
  await assert.rejects(requests.queue({}, {sessionId:String(privateSession.id)}));
  await assert.rejects(requests.queue({token:fanId}, {sessionId:String(privateSession.id)}));
  assert.equal((await requests.queue({token:ownerId}, {sessionId:String(privateSession.id)})).total,0);
  await assert.rejects(requests.create({token:fanId},{liveSessionId:privateSession.id,rawArtist:'가수',rawTitle:'노래'}));
  await live.end({token:ownerId},privateSession.id);
});

test('ported live song requests persist queue, owner controls and completed setlist',async t=>{
  const {db,roomId,ownerId,fanId}=await fixture(t);
  const repository=new ChannelContentRepository();
  const auth={require:async(_tx,credentials)=>({userId:credentials.token,sessionId:randomUUID()})};
  const live=new MelomingLiveSessionService(db.transactions,auth,repository);
  const requests=new MelomingLiveSongRequestService(db.transactions,auth,repository);
  const settings=new MelomingSongRequestSettingsService(db.transactions,auth,repository);
  const setlists=new MelomingSetlistService(db.transactions,auth,repository);
  const songId=await db.transactions.write(async tx=>{
    const artistId=await nextChannelContentId(tx.prisma);
    await tx.prisma.artist.create({data:{id:artistId,name:'원본 가수',nameSearchable:'원본가수',channelId:roomId}});
    const id=await nextChannelContentId(tx.prisma);
    await tx.prisma.song.create({data:{id,title:'원본 곡',titleSearchable:'원본곡',artistId,channelId:roomId}});
    return id;
  });
  const session=await live.start({token:ownerId},{identifier:'hurogi'},{});
  assert.deepEqual(await requests.operator({}, {channelId:'1'}),{isOperator:false});
  assert.deepEqual(await requests.operator({token:ownerId},{channelId:'1'}),{isOperator:true});
  const first=await requests.create({token:fanId},{liveSessionId:session.id,songId,rawArtist:'',rawTitle:'',
    requesterPlatformId:'forged-id',requesterNickname:'forged-name',source:'DONATION',donationAmount:100000});
  assert.equal(first.status,'PENDING');
  assert.equal(first.rawTitle,'원본 곡');
  assert.equal(first.requesterNickname,'팬');
  assert.notEqual(first.requesterPlatformId,'forged-id');
  assert.equal(first.donationAmount,null);
  assert.deepEqual(await requests.requestedIds({}, {sessionId:String(session.id)}),{songIds:[songId]});
  assert.equal((await requests.stats({channelId:'1',songId:String(songId)})).totalRequestCount,1);
  assert.equal((await requests.history({channelId:'1',songId:String(songId)})).requests[0].requesterNickname,'팬');
  await settings.update({token:ownerId},{preventDuplicateSongs:true});
  await assert.rejects(requests.create({token:fanId},{liveSessionId:session.id,songId,rawArtist:'',rawTitle:''}));
  const manual=await requests.manual({token:ownerId},session.id,{rawArtist:'수동 가수',rawTitle:'수동 곡',position:'FRONT'});
  assert.equal(manual.queueOrder,0);
  assert.equal((await requests.queue({}, {sessionId:String(session.id)})).total,2);
  await assert.rejects(requests.status({token:fanId},first.id,{status:'REJECTED'}));
  assert.equal((await requests.advance({token:ownerId},{sessionId:String(session.id)},'next')).id,manual.id);
  assert.equal((await requests.nowPlaying({}, {sessionId:String(session.id)})).id,manual.id);
  assert.equal((await requests.advance({token:ownerId},{sessionId:String(session.id)},'next')).id,first.id);
  assert.equal((await requests.status({token:ownerId},first.id,{status:'COMPLETED'})).status,'COMPLETED');
  await live.end({token:ownerId},session.id);
  assert.equal((await setlists.publicList({identifier:'hurogi'})).total,1);
  assert.equal((await setlists.detail(session.id,{identifier:'hurogi'})).songs.length,2);
  const cloned=await live.clone({token:ownerId},session.id,{identifier:'hurogi'});
  const clonedRows=await requests.queue({token:ownerId},{sessionId:String(cloned.id),includeCompleted:'true'});
  assert.equal(clonedRows.total,2);
  assert.equal(clonedRows.requests.some(item=>item.status==='COMPLETED'),true);
  await live.end({token:ownerId},cloned.id);
});

test('anonymous web requests use channel permission and server-generated identity',async t=>{
  const {db,roomId,ownerId}=await fixture(t);
  const repository=new ChannelContentRepository();
  const auth={require:async(_tx,credentials)=>({userId:credentials.token,sessionId:randomUUID()})};
  const live=new MelomingLiveSessionService(db.transactions,auth,repository);
  const requests=new MelomingLiveSongRequestService(db.transactions,auth,repository);
  const settings=new MelomingSongRequestSettingsService(db.transactions,auth,repository);
  const songId=await db.transactions.write(async tx=>{
    const artistId=await nextChannelContentId(tx.prisma);
    await tx.prisma.artist.create({data:{id:artistId,name:'익명 테스트 가수',nameSearchable:'익명테스트가수',channelId:roomId}});
    const id=await nextChannelContentId(tx.prisma);
    await tx.prisma.song.create({data:{id,title:'익명 테스트 곡',titleSearchable:'익명테스트곡',artistId,channelId:roomId}});
    return id;
  });
  const session=await live.start({token:ownerId},{identifier:'hurogi'},{});
  const body={liveSessionId:session.id,songId,rawArtist:'가짜',rawTitle:'가짜',anonymousNickname:' 시청자 ',
    requesterPlatformId:'forged',requesterNickname:'forged',source:'DONATION',donationAmount:10000};
  await assert.rejects(requests.create({},body,'anon_test_client'));
  await settings.update({token:ownerId},{allowAnonymous:true});
  const created=await requests.create({},body,'anon_test_client');
  assert.equal(created.requesterPlatformId,'anon_test_client');
  assert.equal(created.requesterNickname,'익명 (웹신청) 시청자');
  assert.equal(created.isAnonymous,true);
  assert.equal(created.requestUserId,null);
  assert.equal(created.donationAmount,null);
  assert.equal(created.rawTitle,'익명 테스트 곡');
  await settings.update({token:ownerId},{requestMode:'VERIFIED_ONLY'});
  await assert.rejects(requests.create({},body,'anon_second_client'));
});

test('copied Meloming pricing settings calculate category and song prices for live requests',async t=>{
  const {db,roomId,ownerId,fanId}=await fixture(t);
  const repository=new ChannelContentRepository();
  const auth={require:async(_tx,credentials)=>({userId:credentials.token,sessionId:randomUUID()})};
  const pricing=new MelomingPricingService(db.transactions,auth,repository);
  const live=new MelomingLiveSessionService(db.transactions,auth,repository);
  const requests=new MelomingLiveSongRequestService(db.transactions,auth,repository);
  const {songId,categoryId}=await db.transactions.write(async tx=>{
    const artistId=await nextChannelContentId(tx.prisma);
    await tx.prisma.artist.create({data:{id:artistId,name:'가격 가수',nameSearchable:'가격가수',channelId:roomId}});
    const categoryId=await nextChannelContentId(tx.prisma);
    await tx.prisma.category.create({data:{id:categoryId,name:'가격 분류',color:'#ffffff',channelId:roomId}});
    const songId=await nextChannelContentId(tx.prisma);
    await tx.prisma.song.create({data:{id:songId,title:'가격 곡',titleSearchable:'가격곡',artistId,channelId:roomId,difficulty:2}});
    await tx.prisma.songCategory.create({data:{id:await nextChannelContentId(tx.prisma),songId,categoryId}});
    return {songId,categoryId};
  });
  assert.equal((await pricing.get()).pricingEnabled,false);
  await assert.rejects(pricing.update({token:fanId},{pricingEnabled:true}));
  const settings=await pricing.update({token:ownerId},{pricingEnabled:true,defaultPrice:10,
    difficultyPrices:{'2':20},currencyConfigs:[{key:'SOOP_BALLOON',unit:'별풍선'}]});
  assert.equal(settings.pricingEnabled,true);
  assert.equal((await pricing.songPrice(songId)).price,20);
  assert.equal((await pricing.updateItem({token:ownerId},categoryId,'category',{price:30})).price,30);
  assert.equal((await pricing.songPrice(songId)).price,30);
  assert.equal((await pricing.updateItem({token:ownerId},songId,'song',{price:40})).price,40);
  assert.equal((await pricing.songPrice(songId)).formattedPrice,'40별풍선');
  assert.equal((await pricing.calculate({songIds:[songId]}))[0].source,'SONG');
  const session=await live.start({token:ownerId},{identifier:'hurogi'},{});
  const created=await requests.create({token:fanId},{liveSessionId:session.id,songId,rawArtist:'',rawTitle:''});
  assert.equal(created.calculatedPrice,40);
  assert.equal(created.formattedPrice,'40별풍선');
});

test('copied Omakase settings, balance journal and manual song selection share one owner transaction',async t=>{
  const {db,roomId,ownerId,fanId}=await fixture(t);
  const repository=new ChannelContentRepository();
  const auth={require:async(_tx,credentials)=>({userId:credentials.token,sessionId:randomUUID()})};
  const omakase=new MelomingOmakaseService(db.transactions,auth,repository);
  const live=new MelomingLiveSessionService(db.transactions,auth,repository);
  const songId=await db.transactions.write(async tx=>{
    const artistId=await nextChannelContentId(tx.prisma);
    await tx.prisma.artist.create({data:{id:artistId,name:'오마카세 가수',nameSearchable:'오마카세가수',channelId:roomId}});
    const id=await nextChannelContentId(tx.prisma);
    await tx.prisma.song.create({data:{id,title:'오마카세 곡',titleSearchable:'오마카세곡',artistId,channelId:roomId}});
    return id;
  });
  await assert.rejects(omakase.get({token:fanId}));
  assert.deepEqual(await omakase.get({token:ownerId}),{channelId:1,enabled:false,displayName:'후마카세',price:0,currencyPrices:null,count:0});
  assert.throws(()=>omakase.update({token:ownerId},{price:-1}));
  assert.equal((await omakase.update({token:ownerId},{enabled:true,displayName:'후로기 선곡',price:100,
    currencyPrices:{SOOP_BALLOON:1}})).price,100);
  const session=await live.start({token:ownerId},{identifier:'hurogi'},{});
  await assert.rejects(omakase.setCount({token:fanId},{liveSessionId:session.id,count:2}));
  assert.equal((await omakase.setCount({token:ownerId},{liveSessionId:session.id,count:2})).count,2);
  assert.equal((await omakase.adjust({token:ownerId},{liveSessionId:session.id,delta:-1,reason:'테스트'})).count,1);
  const selected=await omakase.consume({token:ownerId},{request:{liveSessionId:session.id,songId,
    rawArtist:'',rawTitle:''},playNow:true});
  assert.equal(selected.status.count,0);
  assert.equal(selected.request.status,'PLAYING');
  await assert.rejects(omakase.consume({token:ownerId},{request:{liveSessionId:session.id,songId,
    rawArtist:'',rawTitle:''}}));
  const history=await omakase.history({token:ownerId},50);
  assert.deepEqual(history.map(row=>row.type),['CONSUME_PLAY_NOW','MANUAL_DECREMENT','MANUAL_SET']);
  assert.equal(history[0].actorUserId,(await db.transactions.read(tx=>tx.prisma.melomingUserAlias.findUnique({where:{userId:ownerId}}))).id);
  assert.equal((await omakase.get({token:ownerId})).count,0);
});

test('copied album art search resolves exact and bulk song matches from channel song rows',async t=>{
  const {db,roomId}=await fixture(t);
  await db.transactions.write(async tx=>{
    const artistId=await nextChannelContentId(tx.prisma);
    await tx.prisma.artist.create({data:{id:artistId,name:'앨범 가수',nameSearchable:'앨범가수',channelId:roomId}});
    await tx.prisma.song.create({data:{id:await nextChannelContentId(tx.prisma),title:'앨범 노래',
      titleSearchable:'앨범노래',artistId,channelId:roomId,albumArt:'https://example.org/cover.png'}});
  });
  const result=await db.transactions.read(tx=>new SongAlbumArtService(tx.prisma).searchAlbumArtFromDB('앨범 노래','앨범 가수'));
  assert.equal(result.result.matchType,'exact');
  assert.equal(result.result.albumArt,'https://example.org/cover.png');
  const bulk=await db.transactions.read(tx=>new SongAlbumArtService(tx.prisma).bulkSearchAlbumArtFromDB([
    {title:'앨범 노래',artist:'앨범 가수'},{title:'없는 노래',artist:'없는 가수'}]));
  assert.equal(bulk.successCount,1);
  assert.equal(bulk.failCount,1);
});
