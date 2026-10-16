import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const source=readFileSync(new URL("../scripts/manual-damage.js",import.meta.url),"utf8");
const {createManualDamageFlow}=await import("data:text/javascript;charset=utf-8,"+encodeURIComponent(source));

const M="telynors-elemental-reactions";
function setup(){
  const handlers=new Map(),messages=new Map(),notices=[];
  const caster={uuid:"Actor.caster",name:"Caster",getRollData:()=>({bonus:2})};
  const wolf={uuid:"Actor.wolf",name:"Dire Wolf"};
  const goblin={uuid:"Actor.goblin",name:"Goblin"};
  const wolfToken={name:"Dire Wolf",actor:wolf,document:{uuid:"Scene.Wolf",name:"Dire Wolf"}};
  const goblinToken={name:"Goblin",actor:goblin,document:{uuid:"Scene.Goblin",name:"Goblin"}};
  globalThis.Hooks={on:(name,callback)=>handlers.set(name,callback)};
  globalThis.game={
    user:{id:"GM1",isGM:true,targets:new Set([wolfToken])},
    users:new Map([["GM1",{id:"GM1",active:true}],["GM2",{id:"GM2",active:true}]]),
    messages
  };
  globalThis.canvas={tokens:{placeables:[wolfToken,goblinToken],controlled:[]}};
  globalThis.ui={notifications:{warn:x=>notices.push("warn:"+x),info:x=>notices.push("info:"+x),error:x=>notices.push("error:"+x)}};
  let rolls=0,posted=0,dialogOptions=null;
  globalThis.Roll=class{
    constructor(formula,data){this.formula=formula;this.data=data;this.total=9}
    async evaluate(){rolls++;return this}
    async toMessage(data,options){
      posted++;
      assert.equal(options.messageMode,"public");
      const flags=structuredClone(data.flags[M]);
      const message={
        id:"message-"+posted,flavor:data.flavor,rolls:[this],
        getFlag:(scope,key)=>flags[key],
        async setFlag(scope,key,value){assert.equal(scope,M);flags[key]=structuredClone(value)}
      };
      messages.set(message.id,message);
      return message;
    }
  };
  globalThis.ChatMessage={getSpeaker:({actor})=>({alias:actor?.name||"GM"})};
  globalThis.fromUuid=async uuid=>uuid===caster.uuid?caster:null;
  globalThis.foundry={applications:{api:{DialogV2:{
    async input(options){dialogOptions=options;return {targetUuid:"Scene.Goblin"}}
  }}}};
  const delivered=[];
  const flow=createManualDamageFlow({M,applyRolledDamage:async args=>{delivered.push(args);return args.amount}});
  return {flow,caster,wolfToken,goblinToken,handlers,messages,notices,delivered,
    get rolls(){return rolls},get posted(){return posted},get dialogOptions(){return dialogOptions}};
}

test("one direct reaction roll goes to chat without changing HP and is applied exactly once",async()=>{
  const e=setup();
  const message=await e.flow.queueDamage({
    formula:"2d6+2",damageType:"cold",sourceActor:e.caster,
    reaction:{name:"Frostburn"},targetToken:e.wolfToken
  });
  assert.equal(e.rolls,1);
  assert.equal(e.posted,1);
  assert.equal(e.delivered.length,0,"No damage should apply when dice are rolled into chat");
  assert.equal(message.getFlag(M,"pendingReactionDamage").amount,9);
  assert.equal(message.getFlag(M,"pendingReactionDamage").status,"pending");
  assert.match(message.flavor,/Frostburn/);
  assert.equal(await e.flow.applyPendingDamage(message,"Scene.Goblin"),true);
  assert.equal(e.delivered.length,1);
  assert.equal(e.delivered[0].targetToken,e.goblinToken);
  assert.equal(e.delivered[0].sourceActor,e.caster);
  assert.equal(e.delivered[0].damageType,"cold");
  assert.equal(e.delivered[0].amount,9);
  assert.equal(message.getFlag(M,"pendingReactionDamage").status,"applied");
  assert.equal(message.getFlag(M,"pendingReactionDamage").appliedToName,"Goblin");
  assert.equal(await e.flow.applyPendingDamage(message,"Scene.Wolf"),false,"A used chat roll cannot be re-applied");
  assert.equal(e.delivered.length,1);
  assert.equal(e.rolls,1,"Using the Apply Damage button must not re-roll");
});

