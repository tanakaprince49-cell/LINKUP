import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { renderSearchPage, groupMembersByLocation } from '../api/_searchGlobe.js';
import { createPublicSeoHandler } from '../api/publicSeo.js';

const member = (uid, name, city, country, image='') => ({uid,name,city,country,image,occupation:'Founder',company:'LINKUP project',skills:['Product','Engineering'],verified:true,url:`/app/p/${uid}`});

test('Search shows live public profiles on the Earth and in a searchable photo rail', () => {
  const people=[member('harare','Ada Moyo','Harare','Zimbabwe','https://ik.imagekit.io/demo/ada.jpg'),member('london','Bola Ade','London','United Kingdom')];
  const html=renderSearchPage({members:people});
  assert.match(html,/https:\/\/www\.linkupbuild\.com\/app\/assets\/earth-blue-marble\.jpg/);
  assert.match(html,/#earthScene\{position:fixed;inset:0/);
  assert.match(html,/new THREE\.SphereGeometry\(radius,88,64\)/);
  assert.match(html,/Search LINKUP public profiles/);
  assert.match(html,/id="markerLayer"/);assert.match(html,/id="profileFilter"/);assert.match(html,/id="profiles"/);
  assert.match(html,/Ada Moyo/);assert.match(html,/Bola Ade/);assert.match(html,/Harare, Zimbabwe/);
  assert.match(html,/LINKUP_SEARCH=/);assert.match(html,/aria-label="Open Ada Moyo’s profile"/);
  assert.doesNotMatch(html,/cdn\.jsdelivr\.net\/npm\/three-globe[^'" ]*earth-blue-marble/);
  const scripts=[...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).filter(Boolean);
  assert.equal(scripts.length,2);for(const script of scripts)assert.doesNotThrow(()=>new Function(script),'inline profile/globe script parses');
  const texture=new URL('../mobile/public/assets/earth-blue-marble.jpg',import.meta.url);
  assert.ok(fs.statSync(texture).size>500_000,'bundled Blue Marble texture exists at production app asset path');
});

test('member locations group into usable Earth markers while unknown locations remain in the profile rail',()=>{
  const result=groupMembersByLocation([member('a','A','Harare','Zimbabwe'),member('b','B','Harare','Zimbabwe'),member('c','C','','')]);
  assert.equal(result.groups.length,1);assert.equal(result.groups[0].members.length,2);assert.equal(result.groups[0].label,'Harare');
  assert.deepEqual(result.unlocated,[2]);
});

test('Search API embeds only currently eligible profiles and is never edge-cached',async()=>{
  const users={
    alice:{displayName:'Alice Public',onboarded:true,isVisible:true,isStealthMode:false,city:'Harare',country:'Zimbabwe',skills:['Design']},
    hidden:{displayName:'Hidden Person',onboarded:true,isVisible:false,isStealthMode:false,city:'Harare',country:'Zimbabwe'},
  };
  const database={
    collection(name){let q; q={orderBy:()=>q,select:()=>q,limit:()=>q,doc:id=>({id}),get:async()=>({docs:Object.keys(users).map(id=>({id}))})};return q;},
    async getAll(...refs){return refs.map(({id})=>({id,exists:!!users[id],data:()=>users[id]}));},
  };
  const response={headers:{},code:0,body:'',setHeader(k,v){this.headers[k.toLowerCase()]=v;},status(c){this.code=c;return this;},send(body){this.body=body;return this;}};
  await createPublicSeoHandler(()=>database)({method:'GET',query:{mode:'search'}},response);
  assert.equal(response.code,200);assert.match(response.body,/Alice Public/);assert.doesNotMatch(response.body,/Hidden Person/);
  assert.equal(response.headers['cache-control'],'private, no-store');
  assert.match(response.headers['content-security-policy'],/img-src https:/);
});
