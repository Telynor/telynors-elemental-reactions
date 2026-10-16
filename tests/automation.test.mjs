import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const source=readFileSync(new URL("../scripts/automation.js",import.meta.url),"utf8");
globalThis.foundry={utils:{deepClone:structuredClone}};
globalThis.game={user:{isGM:true},dice3d:null,combat:null};
globalThis.ui={notifications:{warn:()=>{}}};
const {createAutomation,EFFECT_SCHEMA,defaultEffect,findAdjacentSpawnPosition}=await import("data:text/javascript;charset=utf-8,"+encodeURIComponent(source));

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
      {type:"damage",formula:"1d4",damageType:"fire"},
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
