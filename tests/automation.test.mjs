import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const source=readFileSync(new URL("../scripts/automation.js",import.meta.url),"utf8");
globalThis.foundry={utils:{deepClone:structuredClone}};
globalThis.game={user:{isGM:true},dice3d:null,combat:null};
globalThis.ui={notifications:{warn:()=>{}}};
const {createAutomation,EFFECT_SCHEMA,defaultEffect,findAdjacentSpawnPosition,footprintsTouch,perEntityDice,shouldUseManualDamage}=await import("data:text/javascript;charset=utf-8,"+encodeURIComponent(source));

function setup(){
  const actor={uuid:"Actor.source",system:{attributes:{hp:{value:10,max:20,temp:0}}}};
  const target={id:"target",name:"Target",center:{x:120,y:100},w:100,h:100,actor,
    document:{id:"target",uuid:"Scene.token.target",x:100,y:100,disposition:1,getFlag:()=>null}};
  let sceneTokens=[target],deleted=[];
  globalThis.canvas={tokens:{get placeables(){return sceneTokens}},grid:{size:100},
    scene:{grid:{distance:5},tokens:{get contents(){return sceneTokens.map(t=>t.document)},get:id=>sceneTokens.find(t=>t.document.id===id)?.document},
      async deleteEmbeddedDocuments(type,ids){deleted.push(...ids);sceneTokens=sceneTokens.filter(t=>!ids.includes(t.document.id))}}};
  const events=[];
  const engine=createAutomation({M:"test",el:()=>({color:"#ffffff"}),
    setElement:async(t,id)=>events.push("element:"+t.id+":"+id),
    damage:async(a,t,formula,type)=>events.push("damage:"+t.id+":"+formula+":"+type)});
  return {engine,actor,target,events,deleted,addToken:t=>sceneTokens.push(t)};
}
test("all available actions are represented by editable defaults",()=>{
  for(const type of Object.keys(EFFECT_SCHEMA))assert.equal(defaultEffect(type).type,type);
});
test("nested effects execute in sequence from one to N",async()=>{
  const {engine,actor,target,events}=setup();
  const c=engine.makeContext({sourceActor:actor,targetToken:target});
  await engine.runEffects([
    {type:"applyElement",elementId:"fire"},
    {type:"sequence",steps:[
      {type:"damage",formula:"1d4",damageType:"fire",damageMode:"automatic"},
      {type:"applyElement",elementId:"ice"}]}
  ],c);
  assert.deepEqual(events,["element:target:fire","damage:target:1d4:fire","element:target:ice"]);
});
test("clear assigned entity then target an area at its former position",async()=>{
  const {engine,actor,target,events,deleted,addToken}=setup();
  const summon={id:"summon",center:{x:100,y:100},w:100,h:100,actor,
    document:{id:"summon",uuid:"Scene.token.summon",disposition:-1,getFlag:(scope,key)=>key==="summoned"?{entityRef:"rimebud"}:null}};
  addToken(summon);
  const c=engine.makeContext({sourceActor:actor,targetToken:target,entities:{rimebud:[summon]}});
  await engine.runEffects([
    {type:"clearEntity",entityRef:"rimebud"},
    {type:"damage",formula:"1d4",damageType:"acid",targetMode:"area",origin:"entity",
      entityRef:"rimebud",radius:5,targetFilter:"all"}
  ],c);
  assert.deepEqual(deleted,["summon"]);
  assert.deepEqual(events,["damage:target:1d4:acid"]);
});
test("variant matching respects pair, priority preconditions and HP",()=>{
  const {engine,actor,target}=setup();
  target.actor.system.attributes.hp.value=4;
  const context={sourceActor:actor,targetToken:target,firstElement:"fire",secondElement:"ice"};
  assert.equal(engine.variantMatches({enabled:true,elements:["ice","fire"],condition:{type:"targetHpBelow",value:"50"}},context),true);
  assert.equal(engine.variantMatches({enabled:true,elements:["ice","fire"],condition:{type:"targetHpBelow",value:"20"}},context),false);
  assert.equal(engine.variantMatches({enabled:false,elements:["ice","fire"],condition:{type:"always"}},context),false);
  assert.equal(engine.variantMatches({enabled:true,elements:["wind","ice"],condition:{type:"always"}},context),false);
});

