import {EFFECT_SCHEMA, FIELD_OPTIONS, defaultEffect} from "./automation.js";

/* A fully data-driven ordered action editor: the action palette and executor
 * share a schema. Adding an action to the runtime schema exposes it here.
 */
export function createReactionBuilder({M,get,cp}) {
  const html=x=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const types=Object.entries(EFFECT_SCHEMA);
  const fieldLabels={
    formula:"Dice formula (for Enkindle, rolled once per consumed entity)",damageType:"D&D damage type",damageMode:"Damage application",elementId:"Element",targetMode:"Apply to",
    origin:"Area centered on",radius:"Radius (feet)",targetFilter:"Target creatures",
    actorUuid:"Assigned Actor UUID (drop an Actor below)",entityRef:"Entity variable / name",
    quantity:"Number to create",lifetime:"Lifetime (combat rounds, 0 = indefinite)",
    placement:"Spawn near",clearMode:"Clear scope",ability:"Ability",amount:"Ability change (+/-)",
    duration:"Duration (rounds)",elementsToClear:"Elements to clear (comma-separated)",
    damageFormula:"Zone damage formula (optional)",label:"Bracket title",searchRadius:"Legacy chain search radius (unused)",multiplierEntityRef:"Multiply by active entities (reference)",untilTempHpGone:"Keep resistance only while temporary HP remains",excludeOriginEntity:"Exclude the assigned entity itself"
  };
  const numberFields=new Set(["radius","quantity","lifetime","amount","duration","searchRadius"]);const checkboxFields=new Set(["untilTempHpGone","excludeOriginEntity"]);
  function valuesFor(name){
    if(FIELD_OPTIONS[name])return FIELD_OPTIONS[name];
    if(name==="elementId")return get("elements").map(e=>[e.id,e.name]);
    if(name==="damageType")return null; // Custom and system-defined damage types are both allowed.
    return null;
  }
  function renderField(f,name,path){
    const value=f[name]??defaultEffect(f.type)[name]??"";
    const opts=valuesFor(name);
    const attr=' data-field="'+html(name)+'" data-path="'+html(encodeURIComponent(JSON.stringify(path)))+'"';
    if(checkboxFields.has(name))return '<label class="ter-inline-check"><input type="checkbox"'+attr+(value===true?" checked":"")+'> '+html(fieldLabels[name])+'</label>';
    if(opts)return '<label>'+html(fieldLabels[name]||name)+'<select'+attr+'>'+
      opts.map(([v,label])=>'<option value="'+html(v)+'"'+(String(value)===String(v)?" selected":"")+'>'+html(label)+'</option>').join("")+'</select></label>';
    if(name==="actorUuid")return '<label class="ter-actor-drop" data-drop-path="'+html(encodeURIComponent(JSON.stringify(path)))+'">'+
      html(fieldLabels[name])+'<input'+attr+' value="'+html(value)+'" placeholder="Drag an Actor here from the sidebar or Compendium">'+
      '<span class="ter-drop-hint">Drop an Actor here to assign an entity</span></label>';
    return '<label>'+html(fieldLabels[name]||name)+'<input'+attr+' type="'+(numberFields.has(name)?"number":"text")+'"'+
      (numberFields.has(name)?' step="any"':'')+' value="'+html(value)+'"></label>';
  }
  function showSteps(steps,prefix=[],depth=0){
    if(depth>5)return '<p>Maximum nested action depth reached.</p>';
    if(!Array.isArray(steps))steps=[];
    return steps.map((step,index)=>{
      const path=[...prefix,index],code=encodeURIComponent(JSON.stringify(path));
      const spec=EFFECT_SCHEMA[step.type]||EFFECT_SCHEMA.damage;
      const opts=types.map(([type,meta])=>'<option value="'+html(type)+'"'+(step.type===type?" selected":"")+'>'+html(meta.label)+'</option>').join("");
      const fields=(spec.fields||[]).map(name=>renderField(step,name,path)).join("");
      const children=(spec.children||[]).map(child=>
        '<div class="ter-substeps"><h4>'+html(child==="onTick"?"Every initiative 0 (each combat round)":child==="onExpire"?"When summon expires": "Nested actions")+'</h4>'+
        showSteps(step[child]||[],[...path,child],depth+1)+
        '<button type="button" data-op="add" data-list="'+html(encodeURIComponent(JSON.stringify([...path,child])))+'">+ Add nested action</button></div>').join("");
      return '<details class="ter-effect-step" open><summary>Step '+(index+1)+' · '+html(spec.label)+'</summary>'+
        '<div class="ter-step-tools"><button type="button" data-op="up" data-path="'+code+'" title="Move earlier">↑ Earlier</button>'+
        '<button type="button" data-op="down" data-path="'+code+'" title="Move later">↓ Later</button>'+
        '<button type="button" data-op="remove" data-path="'+code+'" title="Delete step">Remove</button></div>'+
        '<label>Action type<select data-type-path="'+code+'">'+opts+'</select></label>'+
        '<div class="ter-step-fields">'+fields+'</div>'+children+'</details>';
    }).join("");
  }
  return class ReactionBuilder extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2){
    static DEFAULT_OPTIONS={id:"ter-reaction-builder",window:{title:"Reaction Automation Builder",resizable:true},position:{width:840,height:820}};
    static PARTS={main:{template:"modules/telynors-elemental-reactions/templates/reaction-builder.hbs"}};
    constructor(config={},...args){super(...args);this.kind=config.kind==="variant"?"variant":"reaction";this.recordId=config.id||null;this.draft=null;}
    async _prepareContext(){
      if(!this.draft){
        const records=get(this.kind==="variant"?"variants":"reactions");
        const found=records.find(x=>x.id===this.recordId);
        const els=get("elements");
        this.draft=found?cp(found):{
          id:null,name:"",elements:[els[0]?.id||"fire",els[1]?.id||"ice"],effects:[],
          text:{mode:"gradient",direction:"right",solid:"#ffffff"},
          enabled:true,priority:10,condition:{type:"always",value:""}
        };
      }
      if(!Array.isArray(this.draft.effects))this.draft.effects=[];
      if(!this.draft.elements?.length)this.draft.elements=[get("elements")[0]?.id||"fire",get("elements")[1]?.id||"ice"];
      if(!this.draft.text)this.draft.text={mode:"gradient",direction:"right",solid:"#ffffff"};
      return {elements:cp(get("elements")),draft:this.draft,isVariant:this.kind==="variant",isNew:!this.recordId};
    }
    listAt(path){
      let arr=this.draft.effects;
      for(let i=0;i<path.length;i+=2){
        const node=arr[path[i]];if(!node)return null;
        const prop=path[i+1];if(!prop)return null;
        if(!Array.isArray(node[prop]))node[prop]=[];
        arr=node[prop];
      }
      return arr;
    }
    getStep(path){return this.listAt(path.slice(0,-1))?.[path[path.length-1]]}
    repaint(){
      const area=this.element.querySelector("[data-role=steps]");
      if(area)area.innerHTML=showSteps(this.draft.effects);
    }
    _onRender(){
      const root=this.element,q=s=>root.querySelector(s),d=this.draft;
      const init={name:d.name||"",a:d.elements?.[0]||"",b:d.elements?.[1]||"",
        priority:d.priority??10,enabled:d.enabled!==false,
        conditionType:d.condition?.type||"always",conditionValue:d.condition?.value||"",
        textMode:d.text?.mode||"gradient",direction:d.text?.direction||"right",solid:d.text?.solid||"#ffffff"};
      for(const [name,value]of Object.entries(init)){
        const e=q('[name="'+name+'"]');if(!e)continue;
        if(e.type==="checkbox")e.checked=!!value;else e.value=String(value);
      }
      const preview=()=>{
        const a=get("elements").find(e=>e.id===q('[name="a"]')?.value);
        const b=get("elements").find(e=>e.id===q('[name="b"]')?.value);
        const p=q(".ter-preview");if(!p)return;
        p.textContent=(q('[name="name"]')?.value||"REACTION").toUpperCase();
        const mode=q('[name="textMode"]')?.value,dir=q('[name="direction"]')?.value;
        const angle={right:"90deg",left:"270deg",up:"0deg",down:"180deg"}[dir]||"90deg";
        p.style.backgroundImage=mode==="solid"?"linear-gradient("+q('[name="solid"]').value+","+q('[name="solid"]').value+")":
          "linear-gradient("+angle+","+(a?.color||"#fff")+","+(b?.color||"#fff")+")";
      };
      root.querySelectorAll('[name="name"],[name="a"],[name="b"],[name="textMode"],[name="direction"],[name="solid"]').forEach(x=>x.addEventListener("input",preview));
      preview();this.repaint();
      const decode=x=>JSON.parse(decodeURIComponent(x||"%5B%5D"));
      root.querySelector("[data-role=steps]")?.addEventListener("input",e=>{
        const x=e.target.closest("[data-field]");if(!x)return;
        const step=this.getStep(decode(x.dataset.path));if(!step)return;
        step[x.dataset.field]=checkboxFields.has(x.dataset.field)?x.checked:numberFields.has(x.dataset.field)?Number(x.value):x.value;
      });
      root.querySelector("[data-role=steps]")?.addEventListener("change",e=>{
        const el=e.target;
        if(el.matches("[data-type-path]")){
          const path=decode(el.dataset.typePath),arr=this.listAt(path.slice(0,-1));
          if(arr)arr[path.at(-1)]=defaultEffect(el.value);
          this.repaint();
        }else if(el.matches("[data-field]")){
          const step=this.getStep(decode(el.dataset.path));
          if(step)step[el.dataset.field]=checkboxFields.has(el.dataset.field)?el.checked:numberFields.has(el.dataset.field)?Number(el.value):el.value;
        }
      });
      root.querySelector("[data-role=steps]")?.addEventListener("click",e=>{
        const button=e.target.closest("[data-op]");if(!button)return;
        e.preventDefault();
        const op=button.dataset.op,path=decode(button.dataset.path||button.dataset.list);
        if(op==="add"){
          const arr=this.listAt(path);if(!arr)return;
          arr.push(defaultEffect("damage"));
        }else{
          const arr=this.listAt(path.slice(0,-1)),i=path.at(-1);
          if(!arr||!Number.isInteger(i))return;
          if(op==="remove")arr.splice(i,1);
          if(op==="up"&&i>0)[arr[i-1],arr[i]]=[arr[i],arr[i-1]];
          if(op==="down"&&i<arr.length-1)[arr[i+1],arr[i]]=[arr[i],arr[i+1]];
        }
        this.repaint();
      });
      root.querySelector("[data-role=steps]")?.addEventListener("dragover",e=>{
        if(e.target.closest(".ter-actor-drop"))e.preventDefault();
      });
      root.querySelector("[data-role=steps]")?.addEventListener("drop",async e=>{
        const area=e.target.closest(".ter-actor-drop");if(!area)return;
        e.preventDefault();
        try{
          const getDrag=globalThis.TextEditor?.getDragEventData||
            foundry.applications?.ux?.TextEditor?.implementation?.getDragEventData;
          if(!getDrag)throw new Error("Foundry drag data helper unavailable");
          const data=getDrag(e);
          if(data?.type!=="Actor")return ui.notifications.warn("Drop an Actor document, not an item or token.");
          const actor=await fromUuid(data.uuid);
          if(actor?.documentName!=="Actor")return ui.notifications.warn("Could not resolve that Actor.");
          const step=this.getStep(decode(area.dataset.dropPath));if(!step)return;
          step.actorUuid=actor.uuid;
          area.querySelector('[data-field="actorUuid"]').value=actor.uuid;
          const hint=area.querySelector(".ter-drop-hint");if(hint)hint.textContent="Assigned: "+actor.name;
        }catch(err){console.error(M+" | Actor drop failed",err);ui.notifications.error("Unable to assign dropped Actor.")}
      });
      q('[data-op="add-root"]')?.addEventListener("click",()=>{d.effects.push(defaultEffect("damage"));this.repaint()});
      q('[data-op="save"]')?.addEventListener("click",async()=>{
        if(!game.user.isGM)return ui.notifications.warn("Only a GM can edit reaction automation.");
        const a=q('[name="a"]').value,b=q('[name="b"]').value,name=q('[name="name"]').value.trim();
        if(!name||!a||!b||a===b)return ui.notifications.warn("Choose two different elements and a reaction name.");
        const textStyle={mode:q('[name="textMode"]').value,direction:q('[name="direction"]').value,solid:q('[name="solid"]').value};
        const isVariant=this.kind==="variant",key=isVariant?"variants":"reactions",list=cp(get(key));
        const id=this.recordId||(isVariant?name.slugify({strict:true})+"-"+Date.now().toString(36):
          a+"-"+b+"-"+name.slugify({strict:true}));
        const record={...cp(d),id,name,elements:[a,b],effects:cp(d.effects),text:textStyle};
        if(isVariant){
          record.enabled=q('[name="enabled"]').checked;
          record.priority=Number(q('[name="priority"]').value)||0;
          record.condition={type:q('[name="conditionType"]').value,value:q('[name="conditionValue"]').value.trim()};
        }
        let index=list.findIndex(x=>x.id===this.recordId);
        if(!isVariant&&index<0)index=list.findIndex(x=>[...x.elements].sort().join("|")===[a,b].sort().join("|"));
        if(index<0)list.push(record);else list[index]=record;
        await game.settings.set(M,key,list);
        Hooks.callAll(M+".builderSaved",{kind:this.kind,record});
        ui.notifications.info((isVariant?"Variant":"Reaction")+" saved with "+d.effects.length+" ordered actions.");
        this.close();
      });
      q('[data-op="delete"]')?.addEventListener("click",async()=>{
        if(!this.recordId||!game.user.isGM)return;
        if(!confirm("Delete this "+this.kind+"?"))return;
        const key=this.kind==="variant"?"variants":"reactions";
        await game.settings.set(M,key,cp(get(key)).filter(x=>x.id!==this.recordId));
        Hooks.callAll(M+".builderSaved",{kind:this.kind,deleted:this.recordId});
        this.close();
      });
    }
  };
}