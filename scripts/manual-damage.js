/**
 * Chat-first, GM-approved elemental reaction damage.
 *
 * The roll is committed to a public Foundry ChatMessage before ANY HP is
 * changed. A GM selects a scene token later and applies that exact roll.
 * Automated area, summon, zone and detonation damage bypasses this module.
 */
const escape=x=>String(x??"").replace(/[&<>"']/g,c=>({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
}[c]));

export function createManualDamageFlow({M,applyRolledDamage}) {
  const localLocks=new Set();
  function getState(message){
    return message?.getFlag?.(M,"pendingReactionDamage")||null;
  }
  function canApply(state) {
    if(!game.user?.isGM||!state)return false;
    // One responsible GM at a time; another GM can take over if that GM disconnects.
    const issuer=game.users?.get?.(state.issuedBy);
    return !state.issuedBy||game.user.id===state.issuedBy||!issuer||issuer.active===false;
  }
  function findSceneToken(uuid){
    return canvas?.tokens?.placeables?.find(t=>t.actor&&t.document?.uuid===uuid)||null;
  }
  function listSceneTokens(){
    return (canvas?.tokens?.placeables||[]).filter(t=>!!t.actor&&!!t.document?.uuid);
  }
  async function queueDamage({formula,damageType,sourceActor,reaction,targetToken}) {
    if(!game.user?.isGM)throw new Error("Reaction manual damage must be rolled by a GM.");
    const roll=await new Roll(String(formula||"0"),sourceActor?.getRollData?.()||{}).evaluate();
    const amount=Math.max(0,Number(roll.total)||0);
    const elementName=String(reaction?.name||"Elemental Reaction");
    const type=String(damageType||"none");
    const state={
      amount,damageType:type,status:"pending",
      issuedBy:game.user.id,sourceActorUuid:sourceActor?.uuid||null,
      originalTargetUuid:targetToken?.document?.uuid||null,
      reactionName:elementName
    };
    const message=await roll.toMessage({
      speaker:ChatMessage.getSpeaker({actor:sourceActor||targetToken?.actor||null}),
      flavor:escape(elementName)+" — "+escape(type)+" damage (awaiting GM application)",
      flags:{[M]:{pendingReactionDamage:state}}
    },{create:true,messageMode:"public"});
    if(!message?.id)throw new Error("Reaction damage roll was not posted to chat.");
    return message;
  }
  function preferredTokenId(state,available) {
    const availableIds=new Set(available.map(t=>t.document.uuid));
    const targets=[...(game.user?.targets||[])].filter(t=>availableIds.has(t.document?.uuid));
    if(targets.length===1)return targets[0].document.uuid;
    const controlled=(canvas?.tokens?.controlled||[]).filter(t=>availableIds.has(t.document?.uuid));
    if(controlled.length===1)return controlled[0].document.uuid;
    if(availableIds.has(state.originalTargetUuid))return state.originalTargetUuid;
    return available[0]?.document.uuid||null;
  }
  async function chooseTarget(state){
    const available=listSceneTokens();
    if(!available.length){ui.notifications?.warn("No creature tokens are available in this scene.");return null}
    const preferred=preferredTokenId(state,available);
    const options=available.map(t=>{
      const id=t.document.uuid;
      const label=t.name||t.document.name||t.actor.name||"Creature";
      return '<option value="'+escape(id)+'"'+(id===preferred?' selected':'')+'>'+escape(label)+'</option>';
    }).join("");
    const input=await foundry.applications.api.DialogV2.input({
      window:{title:"Apply "+state.reactionName+" Damage"},
      content:'<p>Rolled <strong>'+state.amount+' '+escape(state.damageType)+
        '</strong> damage. Choose the creature to receive this damage. No HP changes until you confirm.</p>'+
        '<label>Creature<select name="targetUuid" required>'+options+'</select></label>',
      ok:{label:"Apply Damage"},
      rejectClose:false
    });
    return input?.targetUuid||null;
  }
  async function applyPendingDamage(message,targetUuid){
    if(!message?.id||localLocks.has(message.id))return false;
    const initial=getState(message);
    if(!canApply(initial)){
      ui.notifications?.warn("Only the GM who rolled this reaction, or another GM if they disconnect, may apply it.");
      return false;
    }
    if(initial.status!=="pending")return false;
    const target=findSceneToken(targetUuid);
    if(!target){ui.notifications?.warn("That creature is no longer available in the scene.");return false}
    localLocks.add(message.id);
    try{
      // Re-fetch after selection in case another client has already applied it.
      const msg=game.messages?.get(message.id)||message;
      const state=getState(msg);
      if(!state||state.status!=="pending"||!canApply(state))return false;
      await msg.setFlag(M,"pendingReactionDamage",{
        ...state,status:"applying",claimedBy:game.user.id
      });
      const source=state.sourceActorUuid?await fromUuid(state.sourceActorUuid):null;
      try{
        await applyRolledDamage({
          sourceActor:source,targetToken:target,amount:state.amount,
          damageType:state.damageType
        });
      }catch(error){
        await msg.setFlag(M,"pendingReactionDamage",{
          ...state,status:"pending"
        });
        throw error;
      }
      await msg.setFlag(M,"pendingReactionDamage",{
        ...state,status:"applied",appliedBy:game.user.id,
        appliedToUuid:target.document.uuid,appliedToName:target.name||target.actor.name||"Creature"
      });
      ui.notifications?.info(state.amount+" "+state.damageType+" damage applied to "+(target.name||target.actor.name)+".");
      return true;
    }catch(error){
      console.error(M+" | Could not apply pending reaction damage",error);
      ui.notifications?.error("Reaction damage was not confirmed. Check console and target HP before trying again.");
      return false;
    }finally{
      localLocks.delete(message.id);
    }
  }
  async function onApplyClick(message,button){
    if(localLocks.has(message.id))return;
    const state=getState(game.messages?.get(message.id)||message);
    if(!canApply(state)||state?.status!=="pending")return;
    button.disabled=true;
    try{
      const tokenId=await chooseTarget(state);
      if(tokenId&&await applyPendingDamage(message,tokenId)){
        // Update the currently displayed card even when Foundry postpones a chat re-render.
        const card=button.closest?.(".ter-reaction-damage-control");
        if(card){
          const latest=getState(game.messages?.get(message.id)||message);
          const label=card.querySelector("p");
          if(label){label.textContent="Applied "+latest.amount+" "+latest.damageType+
            " damage to "+latest.appliedToName+".";label.className="ter-reaction-damage-applied";}
          button.remove();
        }
      }
    }catch(error){console.error(M+" | Apply Damage dialog failed",error);ui.notifications?.error("Could not select reaction damage target.");}
    finally{button.disabled=false}
  }
  function onChatRender(message,html){
    const state=getState(message);
    if(!state)return;
    const container=html.querySelector?.(".message-content")||html;
    container.querySelector?.(".ter-reaction-damage-control")?.remove();
    const card=document.createElement("section");
    card.className="ter-reaction-damage-control";
    const label=document.createElement("p");
    if(state.status==="applied"){
      label.textContent="Applied "+state.amount+" "+state.damageType+" damage to "+(state.appliedToName||"the selected creature")+".";
      label.className="ter-reaction-damage-applied";
    }else if(state.status==="applying"){
      label.textContent="Applying "+state.amount+" "+state.damageType+" damage…";
    }else if(canApply(state)){
      label.textContent=state.amount+" "+state.damageType+" damage rolled. No HP has been changed.";
      const button=document.createElement("button");
      button.type="button";
      button.className="ter-reaction-apply-damage";
      button.textContent="Apply Damage";
      button.addEventListener("click",event=>{
        event.preventDefault();event.stopPropagation();void onApplyClick(message,button);
      });
      card.append(button);
    }else label.textContent="Awaiting GM to apply "+state.amount+" "+state.damageType+" damage.";
    card.prepend(label);
    container.append(card);
  }
  Hooks.on("renderChatMessageHTML",onChatRender);
  return {queueDamage,applyPendingDamage,onChatRender,chooseTarget,getState};
}