test("summoned Actor runs initiative ticks, nested expiry effects, then clears token",async()=>{
  const {actor,target,events,deleted,addToken}=setup();
  const summonedActor={documentName:"Actor",uuid:"Actor.rimebud",
    async getTokenDocument(position){return {width:1,height:1,toObject:()=>({...position,width:1,height:1,name:"Rimebud"})}}};
  globalThis.fromUuid=async uuid=>uuid===summonedActor.uuid?summonedActor:actor;
  globalThis.game.combat={round:1};
  let created=null,entityState=null;
  canvas.scene.createEmbeddedDocuments=async(type,docs)=>{
    assert.equal(type,"Token");
    const token={id:"rimebud",center:{x:docs[0].x+50,y:docs[0].y+50},w:100,h:100,actor,document:null};
    const doc={id:"rimebud",x:docs[0].x,y:docs[0].y,width:1,height:1,uuid:"Scene.token.rimebud",disposition:1,object:token,
      async setFlag(m,k,value){entityState=value},
      getFlag(m,k){return k==="summoned"?entityState:null}};
    token.document=doc;created=token;addToken(token);
    return [doc];
  };
  const engine=createAutomation({M:"test",el:()=>({color:"#fff"}),
    setElement:async()=>{},damage:async(a,t,formula,type)=>events.push("hit:"+t.id+":"+type),
    ensureCollective:async()=>{}});
  const c=engine.makeContext({sourceActor:actor,targetToken:target,firstElement:"ice",secondElement:"nature",
    reaction:{id:"ice-nature",name:"Rimebud"}});
  await engine.runEffects([{type:"summon",actorUuid:summonedActor.uuid,entityRef:"rimebud",quantity:1,lifetime:2,
    onTick:[{type:"damage",formula:"1d4",damageType:"acid",targetMode:"target"}],
    onExpire:[{type:"damage",formula:"1d4",damageType:"fire",targetMode:"target"}]}],c);
  assert.equal(created.id,"rimebud");
  await engine.tickEntities();
  assert.deepEqual(events,["hit:rimebud:acid"]);
  game.combat.round=2;
  await engine.tickEntities();
  assert.deepEqual(events,["hit:rimebud:acid","hit:rimebud:acid"]);
  game.combat.round=3;
  await engine.tickEntities();
  assert.deepEqual(events,["hit:rimebud:acid","hit:rimebud:acid","hit:rimebud:fire"]);
  assert.deepEqual(deleted,["rimebud"]);
});


const intersects=(a,b)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
const minGap=(a,b)=>Math.hypot(
  Math.max(a.x-b.x-b.width,b.x-a.x-a.width,0),
  Math.max(a.y-b.y-b.height,b.y-a.y-a.height,0)
);
test("Large 10x10 dire wolf never receives a summon inside its footprint",()=>{
  const wolf={x:200,y:200,width:200,height:200}; // 2x2, on a 5 ft / 100 px grid
  const blocker={x:400,y:200,width:100,height:100};
  const options={target:wolf,spawnWidth:100,spawnHeight:100,occupants:[wolf,blocker],
    gridSize:100,gridDistance:5,maxFeet:5,
    sceneRect:{x:0,y:0,width:700,height:700}};
  const positions=new Set();
  for(let i=0;i<=20;i++){
    const pos=findAdjacentSpawnPosition({...options,rng:()=>i/20});
    assert.ok(pos,"At least one free adjacent square must exist");
    const summoned={...pos,width:100,height:100};
    assert.equal(intersects(summoned,wolf),false,"Summon must not occupy any of the 2x2 wolf grid cells");
    assert.equal(intersects(summoned,blocker),false,"Summon must avoid the occupied square");
    assert.ok(minGap(summoned,wolf)<=100,"Placement must be within 5 feet of wolf's edge");
    assert.equal(pos.x%100,0,"Grid x aligned");
    assert.equal(pos.y%100,0,"Grid y aligned");
    positions.add(JSON.stringify(pos));
  }
  assert.ok(positions.size>4,"Random selection offers several distinct free locations");
});
test("placement considers the summon Actor's own multi-cell token dimensions",()=>{
  const wolf={x:200,y:200,width:200,height:200};
  for(const rng of [()=>0,()=>0.5,()=>0.9999]){
    const pos=findAdjacentSpawnPosition({target:wolf,spawnWidth:200,spawnHeight:100,
      occupants:[wolf,{x:0,y:200,width:200,height:200}],
      gridSize:100,gridDistance:5,maxFeet:5,
      sceneRect:{x:0,y:0,width:700,height:700},rng});
    assert.ok(pos);
    const summoned={...pos,width:200,height:100};
    assert.equal(intersects(summoned,wolf),false);
    assert.equal(intersects(summoned,{x:0,y:200,width:200,height:200}),false);
    assert.ok(minGap(summoned,wolf)<=100);
  }
});
test("when all free spaces are off-scene or occupied, placement returns null rather than overlapping",()=>{
  const target={x:0,y:0,width:300,height:300};
  assert.equal(findAdjacentSpawnPosition({target,spawnWidth:100,spawnHeight:100,
    occupants:[target],gridSize:100,gridDistance:5,
    sceneRect:{x:0,y:0,width:300,height:300}}),null);
});

