import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { ChannelContentRepository } from '../../dist/modules/channel-content/channel-content.repository.js';
import { MelomingSongAddRequestService } from '../../dist/modules/channel-content/meloming-song-add-request.service.js';
import { MelomingSetlistService } from '../../dist/modules/channel-content/meloming-setlist.service.js';
import { MelomingSongRequestSettingsService } from '../../dist/modules/channel-content/meloming-song-request-settings.service.js';
import { SongbookService } from '../../dist/modules/channel-content/songbook.service.js';
import { nextChannelContentId } from '../../dist/modules/channel-content/channel-content-id.js';
import { AccountCleanupRepository } from '../../dist/modules/deletion/account-cleanup.repository.js';
import { MelomingUploadService } from '../../dist/modules/channel-content/meloming-upload.service.js';
import { MelomingFavoritesService } from '../../dist/modules/channel-content/meloming-favorites.service.js';
import { MelomingMrVideoService } from '../../dist/modules/channel-content/meloming-mr-video.service.js';
import { Readable } from 'node:stream';
import { fixture } from './channel-content-fixture.mjs';

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
  assert.equal((await videos.stream(song.id,upload.key.split('/')[2],'bytes=0-4')).total,1024);
  await assert.rejects(videos.stream(song.id+1,upload.key.split('/')[2]));
  assert.equal((await videos.remove({token:ownerId},song.id)).mrVideoUrl,null);
  assert.equal(objects.size,0);
});
test('wardrobe image upload requires owner and returns a public durable image stream',async t=>{
  const {db,ownerId,fanId}=await fixture(t);
  const scratch=await mkdtemp(join(tmpdir(),'rogichat-image-scratch-test-'));
  const previousScratch=process.env.MEDIA_SCRATCH_DIR;
  process.env.MEDIA_SCRATCH_DIR=scratch;
  t.after(async()=>{if(previousScratch===undefined)delete process.env.MEDIA_SCRATCH_DIR;else process.env.MEDIA_SCRATCH_DIR=previousScratch;await rm(scratch,{recursive:true,force:true});});
  const objects=new Map();
  const store={
    put:async(key,path,bytes,type)=>{
      assert.ok(path.startsWith(scratch+sep));
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
  assert.deepEqual(await setlists.availability({identifier:'h66rogi'}),{available:false,count:0});
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
  assert.deepEqual(await setlists.availability({identifier:'h66rogi'}),{available:true,count:1});
  const listed=await setlists.publicList({identifier:'h66rogi'});
  assert.equal(listed.total,1);
  assert.equal(listed.setlists[0].sessionId,sessionId);
  assert.equal(listed.setlists[0].completedCount,1);
  const detail=await setlists.detail(sessionId,{identifier:'h66rogi'});
  assert.equal(detail.songs.length,1);
  assert.equal(detail.songs[0].requesterNickname,'');
  assert.equal(detail.songs[0].isAnonymous,true);
  assert.equal(detail.songs[0].clip,null);
  await assert.rejects(setlists.manage({token:fanId},{identifier:'h66rogi'}));
  assert.equal((await setlists.manage({token:ownerId},{identifier:'h66rogi'})).total,1);
  await assert.rejects(setlists.visibility({token:fanId},sessionId,{identifier:'h66rogi'},{visibility:'PRIVATE'}));
  assert.deepEqual(await setlists.visibility({token:ownerId},sessionId,{identifier:'h66rogi'},{visibility:'PRIVATE'}),
    {sessionId,visibility:'PRIVATE'});
  assert.deepEqual(await setlists.availability({identifier:'h66rogi'}),{available:false,count:0});
  await assert.rejects(setlists.detail(sessionId,{identifier:'h66rogi'}));
  assert.equal((await setlists.manage({token:ownerId},{identifier:'h66rogi'})).setlists[0].visibility,'PRIVATE');
  await assert.rejects(setlists.publicList({identifier:'h66rogi',from:'2026-09-01T00:00:00Z'}));
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
