const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {initializeTestEnvironment,assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
const {doc,setDoc,getDoc,deleteField,Timestamp}=require('firebase/firestore');
let env;
before(async()=>{
 if(!process.env.FIRESTORE_EMULATOR_HOST)throw Error('Run npm run test:firestore; never point these tests at production.');
 env=await initializeTestEnvironment({projectId:'demo-linkup',firestore:{rules:fs.readFileSync('firestore.rules','utf8')}});
});
after(async()=>{await env?.cleanup();});
const identity={uid:'owner',displayName:'Tanaka Fixture',username:'tanakafixture',profileLink:'https://www.linkupbuild.com/app/p/owner'};
const core={...identity,occupation:'Founder',company:'LINKUP',bio:'Building a professional network.',city:'Harare',country:'Zimbabwe',age:25,skills:['React'],interests:[],industries:[],lookingFor:[],languages:[],goals:'Build',experience:'Experienced',startupStage:'Building MVP',fundingStage:'Bootstrapped',availability:'Part time',commitmentLevel:'Part time',workStyle:'Remote',networkingIntent:'Collaborators',ambition:'Build',timezone:'Africa/Harare',education:'',remoteOnly:false,willingToRelocate:false,teamSizePreference:'',personalityType:'',isStealthMode:false,hideOnlineStatus:false,isVisible:true,turboConnect:false,founderScore:35,reputationMetrics:{reliability:50,responseRate:0,collaboration:40,consistency:30,completion:20}};
const optional={roleAnswers:{manualSignals:['Builder']},resume:{shippedProducts:['LINKUP'],sideProjects:[],startupAttempts:[],hackathonWins:[],buildStreaks:5},socialLinks:{portfolio:'https://example.com',linkedin:'https://www.linkedin.com/in/fixture',github:'',tiktok:'',instagram:'',twitter:''},settings:{publicDiscovery:true,stealthMode:false,turboConnect:false,hideOnlineStatus:false,darkMode:false},vibeMedia:'',photos:[],projects:[{id:'p',title:'LINKUP',description:'A real project fixture',status:'mvp'}],startupIdeas:[]};
async function seed(extra={}) {
 await env.clearFirestore();
 await env.withSecurityRulesDisabled(async context=>setDoc(doc(context.firestore(),'users/owner'),{uid:'owner',displayName:'Old fixture name',...extra}));
 return env.authenticatedContext('owner').firestore();
}
for(const [name,existing] of Object.entries({free:{},verifiedPlus:{isPro:true,plan:'plus',subscriptionPlan:'plus',isVerified:true,verificationProgram:'LINKUP PLUS',verifiedBy:'server',verifiedAt:Timestamp.fromMillis(1000)},legacy:{company:'x'.repeat(200),bio:'Legacy bio',role:'admin',isPro:false,isVerified:false}})) {
 test(`the real two-section profile save stays within the rules budget for ${name}`,async()=>{
  const db=await seed(existing),ref=doc(db,'users/owner');
  await assertSucceeds(setDoc(ref,core,{merge:true}));
  await assertSucceeds(setDoc(ref,{...identity,...optional},{merge:true}));
  const saved=(await getDoc(ref)).data();assert.equal(saved.bio,core.bio);assert.equal(saved.resume.shippedProducts[0],'LINKUP');assert.equal(saved.socialLinks.portfolio,'https://example.com');
  for(const field of ['isPro','plan','isVerified','verificationProgram','verifiedBy'])if(field in existing)assert.equal(saved[field],existing[field]);
 });
}
test('a single bio edit does not revalidate unrelated malformed legacy fields',async()=>{
 const db=await seed({company:'x'.repeat(200),resume:'old legacy format'});
 await assertSucceeds(setDoc(doc(db,'users/owner'),{bio:'Updated bio'},{merge:true}));
});
test('profile ownership is enforced, including UID changes and anonymous writes',async()=>{
 await seed();
 for(const db of [env.authenticatedContext('stranger').firestore(),env.unauthenticatedContext().firestore()])await assertFails(setDoc(doc(db,'users/owner'),{bio:'Not mine'},{merge:true}));
 await assertFails(setDoc(doc(env.authenticatedContext('owner').firestore(),'users/owner'),{uid:'someone-else'},{merge:true}));
});
test('clients cannot grant PLUS, admin, billing flags or arbitrary blue verification',async()=>{
 const db=await seed();
 for(const patch of [{isPro:true},{plan:'plus'},{subscriptionPlan:'plus'},{subscriptionStatus:'active'},{isAdmin:true},{role:'admin'},{entitlements:{plus:true}},{isVerified:true,verificationProgram:'LINKUP PLUS',verifiedBy:'server'},{approvedByAdmin:true}])await assertFails(setDoc(doc(db,'users/owner'),patch,{merge:true}));
});
test('Turbo Connect remains restricted to existing PLUS entitlements',async()=>{
 let db=await seed();await assertFails(setDoc(doc(db,'users/owner'),{turboConnect:true},{merge:true}));await assertFails(setDoc(doc(db,'users/owner'),{settings:{turboConnect:true}},{merge:true}));
 db=await seed({isPro:true});await assertSucceeds(setDoc(doc(db,'users/owner'),{turboConnect:true,settings:{turboConnect:true}},{merge:true}));
});
test('new values still obey type, length, range and map-key limits',async()=>{
 const db=await seed();
 for(const patch of [{username:'x'.repeat(31)},{occupation:'x'.repeat(81)},{bio:'x'.repeat(2001)},{company:42},{age:12},{age:121},{age:25.5},{skills:'React'},{photos:['a','b','c','d']},{roleAnswers:Array.from({length:31},(_,i)=>[i,i]).reduce((o,[k,v])=>({...o,[k]:v}),{})},{settings:{darkMode:'yes'}},{settings:{admin:true}},{founderScore:101},{reputationMetrics:{responseRate:'50'}},{reputationMetrics:{reliability:-1}},{reputationMetrics:{reliability:NaN}}])await assertFails(setDoc(doc(db,'users/owner'),patch,{merge:true}));
});
test('short-string validation accepts line breaks and Unicode without dropping length limits',async()=>{
 const db=await seed();await assertSucceeds(setDoc(doc(db,'users/owner'),{company:'A\nB',city:'São Tomé',occupation:'開発者'},{merge:true}));await assertFails(setDoc(doc(db,'users/owner'),{occupation:'開'.repeat(81)},{merge:true}));
});
test('profile updates cannot delete a validated field or write the server quota ledger',async()=>{
 const db=await seed({bio:'Existing bio'});await assertFails(setDoc(doc(db,'users/owner'),{bio:deleteField()},{merge:true}));await assertFails(setDoc(doc(db,'linkyUsage/owner'),{month:{count:0}},{merge:true}));
});
test('new normal profiles remain creatable without minting paid or verification flags',async()=>{
 await env.clearFirestore();const db=env.authenticatedContext('new-member').firestore();await assertSucceeds(setDoc(doc(db,'users/new-member'),{uid:'new-member',displayName:'New Member',bio:'Hello',turboConnect:false}));
 await assertFails(setDoc(doc(env.authenticatedContext('imposter').firestore(),'users/imposter'),{uid:'imposter',displayName:'Imposter',isPro:true,isVerified:true}));
});
