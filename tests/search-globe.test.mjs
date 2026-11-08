import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { renderSearchPage, groupMembersByLocation, placeMembersOnEarth, locationLabels } from '../api/_searchGlobe.js';
import { createPublicSeoHandler } from '../api/publicSeo.js';
const rules = fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');

const member = (uid, name, city, country, image='') => ({uid,name,city,country,image,occupation:'Founder',company:'LINKUP project',skills:['Product','Engineering'],verified:true,url:`/app/p/${uid}`});

test('Search renders only the Earth, space, and profile picture markers with hover tooltip for name, city, country', () => {
  const people=[member('user_1','Ada Moyo','Harare','Zimbabwe','https://ik.imagekit.io/demo/ada.jpg'),member('user_2','Bola Ade','London','United Kingdom')];
  const html=renderSearchPage({members:people,nextCursor:'next-id'});
  assert.match(html,/https:\/\/www\.linkupbuild\.com\/app\/assets\/earth-blue-marble\.jpg/);
  assert.match(html,/#earthScene\{position:fixed;inset:0/);
  assert.match(html,/new THREE\.SphereGeometry\(radius,88,64\)/);
  assert.match(html,/id="markerLayer"/);
  assert.match(html,/id="globeTip"/);
  assert.match(html,/hoverText\(member\)\{return \[member\.name,member\.city,member\.country\]\.filter\(Boolean\)\.join\(', '\)\}/);
  assert.match(html,/https:\/\/ik\.imagekit\.io\/demo\/ada\.jpg/);
  assert.match(html,/LINKUP_EARTH=/);
  assert.match(html,/"name":"Ada Moyo","city":"Harare","country":"Zimbabwe"/);
  assert.doesNotMatch(html,/markerLabel|markerCount|Public profiles|Search public profiles|profileFilter|profileRail|profileCard|topbar|<input|<header|<section/i);
  assert.doesNotMatch(html,/cdn\.jsdelivr\.net\/npm\/three-globe[^'" ]*earth-blue-marble/);
  const scripts=[...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).filter(Boolean);
  assert.equal(scripts.length,2);for(const script of scripts)assert.doesNotThrow(()=>new Function(script),'inline profile/globe script parses');
  const texture=new URL('../mobile/public/assets/earth-blue-marble.jpg',import.meta.url);
  assert.ok(fs.statSync(texture).size>500_000,'bundled Blue Marble texture exists at production app asset path');
});

test('Globe projection matches the Earth texture mapping and places are labelled',()=>{
  const html=renderSearchPage({members:[member('u1','Ada Moyo','Harare','Zimbabwe'),member('u2','Tendai N','Harare','Zimbabwe'),member('u3','Bola Ade','Lagos','Nigeria')],nextCursor:null});
  // three.js SphereGeometry UV convention: texture point (lat,lng) sits at
  // (cos lat * cos lng, sin lat, -cos lat * sin lng). Any other anchor math
  // mirrors pins into the oceans.
  assert.match(html,/anchor\.position\.set\(radius\*Math\.cos\(lat\)\*Math\.cos\(lon\),radius\*Math\.sin\(lat\),-radius\*Math\.cos\(lat\)\*Math\.sin\(lon\)\)/);
  assert.match(html,/\.mapLabel\{/);
  assert.match(html,/"kind":"city","text":"Harare","lat":-17\.825,"lng":31\.033,"count":2/);
  assert.match(html,/"kind":"country","text":"Zimbabwe"/);
  assert.match(html,/"kind":"city","text":"Lagos"/);
});

test('locationLabels groups members under their real city and country anchors',()=>{
  const labels=locationLabels([member('a','A','Harare','Zimbabwe'),member('b','B','Harare','Zimbabwe'),member('c','C','Lagos','Nigeria'),member('d','D','','United States')]);
  const city=labels.find(l=>l.kind==='city'&&l.text==='Harare');
  assert.equal(city.count,2);assert.equal(city.lat,-17.825);assert.equal(city.lng,31.033);
  assert.equal(labels.find(l=>l.kind==='country'&&l.text==='Zimbabwe').count,2);
  assert.equal(labels.find(l=>l.kind==='country'&&l.text==='Nigeria').count,1);
  assert.equal(labels.find(l=>l.kind==='country'&&l.text==='United States').count,1);
  assert.equal(labels.some(l=>l.kind==='city'&&l.text==='United States'),false);
  const aliases=locationLabels([member('e','E','','USA'),member('f','F','','America'),member('g','G','','United States')]);
  const us=aliases.filter(l=>l.kind==='country');
  assert.equal(us.length,1);assert.equal(us[0].count,3);
});

test('placeMembersOnEarth pins located members at their city and never invents coordinates for unlocated members',()=>{
  const placed=placeMembersOnEarth([member('a','A','Harare','Zimbabwe','https://ik.imagekit.io/demo/a.jpg'),member('b','B','Harare','Zimbabwe'),member('c','C','','')]);
  assert.equal(placed.length,3);
  assert.equal(typeof placed[0].lat,'number');
  assert.equal(typeof placed[0].lng,'number');
  assert.equal(placed[0].city,'Harare');
  assert.equal(placed[0].country,'Zimbabwe');
  // Harare anchor is -17.825,31.033: same-city members fan out only slightly around it.
  for(const item of [placed[0],placed[1]]){
    assert.ok(Math.abs(item.lat+17.825)<=1.6,'lat stays near Harare');
    assert.ok(Math.abs(item.lng-31.033)<=1.8,'lng stays near Harare');
  }
  assert.notDeepEqual([placed[0].lat,placed[0].lng],[placed[1].lat,placed[1].lng]);
  // No location on file: no coordinates are invented for the third member.
  assert.equal(placed[2].lat,undefined);
  assert.equal(placed[2].lng,undefined);
  // Placement is stable: rendering already-placed members never moves a pin.
  assert.deepEqual(placeMembersOnEarth(placed),placed);
  const result=groupMembersByLocation([member('a','A','Harare','Zimbabwe'),member('b','B','Harare','Zimbabwe'),member('c','C','','')]);
  assert.equal(result.groups.length,1);assert.equal(result.groups[0].members.length,2);
  assert.deepEqual(result.unlocated,[2]);
});

test('placeMembersOnEarth keeps a large same-city cluster inside the city area',()=>{
  const many=Array.from({length:13},(_,i)=>member('u'+i,'Person '+String(i).padStart(2,'0'),'Harare','Zimbabwe'));
  const placed=placeMembersOnEarth(many);
  assert.equal(placed.length,13);
  for(const item of placed){
    assert.ok(Math.abs(item.lat+17.825)<=1.6,'lat stays near Harare');
    assert.ok(Math.abs(item.lng-31.033)<=1.8,'lng stays near Harare');
  }
  const pins=new Set(placed.map(m=>m.lat+','+m.lng));
  assert.equal(pins.size,13);
});

test('Search page counts builders on the map and lists unlocated builders by name instead of scattering them',()=>{
  const html=renderSearchPage({members:[member('u1','Mapped Person','Lagos','Nigeria'),member('u2','No Place Person','','')],nextCursor:null});
  assert.match(html,/1 builder on the map/);
  assert.match(html,/1 have not shared a location yet/);
  assert.match(html,/Not on the map yet \(1\)/);
  assert.match(html,/No Place Person/);
  assert.doesNotMatch(html,/"name":"No Place Person"[^}]*"lat"/);
});

test('Search walks bounded pages and loads all eligible public profiles onto the map',async()=>{
  assert.match(rules,/match \/publicProfiles\/\{userId\}[\s\S]*?allow list: if isSignedIn\(\) && request\.query\.limit != null && request\.query\.limit <= 100;/);
  assert.match(rules,/match \/users\/\{userId\}[\s\S]*?allow list: if isSignedIn\(\) && request\.query\.limit != null && request\.query\.limit <= 100;/);
  const users={};
  for(let i=0;i<45;i++) users[`profile_${String(i).padStart(3,'0')}`]={displayName:i===0?'Alice Public':`Person ${i}`,onboarded:true,isVisible:true,isStealthMode:false,city:'Harare',country:'Zimbabwe',skills:['Design']};
  users.profile_001.isVisible=false;
  const calls={limit:0,after:[],getAll:0};
  const ids=Object.keys(users).sort();
  const database={
    collection(name){let cursor='';const q={orderBy:()=>q,startAfter(value){cursor=value;calls.after.push(value);return q;},select:()=>q,limit(n){calls.limit=n;return q;},doc:id=>({id}),get:async()=>{const filtered=cursor?ids.filter(id=>id>cursor):ids;return{docs:filtered.slice(0,calls.limit).map(id=>({id}))}}};return q;},
    async getAll(...args){calls.getAll++;return args.filter(x=>x&&x.id).map(({id})=>({id,exists:!!users[id],data:()=>users[id]}));},
  };
  const response=()=>({headers:{},code:0,body:'',setHeader(k,v){this.headers[k.toLowerCase()]=v;},status(c){this.code=c;return this;},send(body){this.body=body;return this;}});
  const handler=createPublicSeoHandler(()=>database);
  const htmlRes=response();
  await handler({method:'GET',query:{mode:'search'}},htmlRes);
  assert.equal(htmlRes.code,200);
  assert.match(htmlRes.body,/Alice Public/);
  assert.doesNotMatch(htmlRes.body,/Hidden Person/);
  assert.match(htmlRes.body,/Person 39/);
  assert.match(htmlRes.body,/Person 44/);
  assert.equal(calls.limit,41);
  assert.equal(calls.getAll,2);
  assert.equal(htmlRes.headers['cache-control'],'private, no-store');
  assert.equal(htmlRes.headers['vercel-cdn-cache-control'],'public, s-maxage=30');
  assert.match(htmlRes.headers['content-security-policy'],/img-src https:/);

  const dataRes=response();
  await handler({method:'GET',query:{mode:'search-data',after:'profile_039'}},dataRes);
  assert.equal(dataRes.code,200);const body=JSON.parse(dataRes.body);
  assert.equal(body.members.length,5);assert.equal(body.nextCursor,null);
  assert.equal(body.members[0].city,'Harare');assert.equal(body.members[0].country,'Zimbabwe');
  assert.equal(dataRes.headers['vercel-cdn-cache-control'],'public, s-maxage=30');
});