test("Rimebud reaction callout is emitted once, not once for every affected token",()=>{
  const main=readFileSync(new URL("../scripts/main.js",import.meta.url),"utf8");
  const match=main.match(/async function runReaction\(r,c\)\{([\s\S]*?)\}\s*function layer\(\)/);
  assert.ok(match,"The reaction orchestrator must exist");
  const body=match[1];
  assert.match(body,/callout\(c\.targetToken,r,c\)/);
  assert.doesNotMatch(body,/for\s*\(const\s+t\s+of\s+ctx\.affected\).*callout\(/);
});
test("summon automation respects Large target and blocked adjacent grid locations end-to-end",async()=>{
  const {actor,target,addToken}=setup();
  target.document.x=200;target.document.y=200;target.document.width=2;target.document.height=2;
  target.w=200;target.h=200;target.center={x:300,y:300};
  // A 10x10-foot dire wolf with one blocked square to the east.
  const blocker={id:"blocker",actor,center:{x:450,y:250},w:100,h:100,
    document:{id:"blocker",uuid:"Scene.token.blocker",x:400,y:200,width:1,height:1,disposition:1,getFlag:()=>null}};
  addToken(blocker);
  const entityActor={documentName:"Actor",uuid:"Actor.rimebud",name:"Rimebud",
    async getTokenDocument(pos){return {width:1,height:1,toObject:()=>({...pos,width:1,height:1,name:"Rimebud"})}}};
  globalThis.fromUuid=async uuid=>uuid===entityActor.uuid?entityActor:actor;
  let placement=null;
  canvas.dimensions={sceneRect:{x:0,y:0,width:700,height:700}};
  canvas.scene.createEmbeddedDocuments=async(type,docs)=>{
    assert.equal(type,"Token");
    placement=docs[0];
    const token={id:"spawned",actor,center:{x:placement.x+50,y:placement.y+50},w:100,h:100};
    const doc={id:"spawned",x:placement.x,y:placement.y,width:1,height:1,uuid:"Scene.token.spawned",disposition:1,object:token,
      async setFlag(){},getFlag:()=>null};
    token.document=doc;addToken(token);
    return [doc];
  };
  const engine=createAutomation({M:"test",el:()=>({color:"#fff"}),
    setElement:async()=>{},damage:async()=>{},ensureCollective:async()=>{}});
  const context=engine.makeContext({sourceActor:actor,targetToken:target,
    reaction:{id:"ice-nature",name:"Rimebud"},firstElement:"ice",secondElement:"nature"});
  await engine.runEffects([{type:"summon",actorUuid:entityActor.uuid,entityRef:"rimebud",quantity:1,lifetime:2}],context);
  assert.ok(placement,"The Rimebud must spawn");
  const box={x:placement.x,y:placement.y,width:100,height:100};
  const wolf={x:200,y:200,width:200,height:200};
  assert.equal(intersects(box,wolf),false);
  assert.equal(intersects(box,{x:400,y:200,width:100,height:100}),false);
  assert.ok(minGap(box,wolf)<=100);
});


test("damage defaults to a manual chat roll for exactly one directly affected creature",async()=>{
  const {actor,target,events}=setup();
  const queued=[];
  const engine=createAutomation({M:"test",el:()=>({color:"#fff"}),
    setElement:async()=>{},damage:async()=>events.push("HP changed"),
    queueManualDamage:async data=>{queued.push(data);return {id:"message-1"};}});
  const c=engine.makeContext({sourceActor:actor,targetToken:target,reaction:{id:"fire-ice",name:"Frostburn"}});
  await engine.runEffects([{type:"damage",formula:"2d6",damageType:"cold"}],c);
  assert.equal(events.length,0,"No HP must be modified when the direct damage roll is posted");
  assert.equal(queued.length,1);
  assert.equal(queued[0].reaction.name,"Frostburn");
  assert.equal(queued[0].targetToken,target);
  assert.equal(queued[0].damageType,"cold");
  assert.equal(shouldUseManualDamage({}, {}, 1),true);
  assert.equal(shouldUseManualDamage({targetMode:"area"},{},1),false);
  assert.equal(shouldUseManualDamage({damageMode:"automatic"},{},1),false);
  assert.equal(shouldUseManualDamage({}, {autoDamage:true},1),false);
  assert.equal(shouldUseManualDamage({}, {},2),false);
});

test("explicit automatic and area damage bypass manual chat and apply immediately",async()=>{
  const {actor,target,events}=setup();
  const queued=[];
  const engine=createAutomation({M:"test",el:()=>({color:"#fff"}),
    setElement:async()=>{},damage:async(a,t,formula,type)=>events.push(type),
    queueManualDamage:async data=>queued.push(data)});
  const c=engine.makeContext({sourceActor:actor,targetToken:target});
  await engine.runEffects([
    {type:"damage",damageMode:"automatic",targetMode:"target",formula:"1d6",damageType:"acid"},
    {type:"damage",targetMode:"area",radius:5,formula:"1d4",damageType:"fire"}
  ],c);
  assert.deepEqual(events,["acid","fire"]);
  assert.deepEqual(queued,[]);
});

test("summon lifecycle direct damage is always automatic and never creates approval prompts",async()=>{
  const {actor,target,events,addToken}=setup();
  const creature={documentName:"Actor",uuid:"Actor.summon",name:"Rimebud",
    async getTokenDocument(loc){return {width:1,height:1,toObject:()=>({...loc,width:1,height:1})}}};
  globalThis.fromUuid=async id=>id===creature.uuid?creature:actor;
  game.combat={round:1};
  let state=null;
  canvas.scene.createEmbeddedDocuments=async(_,docs)=>{
    const doc={id:"bud",uuid:"Scene.bud",width:1,height:1,x:docs[0].x,y:docs[0].y,disposition:1,
      async setFlag(scope,key,v){state=v},getFlag:(scope,key)=>state};
    const token={id:"bud",w:100,h:100,actor,center:{x:doc.x+50,y:doc.y+50},document:doc};
    doc.object=token;addToken(token);return[doc];
  };
  const queued=[];
  const engine=createAutomation({M:"test",el:()=>({color:"#fff"}),
    setElement:async()=>{},damage:async(a,t,formula,type)=>events.push(t.id+":"+type),
    queueManualDamage:async data=>queued.push(data),ensureCollective:async()=>{}});
  await engine.runEffects([{type:"summon",actorUuid:creature.uuid,entityRef:"rimebud",lifetime:2,
    onTick:[{type:"damage",targetMode:"target",damageType:"acid",formula:"1d4"}]}],
    engine.makeContext({sourceActor:actor,targetToken:target,firstElement:"ice",secondElement:"nature"}));
  await engine.tickEntities();
  assert.deepEqual(events,["bud:acid"]);
  assert.equal(queued.length,0);
});


test("Enkindle only counts actual bordering footprints (including corners) around Large target",()=>{
  const wolf={x:200,y:200,width:200,height:200};
  assert.equal(footprintsTouch(wolf,{x:400,y:200,width:100,height:100}),true,"right edge");
  assert.equal(footprintsTouch(wolf,{x:100,y:100,width:100,height:100}),true,"diagonal corner");
  assert.equal(footprintsTouch(wolf,{x:250,y:400,width:100,height:100}),true,"bottom edge");
  assert.equal(footprintsTouch(wolf,{x:500,y:200,width:100,height:100}),false,"one full cell gap");
  assert.equal(footprintsTouch(wolf,{x:250,y:250,width:100,height:100}),false,"inside the wolf is overlap, not touching");
});
test("Enkindle rolls one independently randomized die per consumed Rimebud",()=>{
  assert.equal(perEntityDice("1d4",1),"1d4");
  assert.equal(perEntityDice("1d4",3),"3d4");
  assert.equal(perEntityDice("2d6+1",4),"8d6+4");
  assert.equal(perEntityDice("1d8+@mod",2),"(1d8+@mod) + (1d8+@mod)");
  assert.equal(perEntityDice("1d4",0),"0");
});
test("Enkindle consumes only touching Rimebuds and deals exactly N configured dice to the trigger target",async()=>{
  const {actor,target,events,deleted,addToken}=setup();
  target.document.x=200;target.document.y=200;target.document.width=2;target.document.height=2;
  target.w=200;target.h=200;target.center={x:300,y:300};
  let i=0;
  const bud=(x,y,ref="rimebud")=>{
    const id="bud"+(++i);
    const doc={id,x,y,width:1,height:1,uuid:"Scene."+id,disposition:1,
      getFlag:(scope,key)=>key==="summoned"?{entityRef:ref}:null};
    const token={id,w:100,h:100,center:{x:x+50,y:y+50},actor,document:doc};
    doc.object=token;addToken(token);
    return token;
  };
  bud(100,200);bud(400,300);bud(100,100); // 3 adjacent
  bud(500,200); // 1 square farther away: not touching
  bud(200,100,"another-summon"); // touching, but not a Rimebud
  let manualRequests=0;
  const engine=createAutomation({M:"test",el:()=>({color:"#fff"}),
    setElement:async()=>{},damage:async(a,t,formula,type)=>events.push([t.id,formula,type]),
    queueManualDamage:async()=>{manualRequests++}});
  const c=engine.makeContext({sourceActor:actor,targetToken:target,firstElement:"fire",secondElement:"nature",
    reaction:{name:"Enkindle",id:"fire-nature"}});
  await engine.runEffects([{type:"detonateEntity",entityRef:"rimebud",formula:"1d8",damageType:"fire"}],c);
  assert.deepEqual(deleted,["bud1","bud2","bud3"]);
  assert.deepEqual(events,[["target","3d8","fire"]]);
  assert.equal(manualRequests,0,"Enkindle damage should apply immediately, without a GM approval prompt");
});
test("Enkindle does not apply damage or delete anything when no Rimebuds touch target",async()=>{
  const {actor,target,deleted,events,addToken}=setup();
  const doc={id:"bud",x:300,y:100,width:1,height:1,getFlag:()=>({entityRef:"rimebud"})};
  addToken({id:"bud",actor,center:{x:350,y:150},w:100,h:100,document:doc});
  const engine=createAutomation({M:"test",el:()=>({color:"#fff"}),
    setElement:async()=>{},damage:async(a,t,formula,type)=>events.push(type)});
  await engine.runEffects([{type:"detonateEntity",entityRef:"rimebud",formula:"1d12",damageType:"fire"}],
    engine.makeContext({sourceActor:actor,targetToken:target}));
  assert.deepEqual(events,[]);
  assert.deepEqual(deleted,[]);
});
test("Rimebud placement prefers touching grid squares before more distant spaces",()=>{
  const wolf={x:200,y:200,width:200,height:200};
  for(const rng of [()=>0,()=>.1,()=>.25,()=>.5,()=>.75,()=>.9999]){
    const pos=findAdjacentSpawnPosition({target:wolf,spawnWidth:100,spawnHeight:100,
      occupants:[wolf],gridSize:100,gridDistance:5,maxFeet:5,
      sceneRect:{x:0,y:0,width:700,height:700},rng});
    assert.ok(pos);
    assert.equal(footprintsTouch(wolf,{...pos,width:100,height:100}),true);
  }
});


test("Enkindle also consumes Rhimebud spelling and custom Actor reference from Ice+Nature",async()=>{
  const {actor,target,events,deleted,addToken}=setup();
  target.document.x=200;target.document.y=200;target.document.width=2;target.document.height=2;
  target.w=200;target.h=200;
  const make=(id,x,y,state)=>{
    const doc={id,x,y,width:1,height:1,getFlag:(m,k)=>k==="summoned"?state:null};
    addToken({id,w:100,h:100,center:{x:x+50,y:y+50},actor,document:doc});
  };
  make("spelling",100,200,{entityRef:"rhimebud"});
  make("custom",400,200,{entityRef:"Dire Wolf Seed",reactionId:"ice-nature",firstElement:"ice",secondElement:"nature"});
  make("wrong",200,100,{entityRef:"other",reactionId:"fire-dark",firstElement:"fire",secondElement:"dark"});
  const engine=createAutomation({M:"test",el:()=>({color:"#fff"}),
    setElement:async()=>{},damage:async(a,t,formula,type)=>events.push({id:t.id,formula,type})});
  await engine.runEffects([{type:"detonateEntity",entityRef:"rimebud",formula:"1d6",damageType:"fire"}],
    engine.makeContext({sourceActor:actor,targetToken:target}));
  assert.deepEqual(deleted,["spelling","custom"]);
  assert.deepEqual(events,[{id:"target",formula:"2d6",type:"fire"}]);
});
