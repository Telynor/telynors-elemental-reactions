/* Telynor's Elemental Reactions: ordered, data-driven reaction actions.
 * All execution occurs on the active GM client; the builder consumes EFFECT_SCHEMA.
 */
export const EFFECT_SCHEMA = {
  damage:{label:"Apply damage",fields:["formula","damageType","targetMode","origin","radius","targetFilter"]},
  heal:{label:"Heal HP",fields:["formula","targetMode","origin","radius","targetFilter"]},
  tempHp:{label:"Grant temporary HP",fields:["formula","multiplierEntityRef","targetMode","origin","radius","targetFilter"]},
  applyElement:{label:"Apply element",fields:["elementId","targetMode","origin","radius","targetFilter"]},
  summon:{label:"Spawn assigned Actor",fields:["actorUuid","entityRef","quantity","lifetime","placement"],children:["onTick","onExpire"]},
  clearEntity:{label:"Clear Entity (assigned Actor)",fields:["entityRef","clearMode"]},
  detonateEntity:{label:"Detonate matching summoned entities",fields:["entityRef","searchRadius","radius","formula","damageType","targetFilter"]},
  zone:{label:"Create zone",fields:["elementId","radius","damageFormula","damageType","targetFilter"]},
  ability:{label:"Modify an ability",fields:["ability","amount","duration","targetMode","origin","radius","targetFilter"]},
  resistance:{label:"Grant damage resistance",fields:["damageType","duration","untilTempHpGone","targetMode","origin","radius","targetFilter"]},
  removeEffects:{label:"Remove reaction effects",fields:["elementsToClear","targetMode","origin","radius","targetFilter"]},
  annihilate:{label:"Annihilate Light/Dark effects (combat)",fields:["damageType"]},
  sequence:{label:"Sub-bracket / sequence",fields:["label"],children:["steps"]}
};
export const FIELD_OPTIONS = {
  targetMode:[["target","Triggering creature"],["source","Source creature"],["entity","Assigned Entity"],["area","Area around origin"]],
  origin:[["target","Reaction target"],["source","Source creature"],["entity","Assigned Entity"]],
  targetFilter:[["all","All creatures"],["enemies","Enemies only"],["allies","Allies only"]],
  placement:[["target","Near reaction target"],["source","Near source"]],
  clearMode:[["tracked","This reaction's assigned entities"],["scene","All matching assigned entities in scene"]],
  ability:[["str","Strength"],["dex","Dexterity"],["con","Constitution"],["int","Intelligence"],["wis","Wisdom"],["cha","Charisma"]]
};
export const EFFECT_DEFAULTS = {
  damage:{type:"damage",formula:"1d4",damageType:"fire",targetMode:"target",targetFilter:"all",origin:"target",radius:5},
  heal:{type:"heal",formula:"1d4",targetMode:"target",targetFilter:"all",origin:"target",radius:5},
  tempHp:{type:"tempHp",formula:"2d4",targetMode:"target",targetFilter:"all",origin:"target",radius:5},
  applyElement:{type:"applyElement",elementId:"fire",targetMode:"target",targetFilter:"all",origin:"target",radius:5},
  summon:{type:"summon",actorUuid:"",entityRef:"rimebud",quantity:1,lifetime:2,placement:"target",onTick:[],onExpire:[]},
  clearEntity:{type:"clearEntity",entityRef:"rimebud",clearMode:"tracked"},
  detonateEntity:{type:"detonateEntity",entityRef:"rimebud",searchRadius:5,radius:5,formula:"1d4",damageType:"fire",targetFilter:"all"},
  zone:{type:"zone",elementId:"fire",radius:10,damageFormula:"",damageType:"fire",targetFilter:"all"},
  ability:{type:"ability",ability:"str",amount:-1,duration:2,targetMode:"target",targetFilter:"all",origin:"target",radius:5},
  resistance:{type:"resistance",damageType:"fire",duration:2,targetMode:"target",targetFilter:"all",origin:"target",radius:5},
  removeEffects:{type:"removeEffects",elementsToClear:"light,dark",targetMode:"area",targetFilter:"all",origin:"target",radius:9999},
  annihilate:{type:"annihilate",damageType:"force"},
  sequence:{type:"sequence",label:"Sub-bracket",steps:[]}
};
export function defaultEffect(type){return foundry.utils.deepClone(EFFECT_DEFAULTS[type]||{type});}
export function createAutomation({M,el,setElement,damage,ensureCollective}) {
  const cp=x=>foundry.utils.deepClone(x);
  const tokens=()=>canvas?.tokens?.placeables||[];
  const tokenOfActor=a=>tokens().find(t=>t.actor?.uuid===a?.uuid)||null;
  const obj=x=>x?.object||x;
  const loc=t=>t?.center||((t?.x!==undefined)?{x:t.x,y:t.y}:null);
  const radiusPx=feet=>Number(feet||0)*(canvas?.grid?.size||100)/(canvas?.scene?.grid?.distance||5);
  const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
  const ownSide=c=>tokenOfActor(c.sourceActor)?.document?.disposition;
  function friendly(t,c,filter) {
    if(!filter||filter==="all")return true;
    const s=ownSide(c),v=t.document?.disposition;
    if(s===undefined||s===null)return true; // no source token: do not guess alliances
    return filter==="allies"?v===s:v!==s;
  }
  function centerFor(step,c) {
    const origin=step.origin||"target";
    if(origin==="source")return loc(tokenOfActor(c.sourceActor))||loc(c.targetToken);
    if(origin==="entity")return loc(c.entities?.[step.entityRef||c.lastEntityRef]?.[0])||
      c.positions?.[step.entityRef||c.lastEntityRef]||loc(c.targetToken);
    return loc(c.targetToken);
  }
  function resolveTargets(step,c) {
    const mode=step.targetMode||"target";
    let found=[];
    if(mode==="source")found=[tokenOfActor(c.sourceActor)].filter(Boolean);
    else if(mode==="entity")found=c.entities?.[step.entityRef||c.lastEntityRef]||[];
    else if(mode==="area"){
      const p=centerFor(step,c),r=radiusPx(step.radius||5);
      if(p)found=tokens().filter(t=>loc(t)&&dist(loc(t),p)<=r+Math.min(t.w||0,t.h||0)/4);
    }else found=[c.targetToken].filter(Boolean);
    return [...new Set(found.map(obj).filter(t=>t?.actor&&friendly(t,c,step.targetFilter)))];
  }
  async function rollAmount(formula,actor) {
    if(!formula)return 0;
    const r=await new Roll(String(formula),actor?.getRollData?.()||{}).evaluate();
    try{if(game.dice3d)await game.dice3d.showForRoll(r,game.user,true)}catch(e){console.warn(M+" | Dice So Nice:",e)}
    return Math.max(0,Number(r.total)||0);
  }
  async function updateHeal(t,value,isTemp) {
    const hp=t.actor?.system?.attributes?.hp;
    if(!hp)return;
    if(isTemp)await t.actor.update({"system.attributes.hp.temp":Math.max(Number(hp.temp)||0,value)});
    else if(globalThis.MidiQOL?.applyTokenDamage){
      await globalThis.MidiQOL.applyTokenDamage([{damage:-value,type:"healing",properties:new Set()}],-value,new Set([t]),null,null);
    }else await t.actor.update({"system.attributes.hp.value":Math.min(Number(hp.max)||9999,(Number(hp.value)||0)+value)});
  }
  function makeContext(c){return {...c,entities:c.entities||{},positions:c.positions||{},affected:c.affected||new Set(),depth:c.depth||0};}
  async function runEffects(steps,input,depth=0) {
    const c=input?.entities?input:makeContext(input||{});
    if(depth>8){console.warn(M+" | Maximum sub-bracket depth reached");return c}
    for(const step of Array.isArray(steps)?steps:[]) {
      if(!step?.type)continue;
      try{await executeStep(step,c,depth)}catch(error){console.error(M+" | Reaction effect failed",step,error);ui.notifications?.warn("Reaction step failed: "+(EFFECT_SCHEMA[step.type]?.label||step.type))}
    }
    return c;
  }
  async function executeStep(f,c,depth) {
    if(f.type==="sequence"){await runEffects(f.steps||[],c,depth+1);return}
    if(f.type==="damage"){
      for(const t of resolveTargets(f,c)){await damage(c.sourceActor,t,f.formula||"1d4",f.damageType||f.elementId||c.secondElement);c.affected.add(t)}
      return;
    }
    if(f.type==="heal"||f.type==="tempHp"){
      for(const t of resolveTargets(f,c)){
        let value=await rollAmount(f.formula||"1d4",c.sourceActor);
        if(f.multiplierEntityRef){
          const units=tokens().filter(x=>x.document?.getFlag(M,"summoned")?.entityRef===f.multiplierEntityRef);
          const side=ownSide(c);
          value*=units.filter(x=>side===undefined||x.document?.disposition===side).length;
        }
        if(value<=0)continue;
        await updateHeal(t,value,f.type==="tempHp");
        if(f.type==="tempHp"){
          const old=t.actor.getFlag(M,"tempHpHistory")||[];
          await t.actor.setFlag(M,"tempHpHistory",[...old,{
            amount:value,elements:[c.firstElement,c.secondElement],reactionId:c.reaction?.id||""
          }]);
        }
        c.affected.add(t);
      }
      return;
    }
    if(f.type==="applyElement"){
      for(const t of resolveTargets(f,c)){await setElement(t,f.elementId||c.secondElement,c.sourceActor);c.affected.add(t)}
      return;
    }
    if(f.type==="ability"||f.type==="resistance"){
      for(const t of resolveTargets(f,c)){
        const change=f.type==="ability"?
          {key:"system.abilities."+(f.ability||"str")+".value",mode:2,value:String(Number(f.amount)||-1),priority:20}:
          {key:"system.traits.dr.value",mode:2,value:String(f.damageType||"fire"),priority:20};
        await t.actor.createEmbeddedDocuments("ActiveEffect",[{
          name:"Elemental Reaction: "+(c.reaction?.name||f.type),img:"icons/svg/aura.svg",
          origin:c.sourceActor?.uuid||null,changes:[change],
          duration:f.untilTempHpGone?{}:{rounds:Math.max(1,Number(f.duration)||2),startRound:game.combat?.round||0,startTurn:game.combat?.turn||0},
          flags:{[M]:{reactionId:c.reaction?.id||"",elements:[c.firstElement,c.secondElement],effectType:f.type,untilTempHpGone:!!f.untilTempHpGone}}
        }]);c.affected.add(t);
      }
      return;
    }
    if(f.type==="annihilate"){
      const all=game.combat?.combatants?.size?
        [...new Map(game.combat.combatants.map(x=>x.actor).filter(Boolean).map(a=>[a.uuid,a])).values()]:
        [...new Map(tokens().map(t=>t.actor).filter(Boolean).map(a=>[a.uuid,a])).values()];
      let total=0;
      for(const actor of all){
        const effects=[...actor.effects].filter(a=>a.getFlag(M,"reactionId")&&
          a.getFlag(M,"elements")?.some(x=>x==="light"||x==="dark"));
        for(const effect of effects)for(const change of effect.changes||[]){
          if(/^system.abilities.(str|dex|con|int|wis|cha).value$/.test(change.key))
            total+=Math.abs(Number(change.value)||0);
        }
        const history=actor.getFlag(M,"tempHpHistory")||[];
        const remove=history.filter(x=>x.elements?.some(y=>y==="light"||y==="dark"));
        const keep=history.filter(x=>!x.elements?.some(y=>y==="light"||y==="dark"));
        const totalGranted=remove.reduce((n,x)=>n+(Number(x.amount)||0),0);
        total+=totalGranted;
        if(effects.length)await actor.deleteEmbeddedDocuments("ActiveEffect",effects.map(e=>e.id));
        if(remove.length){
          const hp=actor.system?.attributes?.hp;
          if(hp?.temp>0)await actor.update({"system.attributes.hp.temp":Math.max(0,Number(hp.temp)-totalGranted)});
          await actor.setFlag(M,"tempHpHistory",keep);
        }
      }
      if(total>0&&c.targetToken){await damage(c.sourceActor,c.targetToken,String(total),f.damageType||"force");c.affected.add(c.targetToken)}
      return;
    }
    if(f.type==="removeEffects"){
      const elements=String(f.elementsToClear||"light,dark").split(",").map(x=>x.trim()).filter(Boolean);
      for(const t of resolveTargets(f,c)){
        const ids=t.actor.effects.filter(a=>a.getFlag(M,"reactionId")&&
          (!elements.length||a.getFlag(M,"elements")?.some(e=>elements.includes(e)))).map(a=>a.id);
        if(ids.length)await t.actor.deleteEmbeddedDocuments("ActiveEffect",ids);
        c.affected.add(t);
      }
      return;
    }
    if(f.type==="summon"){
      const actor=f.actorUuid?await fromUuid(f.actorUuid):null;
      if(!actor||actor.documentName!=="Actor"){ui.notifications?.warn("Assign an Actor in the builder before this summon can run.");return}
      const ref=String(f.entityRef||"summon").trim(),count=Math.min(20,Math.max(1,Number(f.quantity)||1));
      const basis=(f.placement==="source"?tokenOfActor(c.sourceActor):c.targetToken)||c.targetToken;
      if(!basis)return;
      if(!c.entities[ref])c.entities[ref]=[];
      for(let i=0;i<count;i++){
        const size=canvas.grid?.size||100;
        const td=await actor.getTokenDocument({x:basis.document.x+size*(1+i%3),y:basis.document.y+size*Math.floor(i/3)});
        const [doc]=await canvas.scene.createEmbeddedDocuments("Token",[td.toObject()]);
        await doc.setFlag(M,"summoned",{
          entityRef:ref,actorUuid:actor.uuid,sourceActorUuid:c.sourceActor?.uuid||null,
          reactionId:c.reaction?.id||"",firstElement:c.firstElement,secondElement:c.secondElement,
          lifetime:Math.max(0,Number(f.lifetime)||0),spawnRound:game.combat?.round||0,
          onTick:cp(f.onTick||[]),onExpire:cp(f.onExpire||[]),lastTickRound:-1
        });
        const t=doc.object;if(t){c.entities[ref].push(t);c.affected.add(t);c.positions[ref]=loc(t)}
      }
      c.lastEntityRef=ref;
      await ensureCollective?.();
      return;
    }
    if(f.type==="detonateEntity"){
      const ref=f.entityRef||"rimebud",near=radiusPx(f.searchRadius||5);
      const start=loc(c.targetToken);
      if(!start)return;
      const remaining=tokens().filter(t=>t.document?.getFlag(M,"summoned")?.entityRef===ref);
      const burst=[],queue=[start];
      while(queue.length&&burst.length<50){
        const point=queue.shift();
        for(const t of remaining){
          if(burst.includes(t)||!loc(t)||dist(point,loc(t))>near)continue;
          burst.push(t);queue.push(loc(t));
        }
      }
      for(const entity of burst){
        const scoped=makeContext({...c,entities:{...c.entities,[ref]:[entity]},positions:{...c.positions,[ref]:loc(entity)},lastEntityRef:ref});
        await executeStep({type:"damage",formula:f.formula||"1d4",damageType:f.damageType||"fire",
          targetMode:"area",origin:"entity",entityRef:ref,radius:f.radius||5,targetFilter:f.targetFilter||"all"},scoped,depth+1);
        for(const t of scoped.affected)c.affected.add(t);
        if(canvas.scene.tokens.get(entity.document.id))await canvas.scene.deleteEmbeddedDocuments("Token",[entity.document.id]);
      }
      return;
    }
    if(f.type==="clearEntity"){
      const ref=String(f.entityRef||c.lastEntityRef||"summon").trim(),found=(c.entities?.[ref]||[]).slice();
      if(f.clearMode==="scene")for(const t of tokens())if(t.document?.getFlag(M,"summoned")?.entityRef===ref&&!found.includes(t))found.push(t);
      const ids=[];
      for(const t of found){c.positions[ref]=loc(t)||c.positions[ref];if(t?.document?.id)ids.push(t.document.id)}
      if(ids.length)await canvas.scene.deleteEmbeddedDocuments("Token",[...new Set(ids)]);
      c.entities[ref]=[];
      return;
    }
    if(f.type==="zone"){
      const p=loc(c.targetToken);if(!p)return;
      const z={...cp(f),sourceActorUuid:c.sourceActor?.uuid||null,damaged:[],elementId:f.elementId||c.secondElement};
      await canvas.scene.createEmbeddedDocuments("MeasuredTemplate",[{
        t:"circle",user:game.user.id,x:p.x,y:p.y,distance:Number(f.radius)||10,
        fillColor:el(z.elementId)?.color||"#ffffff",flags:{[M]:{zone:z}}
      }]);await ensureCollective?.();return;
    }
    console.warn(M+" | Unsupported builder action:",f.type);
  }
  async function tickEntities() {
    if(!game.user.isGM||!game.combat||!canvas?.scene)return;
    const round=game.combat.round;
    for(const t of [...tokens()]){
      const state=t.document?.getFlag(M,"summoned");
      if(!state||state.lastTickRound===round)continue;
      const src=state.sourceActorUuid?await fromUuid(state.sourceActorUuid):null;
      const ctx=makeContext({sourceActor:src,targetToken:t,firstElement:state.firstElement,secondElement:state.secondElement,
        reaction:{id:state.reactionId,name:"Summoned Entity"},entities:{[state.entityRef]:[t]},positions:{[state.entityRef]:loc(t)},lastEntityRef:state.entityRef});
      const elapsed=round-(state.spawnRound||0);
      if(state.lifetime&&elapsed>=state.lifetime){
        await runEffects(state.onExpire||[],ctx);
        if(canvas.scene.tokens.get(t.document.id))await canvas.scene.deleteEmbeddedDocuments("Token",[t.document.id]);
      }else{
        await t.document.setFlag(M,"summoned",{...state,lastTickRound:round});
        await runEffects(state.onTick||[],ctx);
      }
    }
  }
  async function cleanupShieldsOnTempLoss(actor){
    if(!game.user.isGM||Number(actor?.system?.attributes?.hp?.temp)>0)return;
    const ids=[...actor.effects].filter(e=>e.getFlag(M,"untilTempHpGone")).map(e=>e.id);
    if(ids.length)await actor.deleteEmbeddedDocuments("ActiveEffect",ids);
  }
  function variantMatches(v,c){
    if(!v.enabled||!Array.isArray(v.elements)||v.elements.length!==2)return false;
    if([...(v.elements||[])].sort().join("|")!==[c.firstElement,c.secondElement].sort().join("|"))return false;
    const type=v.condition?.type||"always",value=v.condition?.value||"";
    if(type==="always")return true;
    if(type==="targetStatus")return !!c.targetToken?.actor?.statuses?.has(value);
    if(type==="sourceStatus")return !!c.sourceActor?.statuses?.has(value);
    if(type==="targetHpBelow"){const hp=c.targetToken?.actor?.system?.attributes?.hp;return !!hp&&Number(hp.max)>0&&Number(hp.value)/Number(hp.max)*100<Number(value)}
    if(type==="sourceElement")return c.sourceActor?.getFlag(M,"activeElement")===value;
    if(type==="targetElement")return c.targetToken?.document?.getFlag(M,"appliedElement")===value;
    return false;
  }
  return {runEffects,makeContext,tickEntities,variantMatches,resolveTargets,rollAmount,cleanupShieldsOnTempLoss};
}