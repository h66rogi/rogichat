import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { io } from 'socket.io-client';
import { MelomingSongLiveGateway } from '../../dist/modules/channel-content/meloming-song-live.gateway.js';

test('copied song-live client joins its room and receives queue changes', async t => {
  const server=createServer();
  const gateway=new MelomingSongLiveGateway({httpAdapter:{getHttpServer:()=>server}},
    {origin:'http://localhost:3001'},{draining:false});
  gateway.onApplicationBootstrap();
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(async()=>{await gateway.onModuleDestroy();});
  const client=io(`http://127.0.0.1:${server.address().port}/song-live`,{
    path:'/socket.io',transports:['websocket'],reconnection:false,timeout:1500,
    extraHeaders:{Origin:'http://localhost:3001'},
  });
  t.after(()=>client.disconnect());
  await once(client,'connect');
  const joined=once(client,'joined');
  client.emit('join',{identifier:'hurogi'});
  assert.deepEqual((await joined)[0],{channelId:1,room:'song-live:channel:1',session:null});
  const event=once(client,'request.added');
  gateway.broadcast('request.added',{sessionId:12});
  assert.deepEqual((await event)[0],{sessionId:12});
  const left=once(client,'left');
  client.emit('leave');
  await left;
});
