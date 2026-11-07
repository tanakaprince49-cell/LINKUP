import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createPublicSeoHandler} from '../api/publicSeo.js';

async function request(mode) {
  const res = {headers:{},code:0,body:'',setHeader(k,v){this.headers[k.toLowerCase()]=v;},status(c){this.code=c;return this;},send(b){this.body=b;return this;}};
  const forbiddenDb = () => { throw new Error('Retired Linky pages must not read profile data.'); };
  await createPublicSeoHandler(forbiddenDb, undefined, null)({query:{mode},method:'GET'},res);
  return res;
}

test('retired LvlUp founder-screening SEO endpoints return 410 before profile reads',async()=>{
  for (const mode of ['lvlup','lvlupBreakouts']) {
    const res=await request(mode);
    assert.equal(res.code,410);
    assert.equal(res.headers['x-robots-tag'],'noindex');
    assert.match(res.body,/Linky now focuses on matching project teams and recommending roles/);
  }
});

test('LvlUp Linky investor-matching screen and deep link are no longer registered',()=>{
  const app=fs.readFileSync(new URL('../mobile/App.tsx',import.meta.url),'utf8');
  assert.doesNotMatch(app,/LvlupDemo|publicPaths[^\n]*lvlup|LvlupDemo:\s*'lvlup'/);
});
