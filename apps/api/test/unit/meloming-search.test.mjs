import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { SearchCache } from '../../dist/modules/channel-content/upstream/serper/search-cache.js';
import { SearxngImageSearchService } from '../../dist/modules/channel-content/upstream/serper/searxng-image-search.service.js';

test('copied SearXNG image search filters blocked URLs and caches the result',async t=>{
  let requests=0;
  const server=createServer((request,response)=>{
    requests++;
    const url=new URL(request.url,'http://localhost');
    assert.equal(url.pathname,'/search');
    assert.equal(url.searchParams.get('format'),'json');
    response.setHeader('content-type','application/json');
    response.end(JSON.stringify({results:[
      {title:'표지',img_src:'https://example.org/cover.png',url:'https://example.org/song',
        thumbnail_src:'https://example.org/thumb.png',resolution:'300x300',engines:['duckduckgo images']},
      {title:'차단',img_src:'https://i.namu.wiki/bad.png',engines:['duckduckgo images']},
      {title:'다른 엔진',img_src:'https://example.org/other.png',engines:['bing images']},
    ]}));
  });
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const address=server.address();
  const config={get:key=>key==='SEARXNG_BASE_URL'?`http://127.0.0.1:${address.port}`:undefined};
  const service=new SearxngImageSearchService(new SearchCache(),config);
  const first=await service.searchImages({title:'제목',artist:'가수'});
  const second=await service.searchImages({title:'제목',artist:'가수'});
  assert.equal(first.images.length,1);
  assert.equal(first.images[0].imageWidth,300);
  assert.equal(first.images[0].link,'https://example.org/song');
  assert.deepEqual(second,first);
  assert.equal(requests,1);
});
