import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ChannelContentRepository } from '../../dist/modules/channel-content/channel-content.repository.js';
import { MelomingSongRequestSettingsService } from '../../dist/modules/channel-content/meloming-song-request-settings.service.js';
import { MelomingLiveSessionService } from '../../dist/modules/channel-content/meloming-live-session.service.js';
import { MelomingLiveSongRequestService } from '../../dist/modules/channel-content/meloming-live-song-request.service.js';
import { nextChannelContentId } from '../../dist/modules/channel-content/channel-content-id.js';
import { MelomingPricingService } from '../../dist/modules/channel-content/meloming-pricing.service.js';
import { MelomingOmakaseService } from '../../dist/modules/channel-content/meloming-omakase.service.js';
import { SongAlbumArtService } from '../../dist/modules/channel-content/upstream/song-album-art.service.js';
import { fixture } from './channel-content-fixture.mjs';

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
  const session=await live.start({token:ownerId},{identifier:'h66rogi'},{});
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
  const session=await live.start({token:ownerId},{identifier:'h66rogi'},{});
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
  const session=await live.start({token:ownerId},{identifier:'h66rogi'},{});
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
