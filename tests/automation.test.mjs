import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const source=readFileSync(new URL("../scripts/automation.js",import.meta.url),"utf8");
globalThis.foundry={utils:{deepClone:structuredClone}};
globalThis.game={user:{isGM:true},dice3d:null,combat:null};
const {createAutomation,EFFECT_SCHEMA,defaultEffect}=await import("data:text/javascript;charset=utf-8,"+encodeURIComponent(source));

function setup(){
  const actor={uuid:"Actor.source",system:{attributes:{hp:{value:10,max:20,temp:0}}}};
  const target={id:"target",name:"Target",center:{x:120,y:100},w:100,h:100,actor,
    document:{id:"target",uuid:"Scene.token.target",disposition:1}};
  let sceneTokens=[target],deleted=[];
  globalThis.canvas={tokens:{get placeables(){return sceneTokens}},grid:{size:100},
    scene:{grid:{distance:5},tokens:{get:id=>sceneTokens.find(t=>t.document.id===id)?.document},
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
