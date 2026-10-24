import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from '../mobile/node_modules/typescript/lib/typescript.js';
import React from '../mobile/node_modules/react/index.js';
import {GOLD_MEMBER_UID,GOLD_MEMBER_LABEL,isGoldMember} from '../shared/member-badges.js';
import {projectProfile,renderProfile,renderDirectory,publicEligible} from '../api/_publicSeo.js';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
function load(path,mocks){
 const module={exports:{}};
 const code=ts.transpileModule(read(path),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
 vm.runInNewContext(code,{module,exports:module.exports,require:n=>{assert.ok(n in mocks,n);return mocks[n];},console});
 return module.exports.default;
}
const VerifiedBadge=load('mobile/src/components/VerifiedBadge.tsx',{'react':React,'react-native':{View:'View',StyleSheet:{create:x=>x}},'lucide-react-native':{Check:'Check'}});
const MemberBadges=load('mobile/src/components/MemberBadges.tsx',{'react':React,'react-native':{View:'View'},'./VerifiedBadge':{default:VerifiedBadge,__esModule:true},'../../../shared/member-badges':{isGoldMember}});
const children=element=>React.Children.toArray(element?.props.children);
const base={displayName:'Tanaka Gaadzikwa',onboarded:true,skills:[],projects:[]};

test('gold entitlement is one exact immutable UID, not a name, email or editable flag',()=>{
 assert.equal(isGoldMember(GOLD_MEMBER_UID),true);
 for(const id of [undefined,null,'',GOLD_MEMBER_UID+' ',GOLD_MEMBER_UID.toLowerCase(),'Tanaka Gaadzikwa','tanakaprince49@gmail.com',{uid:GOLD_MEMBER_UID},true])assert.equal(isGoldMember(id),false);
 const fake=projectProfile('imposter',{...base,goldVerified:true,isGold:true,isCEO:true});
 assert.doesNotMatch(renderProfile(fake),/GOLD member CEO|Gold verified/);
});
test('exclusive owner gets exactly blue and gold checks even with an old missing verification flag',()=>{
 for(const verified of [true,false,undefined]){
  const badges=children(MemberBadges({userId:GOLD_MEMBER_UID,verified,size:22}));
  assert.equal(badges.length,2);assert.equal(badges[0].props.color,undefined);
  assert.equal(badges[1].props.color,'#e0be1b');assert.equal(badges[1].props.checkColor,'#FFFFFF');
  assert.match(badges[1].props.accessibilityLabel,/Gold verified/);
 }
});
test('ordinary verified members keep one blue check and everyone else gets none',()=>{
 assert.equal(children(MemberBadges({userId:'ordinary',verified:true})).length,1);
 assert.equal(MemberBadges({userId:'ordinary',verified:false}),null);
 assert.equal(MemberBadges({verified:false}),null);
});
test('gold artwork actually uses gold fill, white check and an accessible label',()=>{
 const art=VerifiedBadge({size:24,color:'#e0be1b',checkColor:'#FFFFFF',accessibilityLabel:'Gold verified — LINKUP CEO'});
 assert.equal(art.props.accessibilityLabel,'Gold verified — LINKUP CEO');
 const shapes=children(art);assert.equal(shapes.length,16);
 assert.equal(shapes.at(-1).props.color,'#FFFFFF');
 assert.ok(shapes.slice(0,-1).every(s=>s.props.style.some(x=>x?.backgroundColor==='#e0be1b')));
});
test('public profile and directory render the same exclusive pair and exact CEO label',()=>{
 const owner=projectProfile(GOLD_MEMBER_UID,{...base,isVerified:false});
 const html=renderProfile(owner);
 assert.match(html,/fill="#e0be1b"/);
 assert.match(html,/stroke="#FFFFFF"/);
 assert.equal((html.match(/aria-label="Verified"/g)||[]).length,1);
 assert.equal((html.match(/aria-label="Gold verified/g)||[]).length,1);
 assert.ok(html.indexOf(GOLD_MEMBER_LABEL)>html.indexOf('trusted, high-signal voice'));
 assert.match(renderDirectory([owner]),/Gold verified/);
 assert.equal(publicEligible({...base,isVisible:false},GOLD_MEMBER_UID),false);
 assert.equal(publicEligible({...base,isStealthMode:true},GOLD_MEMBER_UID),false);
});
test('every existing member-name badge surface uses the identity-aware renderer',()=>{
 assert.match(read('mobile/src/screens/CityLeagueScreen.tsx'),/TrendingBuildersScreen/);
 const expected={MatchScreen:'otherUser.uid',MessagesScreen:'otherUser.uid',ChatScreen:'otherUser.uid',SearchScreen:'item.uid',ActiveOpportunitiesScreen:'item.uid',RecommendedMatchesScreen:'item.uid',ActiveOpportunityScreen:'profile?.uid',IdeaDeckScreen:'idea.ownerId',DiscoveryDashboardScreen:'item.uid',FeedScreen:'post.authorId',ViewersScreen:'item.uid',TrendingBuildersScreen:'r.uid',ProfileScreen:'profile?.uid',LinkyHomeScreen:'card.targetUid',AlertsScreen:'notification.fromId',GamificationHubScreen:'c.senderId',CampaignsScreen:'campaign.ownerId'};
 for(const [name,id] of Object.entries(expected))assert.ok(read(`mobile/src/screens/${name}.tsx`).includes(`MemberBadges userId={${id}}`),name);
 assert.match(read('mobile/src/components/LinkyCardsSection.tsx'),/MemberBadges userId=\{card.targetUid\}/);
 assert.match(read('mobile/src/screens/FeedScreen.tsx'),/MemberBadges userId=\{reply.userId\}/);
 assert.match(read('mobile/src/screens/FeedScreen.tsx'),/MemberBadges userId=\{item.userId\}/);
});
test('profile CEO label stays immediately after the existing high-signal notice, not a paid-plan condition',()=>{
 const s=read('mobile/src/screens/ProfileScreen.tsx');
 assert.ok(s.includes('isViewingOther && isGoldMember(profile?.uid) && !isEditing'));
 const text=s.indexOf('This verified builder has been marked');
 const gold=s.indexOf('GOLD member CEO',text);
 assert.ok(text>0&&gold>text&&gold-text<1200);
});
test('Linky owns its full screen and keeps activity out of the main conversation',()=>{
 const app=read('mobile/App.tsx');
 assert.match(app,/<Tab.Screen name="LinkyHome"[^\n]+headerShown: false[^\n]+display: 'none'/);
 const screen=read('mobile/src/screens/LinkyHomeScreen.tsx');
 assert.match(screen,/accessibilityLabel="Back to network" onPress=\{\(\) => navigation.navigate\('Dashboard'\)/);
 const start=screen.indexOf('<ScrollView\n        ref={scrollRef}');
 const end=screen.indexOf('</ScrollView>',start),chat=screen.slice(start,end);
 assert.ok(start>0&&end>start);assert.match(chat,/styles.conversation/);
 assert.doesNotMatch(chat,/Waiting on you|home\.loop|SponsoredSlot|styles\.hero/);
 assert.match(screen.slice(screen.indexOf('<Modal visible={activityOpen}')),/Waiting on you/);
 assert.match(screen,/paddingBottom: composerHeight \+ 16/);
 assert.match(screen,/bottom: Platform.OS === 'android' \? androidKeyboardHeight : 0/);
 assert.match(screen,/accessibilityLabel="Message Linky"/);
});


test('Linky header includes an accessible blue verification check beside its title',()=>{
 const s=read('mobile/src/screens/LinkyHomeScreen.tsx');
 assert.match(s,/>Linky<\/Text>\s*<VerifiedBadge size=\{18\} accessibilityLabel="Verified Linky AI"/);
});