test("choose target shows the entire scene and lets GM override the original target",async()=>{
  const e=setup();
  const state={amount:7,damageType:"acid",reactionName:"Rimebud",originalTargetUuid:e.wolfToken.document.uuid};
  const tokenUuid=await e.flow.chooseTarget(state);
  assert.equal(tokenUuid,e.goblinToken.document.uuid);
  assert.match(e.dialogOptions.content,/<select name="targetUuid" required>/);
  assert.match(e.dialogOptions.content,/Dire Wolf/);
  assert.match(e.dialogOptions.content,/Goblin/);
  assert.match(e.dialogOptions.content,/value="Scene.Wolf" selected/);
  assert.equal(e.delivered.length,0,"Opening the creature picker must never change HP");
});

test("only the originating GM can apply while online; backup GM can apply after disconnect",async()=>{
  const e=setup();
  const message=await e.flow.queueDamage({
    formula:"1d6",damageType:"fire",sourceActor:e.caster,reaction:{name:"Reaction"},targetToken:e.wolfToken
  });
  game.user.id="GM2";
  assert.equal(await e.flow.applyPendingDamage(message,e.goblinToken.document.uuid),false);
  assert.equal(e.delivered.length,0);
  game.users.get("GM1").active=false;
  assert.equal(await e.flow.applyPendingDamage(message,e.goblinToken.document.uuid),true);
  assert.equal(e.delivered.length,1);
});

test("invalid or missing token selection cannot consume a pending roll or apply damage",async()=>{
  const e=setup();
  const message=await e.flow.queueDamage({
    formula:"1d6",damageType:"fire",sourceActor:e.caster,reaction:{name:"Reaction"},targetToken:e.wolfToken
  });
  assert.equal(await e.flow.applyPendingDamage(message,"Scene.Missing"),false);
  assert.equal(message.getFlag(M,"pendingReactionDamage").status,"pending");
  assert.equal(e.delivered.length,0);
});

test("v14 chat message hook renders a GM button and applied receipt",async()=>{
  const e=setup();
  assert.ok(e.handlers.has("renderChatMessageHTML"));
  const message=await e.flow.queueDamage({
    formula:"1d4",damageType:"acid",sourceActor:e.caster,reaction:{name:"Enkindle"},targetToken:e.wolfToken
  });
  globalThis.document={createElement:tag=>({
    tag,children:[],textContent:"",className:"",
    addEventListener(name,fn){this["on"+name]=fn},
    append(child){this.children.push(child)},
    prepend(child){this.children.unshift(child)}
  })};
  const region={children:[],querySelector:()=>null,append(x){this.children.push(x)}};
  const html={querySelector:sel=>sel===".message-content"?region:null};
  e.flow.onChatRender(message,html);
  assert.equal(region.children.length,1);
  const card=region.children[0];
  const button=card.children.find(x=>x.tag==="button");
  assert.ok(button);
  assert.equal(button.textContent,"Apply Damage");
  assert.equal(await e.flow.applyPendingDamage(message,e.goblinToken.document.uuid),true);
  const receipt={children:[],querySelector:()=>null,append(x){this.children.push(x)}};
  e.flow.onChatRender(message,{querySelector:sel=>sel===".message-content"?receipt:null});
  const rendered=receipt.children[0];
  assert.match(rendered.children[0].textContent,/Applied 9 acid damage to Goblin/);
  assert.equal(rendered.children.some(x=>x.tag==="button"),false);
});
