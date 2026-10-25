/* BSL Sign Stories — front end for Supabase */
const CFG = window.SIGN_STORIES_CONFIG || {};
const KINDS = {
  documented:{label:"Documented source", cls:"k-doc"},
  community:{label:"Community account", cls:"k-com"},
  personal:{label:"Personal memory", cls:"k-per"},
  disputed:{label:"Disputed", cls:"k-dis"}
};
const PLATFORMS = [["tiktok.com","TikTok"],["instagram.com","Instagram"],["youtube.com","YouTube"],["youtu.be","YouTube"],["vimeo.com","Vimeo"],["facebook.com","Facebook"],["fb.watch","Facebook"],["x.com","X"],["twitter.com","X"],["threads.net","Threads"],["bsky.app","Bluesky"]];
const $ = s => document.querySelector(s);
function h(tag, attrs, ...kids){
  const el = document.createElement(tag);
  for (const [k,v] of Object.entries(attrs||{})){
    if (v==null || v===false) continue;
    if (k==="class") el.className = v;
    else if (k==="text") el.textContent = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v===true ? "" : v);
  }
  for (const c of kids.flat()){
    if (c==null || c===false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const configured = CFG.SUPABASE_URL && !CFG.SUPABASE_URL.startsWith("PASTE") && window.supabase;
const sb = configured ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY) : null;

let session=null, meId=null, profile=null, isMod=false, isAnon=false, loading=true;
let signs=[], versions=[], stories=[], reviews={}, counts={}, mine={}, people={};
let view="home", currentSignId=null, query="", armed=null;
let deck=[], deckPos=0, revealed=false;
const mediaCache = {};

function store(key, fallback){ try{ const v=localStorage.getItem(key); return v?JSON.parse(v):fallback; }catch(e){ return fallback; } }
function save(key, val){ try{ localStorage.setItem(key, JSON.stringify(val)); }catch(e){} }
let progress = store("bslss-progress", {});

function setStatus(msg, tone){
  const s=$("#status");
  if(!msg){ s.hidden=true; return; }
  s.textContent=msg; s.dataset.tone=tone||"warn"; s.hidden=false;
}
function fmtDate(iso){ try{ return new Date(iso).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"}); }catch(e){ return ""; } }
function isUrl(url){ try{ const u=new URL(url); return u.protocol==="https:"||u.protocol==="http:"; }catch(e){ return false; } }
function platformOf(url){
  try{ const u=new URL(url); const host=u.hostname.replace(/^www\.|^m\./,"");
    const p=PLATFORMS.find(([d])=>host===d||host.endsWith("."+d)); return p?p[1]:host; }catch(e){ return null; }
}
function publicUrl(path){ return sb.storage.from("media").getPublicUrl(path).data.publicUrl; }
function mediaEl(kind,path){
  const key=kind+":"+path;
  if(!mediaCache[key]){
    const el = kind==="image"
      ? h("img",{class:"vid",src:publicUrl(path),alt:"Image of the sign",loading:"lazy"})
      : h("video",{class:"vid",src:publicUrl(path),controls:true,playsinline:true,preload:"metadata",loop:true,muted:true});
    el.addEventListener("error",()=>{ const n=h("div",{class:"novid",text:"This file couldn't be loaded."}); el.replaceWith(n); mediaCache[key]=n; },{once:true});
    mediaCache[key]=el;
  }
  return mediaCache[key];
}
/* Turn a video link into an embedded player where the platform allows it. */
function embedInfo(url){
  let u; try{ u=new URL(url); }catch(e){ return null; }
  const host=u.hostname.replace(/^www\.|^m\./,""), path=u.pathname;
  let m;
  if(host==="youtu.be" && (m=path.match(/^\/([\w-]{6,})/))) return {src:`https://www.youtube-nocookie.com/embed/${m[1]}`, tall:false, thumb:`https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg`};
  if(host.endsWith("youtube.com")){
    if((m=path.match(/^\/shorts\/([\w-]{6,})/))) return {src:`https://www.youtube-nocookie.com/embed/${m[1]}`, tall:true, thumb:`https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg`};
    const v=u.searchParams.get("v"); if(v) return {src:`https://www.youtube-nocookie.com/embed/${v}`, tall:false, thumb:`https://i.ytimg.com/vi/${v}/hqdefault.jpg`};
  }
  if(host.endsWith("tiktok.com") && (m=path.match(/\/video\/(\d+)/))) return {src:`https://www.tiktok.com/embed/v2/${m[1]}`, tall:true};
  if(host.endsWith("instagram.com") && (m=path.match(/^\/(p|reel|reels|tv)\/([\w-]+)/))) return {src:`https://www.instagram.com/${m[1]==="p"?"p":"reel"}/${m[2]}/embed`, tall:true};
  if(host.endsWith("vimeo.com") && (m=path.match(/^\/(\d+)/))) return {src:`https://player.vimeo.com/video/${m[1]}`, tall:false};
  return null;
}
function linkMedia(url, label){
  const e=embedInfo(url);
  if(!e) return linkCard(url, label);
  const key="embed:"+url;
  if(!mediaCache[key]){
    const p=platformOf(url)||"the web";
    mediaCache[key]=h("div",{class:"embed-wrap"},
      h("div",{class:"embed"+(e.tall?" tall":"")},
        h("iframe",{src:e.src,title:`Video on ${p}`,loading:"lazy",allow:"autoplay; encrypted-media; picture-in-picture; fullscreen",allowfullscreen:true,referrerpolicy:"strict-origin-when-cross-origin"})),
      h("a",{class:"embed-src",href:url,target:"_blank",rel:"noopener noreferrer",text:`Open on ${p} ↗`}));
  }
  return mediaCache[key];
}
function linkCard(url, label){
  const p=platformOf(url)||"the web";
  return h("a",{class:"linkcard",href:url,target:"_blank",rel:"noopener noreferrer"},
    h("span",{},h("b",{text:label||`Watch on ${p}`}),h("small",{text:url})),
    h("span",{class:"go",text:`Open ${p} ↗`}));
}
const canPost = () => !!(session && profile && profile.over_16);

/* ---------- Data ---------- */
async function loadAll(){
  if(!sb) return;
  const q = t => sb.from(t).select("*");
  const [s,v,st,rv,cc] = await Promise.all([q("signs"),q("versions"),q("stories"),q("reviews"),sb.from("confirmation_counts").select("*")]);
  const err=[s,v,st,rv,cc].find(r=>r.error);
  if(err){ setStatus("The collection couldn't load. Check your connection and reload the page."); console.error(err.error); }
  signs=s.data||[]; versions=v.data||[]; stories=st.data||[];
  reviews={}; (rv.data||[]).forEach(r=>reviews[r.story_id]=r);
  counts={}; (cc.data||[]).forEach(r=>counts[r.item_type+":"+r.item_id]=r.n);
  mine={};
  if(meId){
    const my=await sb.from("confirmations").select("item_type,item_id");
    (my.data||[]).forEach(r=>mine[r.item_type+":"+r.item_id]=true);
  }
  const ids=[...new Set([...signs,...versions,...stories].map(x=>x.created_by).filter(id=>id && !people[id]))];
  if(ids.length){
    const pr=await sb.from("profiles").select("id,display_name,signer_is,anonymous").in("id",ids);
    (pr.data||[]).forEach(p=>people[p.id]=p);
  }
  loading=false; render();
}
async function loadMe(){
  meId = session ? session.user.id : null;
  isAnon = !!(session && session.user.is_anonymous);
  profile=null; isMod=false;
  if(meId){
    const [p,m]=await Promise.all([
      sb.from("profiles").select("*").eq("id",meId).maybeSingle(),
      sb.from("moderators").select("user_id").eq("user_id",meId).maybeSingle()]);
    profile=p.data||null; isMod=!!m.data;
    if(profile) people[meId]=profile;
  }
  updateAuthUi();
}
function updateAuthUi(){
  $("#authBtn").textContent = !session ? "Sign in" : isAnon ? "Add your email" : "Sign out";
  $("#tab-moderate").hidden = !isMod;
  if(!isMod && view==="moderate") view="home";
}

/* ---------- Boot ---------- */
async function boot(){
  if(CFG.CONTACT_EMAIL){ $("#contactLine").hidden=false; const a=$("#contactLink"); a.textContent=CFG.CONTACT_EMAIL; a.href="mailto:"+CFG.CONTACT_EMAIL; }
  $("#googleBtn").hidden = !CFG.GOOGLE_SIGNIN;
  if(!sb){ loading=false; setStatus("This site isn't connected to its database yet. Add the Supabase details to config.js."); render(); return; }
  const { data } = await sb.auth.getSession();
  session=data.session; await loadMe();
  sb.auth.onAuthStateChange(async (event, s)=>{
    const changed = (s&&s.user.id) !== meId;
    session=s;
    if(changed){ await loadMe(); await loadAll(); if(session && !profile) openProfileDialog(); }
  });
  await loadAll();
  if(session && !profile) openProfileDialog();
  document.addEventListener("visibilitychange",()=>{ if(!document.hidden) loadAll(); });
}

/* ---------- Render ---------- */
let scheduled=false;
function render(){ if(scheduled) return; scheduled=true; queueMicrotask(()=>{ scheduled=false; doRender(); }); }
function doRender(){
  document.querySelectorAll(".tabs button").forEach(b=>b.setAttribute("aria-selected", String(b.dataset.view===view || (view==="sign" && b.dataset.view==="browse"))));
  $("#home").hidden = view!=="home";
  $("#main").hidden = view==="home";
  $("#browseBar").hidden = !(view==="browse" || view==="sign");
  if(view==="home"){ renderHome(); return; }
  let node;
  if(view==="about") node=renderAbout();
  else if(view==="practise") node=renderPractise();
  else if(view==="moderate") node=renderModerate();
  else if(view==="sign") node=renderSign();
  else node=renderBrowse();
  $("#main").replaceChildren(node);
}
const approved = x => x.status==="approved";
function countFor(type,id){ return counts[type+":"+id]||0; }
function personName(id){
  if(id && id===meId) return "You";
  const p=people[id]; if(!p) return "A contributor";
  return p.anonymous ? `${p.display_name||"Anonymous"} (no account)` : (p.display_name || "A contributor");
}
function storiesFor(id){ return stories.filter(s=>s.sign_id===id && s.status!=="hidden").sort((a,b)=>(reviews[b.id]?1:0)-(reviews[a.id]?1:0) || countFor("story",b.id)-countFor("story",a.id) || (b.created_at||"").localeCompare(a.created_at||"")); }
function versionsFor(id){
  const inline=k=>k==="video"||k==="image"?1:0;
  return versions.filter(v=>v.sign_id===id && v.status!=="hidden").sort((a,b)=>countFor("version",b.id)-countFor("version",a.id) || inline(b.kind)-inline(a.kind) || (a.created_at||"").localeCompare(b.created_at||""));
}
function versionMedia(v){
  if((v.kind==="video"||v.kind==="image") && v.media_path) return mediaEl(v.kind,v.media_path);
  if(v.kind==="link" && v.url) return linkMedia(v.url);
  return null;
}
function pendingBadge(x){ return x.status==="pending" ? h("span",{class:"badge pending",text:"Awaiting approval"}) : null; }

function hasVideo(signId){ return versions.some(v=>v.sign_id===signId && v.status!=="hidden" && (v.kind==="video" || (v.kind==="link" && v.url))) || stories.some(x=>x.sign_id===signId && x.status!=="hidden" && (x.video_path||x.link)); }
function cardThumb(vs){
  const v=vs.find(x=>x.kind==="video"&&x.media_path) || vs.find(x=>x.kind==="link"&&x.url) || vs.find(x=>x.kind==="image"&&x.media_path);
  if(!v) return null;
  if(v.kind==="image") return h("span",{class:"thumb"},h("img",{src:publicUrl(v.media_path),alt:"",loading:"lazy"}));
  if(v.kind==="video") return h("span",{class:"thumb"},h("video",{src:publicUrl(v.media_path)+"#t=0.5",muted:true,playsinline:true,preload:"metadata"}),h("span",{class:"play",text:"▶ Video"}));
  const e=embedInfo(v.url), p=platformOf(v.url)||"Video";
  if(e && e.thumb) return h("span",{class:"thumb"},h("img",{src:e.thumb,alt:"",loading:"lazy"}),h("span",{class:"play",text:`▶ ${p}`}));
  return h("span",{class:"thumb"},h("span",{class:"plat",text:p}),h("span",{class:"play",text:"▶ Video"}));
}
function signCard(s){
  const st=storiesFor(s.id), vs=versionsFor(s.id);
  const kinds=[...new Set(st.map(x=>x.kind))].filter(k=>KINDS[k]);
  const conf=vs.length?countFor("version",vs[0].id):0;
  return h("button",{class:"card",type:"button",onclick:()=>openSign(s.id)},
    cardThumb(vs),
    h("span",{class:"gloss",text:s.gloss}),
    s.meaning ? h("p",{class:"meaning",text:s.meaning}) : null,
    h("span",{class:"meta"},
      s.region ? h("span",{class:"chip",text:s.region}) : null,
      h("span",{text: vs.length===1 ? "1 version" : `${vs.length} versions`}),
      h("span",{text: st.length===1 ? "1 story" : `${st.length} stories`}),
      kinds.length ? h("span",{class:"dots"}, kinds.map(k=>h("i",{class:"dot "+KINDS[k].cls,title:KINDS[k].label}))) : null),
    conf ? h("span",{class:"meta",text:`✓ Top version confirmed by ${conf}`}) : null,
    s.status==="pending" ? h("span",{class:"meta"},pendingBadge(s)) : null);
}

function renderHome(){
  const fmt=n=>n.toLocaleString("en-GB");
  const ready = sb && !loading;
  const total = Object.values(counts).reduce((a,b)=>a+b,0);
  $("#stSigns").textContent = ready?fmt(signs.filter(approved).length):"–";
  $("#stVersions").textContent = ready?fmt(versions.filter(approved).length):"–";
  $("#stStories").textContent = ready?fmt(stories.filter(approved).length):"–";
  $("#stConfirms").textContent = ready?fmt(total):"–";
  const box=$("#recent");
  if(!ready){ box.replaceChildren(h("p",{class:"progress",text: sb?"Loading signs…":"Not connected yet."})); return; }
  const recent=signs.filter(s=>s.status!=="hidden").sort((a,b)=>(b.created_at||"").localeCompare(a.created_at||"")).slice(0,6);
  box.replaceChildren(recent.length ? h("div",{class:"grid"},recent.map(signCard))
    : h("div",{class:"empty"},h("h2",{text:"The collection is just starting"}),h("p",{text:"Be one of the first to add a sign and the story behind it."}),
        h("button",{class:"btn primary",type:"button",onclick:()=>requirePoster(openSignDialog),text:"Add the first sign"})));
}

function renderBrowse(){
  if(loading) return h("p",{class:"progress",text:"Loading signs…"});
  const q=query.trim().toLowerCase();
  const list = signs.filter(s=>s.status!=="hidden")
    .filter(s=>!q || [s.gloss,s.meaning,s.region].some(v=>(v||"").toLowerCase().includes(q)))
    .filter(s=>!$("#videoOnly").checked || hasVideo(s.id))
    .sort((a,b)=>(a.gloss||"").localeCompare(b.gloss||""));
  if(!signs.length) return h("div",{class:"empty"},
    h("h2",{text:"No signs yet"}),
    h("p",{text:"Each sign gets its own page with the versions people sign, and every account of where it comes from."}),
    h("button",{class:"btn primary",type:"button",onclick:()=>requirePoster(openSignDialog),text:"Add the first sign"}));
  if(!list.length) return h("div",{class:"empty"}, h("h2",{text:"No signs match"}), h("p",{text:`Nothing matches “${query}”. Try a different word, or add it as a new sign.`}));
  return h("div",{class:"grid"}, list.map(signCard));
}

function renderSign(){
  const s=signs.find(x=>x.id===currentSignId);
  if(!s) return h("div",{class:"empty"}, h("h2",{text:"This sign isn't available"}), h("button",{class:"btn",type:"button",onclick:()=>go("browse"),text:"Back to all signs"}));
  const vs=versionsFor(s.id), st=storiesFor(s.id), top=vs.find(approved)||vs[0];
  const head=h("div",{class:"signhead"},
    h("button",{class:"linkbtn",type:"button",onclick:()=>go("browse"),text:"← All signs"}),
    h("h1",{class:"gloss",text:s.gloss}),
    pendingBadge(s),
    s.meaning ? h("p",{text:s.meaning}) : null,
    h("div",{class:"meta"},
      s.region ? h("span",{class:"chip",text:s.region}) : null,
      h("span",{text:`Added by ${personName(s.created_by)}${s.created_at?" · "+fmtDate(s.created_at):""}`})),
    top && (top.kind==="video"||top.kind==="image") && top.media_path ? mediaEl(top.kind,top.media_path)
      : h("div",{class:"novid",text: vs.length ? "The versions of this sign are links or descriptions. See them alongside." : "No one has shown how this sign is made yet."}),
    (isMod || (s.created_by===meId)) ? h("div",{class:"actions"},
      isMod && s.status!=="approved" ? h("button",{class:"btn small",type:"button",onclick:()=>moderate("signs",s,"approved"),text:"Approve sign"}) : null,
      deleteBtn("sign:"+s.id,"Remove sign",()=>removeSign(s))) : null);

  const versionsSec=h("section",{class:"accounts"},
    h("div",{class:"accounts-head"},
      h("h2",{text: vs.length ? `How it's signed · ${vs.length} ${vs.length===1?"version":"versions"}` : "How it's signed"}),
      h("span",{class:"actions"},
        h("button",{class:"btn small",type:"button",onclick:()=>requirePoster(openQuickDialog),text:"Post a video link"}),
        h("button",{class:"btn primary small",type:"button",onclick:()=>requirePoster(()=>openVersionDialog(s)),text:"Add your version"}))),
    h("p",{class:"sub",text:"Confirm a version if you sign it this way or recognise it. Versions with the most confirmations come first."}),
    vs.length ? vs.map((v,i)=>renderVersion(v,i===0&&vs.length>1&&countFor("version",v.id)>0)) : h("div",{class:"empty"},h("p",{text:"Add a video, an image, a link to a video, or describe the handshape and movement in words."})));

  const storiesSec=h("section",{class:"accounts"},
    h("div",{class:"accounts-head"},
      h("h2",{text: st.length ? `Where it comes from · ${st.length} ${st.length===1?"account":"accounts"}` : "Where it comes from"}),
      h("button",{class:"btn primary small",type:"button",onclick:()=>requirePoster(()=>openStoryDialog(s)),text:"Share an account"})),
    h("p",{class:"sub",text:"Confirm an account if you've heard it too. Accounts that disagree all stay visible."}),
    st.length ? st.map(renderStory) : h("div",{class:"empty"},
      h("p",{text:"No one has shared where this sign comes from yet. If you know a story, a source, or a memory of it changing, add it."})));

  return h("div",{class:"detail"}, head, h("div",{class:"section-stack"}, versionsSec, storiesSec));
}

function footer(x,extra,table){
  const mine = x.created_by===meId;
  return h("div",{class:"storyfoot"},
    h("span",{class:"who",text:`${personName(x.created_by)}${extra||""}${x.created_at?" · "+fmtDate(x.created_at):""}`}),
    (mine||isMod) ? h("span",{class:"actions"},
      isMod && x.status!=="approved" ? h("button",{class:"btn small",type:"button",onclick:()=>moderate(table,x,"approved"),text:"Approve"}) : null,
      isMod && x.status==="approved" ? h("button",{class:"btn small",type:"button",onclick:()=>moderate(table,x,"hidden"),text:"Hide"}) : null,
      deleteBtn(table+":"+x.id,"Remove",()=>removeItem(table,x))) : null);
}
function confirmBtn(type,item,label){
  const n=countFor(type,item.id), own=item.created_by===meId, on=!!mine[type+":"+item.id];
  const text = n===1 ? "Confirmed by 1 signer" : `Confirmed by ${n} signers`;
  if(item.status!=="approved") return null;
  if(own) return h("span",{class:"confirm",title:"You can't confirm your own post",text:n?"✓ "+text:"Not yet confirmed"});
  return h("button",{class:"confirm",type:"button","aria-pressed":String(on),title:label,onclick:()=>requireEmail(()=>toggleVote(type,item))},
    on ? `✓ You confirmed · ${n}` : `✓ ${label}${n?" · "+n:""}`);
}
function renderVersion(v,isTop){
  const label={video:"Video",image:"Image",link:platformOf(v.url||"")||"Link",text:"Written description"}[v.kind]||"Version";
  return h("article",{class:"version"+(isTop?" top":"")},
    h("div",{class:"badges"}, h("span",{class:"chip",text:label}), isTop ? h("span",{class:"badge reviewed",text:"Most confirmed"}) : null, pendingBadge(v)),
    versionMedia(v),
    v.description ? h("p",{class:"descr",text:v.description}) : null,
    h("div",{class:"actions"},confirmBtn("version",v,"I sign it this way")),
    footer(v,"","versions"));
}
function renderStory(x){
  const k=KINDS[x.kind]||KINDS.community, rv=reviews[x.id], p=people[x.created_by];
  const who = p && p.signer_is ? ", "+p.signer_is.replace(/^A /,"a ").replace(/^An /,"an ") : "";
  return h("article",{class:"story"},
    h("div",{class:"badges"},
      h("span",{class:"badge "+k.cls},h("i",{class:"dot"}),k.label),
      rv ? h("span",{class:"badge reviewed",text:"✓ Reviewed by the community panel"}) : null,
      pendingBadge(x)),
    x.video_path ? mediaEl("video",x.video_path) : null,
    x.link ? linkMedia(x.link,"Watch the video") : null,
    x.body ? h("p",{class:"text",text:x.body}) : null,
    x.hook ? h("p",{class:"hook"},h("b",{text:"Memory hook"}),x.hook) : null,
    x.source ? h("p",{class:"source",text:"Source: "+x.source}) : null,
    h("div",{class:"actions"},
      confirmBtn("story",x,"I've heard this too"),
      isMod && x.status==="approved" ? h("button",{class:"btn small",type:"button",onclick:()=>toggleReview(x),text: rv?"Undo panel review":"Mark reviewed by panel"}) : null),
    footer(x,who,"stories"));
}
function deleteBtn(key,label,fn){
  const isArmed = armed===key;
  return h("button",{class:"btn small danger"+(isArmed?" armed":""),type:"button",onclick:()=>{
    if(isArmed){ armed=null; fn(); } else { armed=key; render(); setTimeout(()=>{ if(armed===key){ armed=null; render(); } },4000); }
  },text: isArmed?"Tap again to remove":label});
}

function renderModerate(){
  const pend=[...signs.filter(x=>x.status==="pending").map(x=>["signs",x]),
              ...versions.filter(x=>x.status==="pending").map(x=>["versions",x]),
              ...stories.filter(x=>x.status==="pending").map(x=>["stories",x])]
    .sort((a,b)=>(a[1].created_at||"").localeCompare(b[1].created_at||""));
  if(!pend.length) return h("div",{class:"empty"},h("h2",{text:"Nothing waiting"}),h("p",{text:"New posts appear here for approval before they go public."}));
  return h("div",{class:"modlist"}, h("h2",{text:`Waiting for approval · ${pend.length}`}), pend.map(([t,x])=>{
    const sign = t==="signs" ? x : signs.find(s=>s.id===x.sign_id);
    const what = t==="signs" ? "New sign" : t==="versions" ? "New version" : "New origin story";
    return h("article",{class:"moditem"},
      h("h3",{},`${what}: `,h("span",{class:"gloss",text:sign?sign.gloss:"(sign removed)"})),
      t==="signs" ? h("p",{class:"source",text:[x.meaning,x.region].filter(Boolean).join(" · ")||"No meaning or region given"}) : null,
      t==="versions" ? versionMedia(x) : null,
      t==="versions" && x.description ? h("p",{class:"descr",text:x.description}) : null,
      t==="stories" ? h("p",{class:"text",text:x.body||"(video or link only)"}) : null,
      t==="stories" && x.link ? linkMedia(x.link,"Watch the video") : null,
      t==="stories" && x.video_path ? mediaEl("video",x.video_path) : null,
      h("p",{class:"source",text:`From ${personName(x.created_by)} · ${fmtDate(x.created_at)}`}),
      h("div",{class:"actions"},
        h("button",{class:"btn primary small",type:"button",onclick:()=>moderate(t,x,"approved"),text:"Approve"}),
        h("button",{class:"btn small",type:"button",onclick:()=>moderate(t,x,"hidden"),text:"Hide"}),
        sign ? h("button",{class:"linkbtn",type:"button",onclick:()=>openSign(sign.id),text:"Open sign"}) : null));
  }));
}

function practiseVersion(signId){ const vs=versionsFor(signId).filter(approved); return vs.find(v=>(v.kind==="video"||v.kind==="image")&&v.media_path) || vs.find(v=>v.kind==="link"&&v.url); }
function renderPractise(){
  if(loading) return h("p",{class:"progress",text:"Loading signs…"});
  const pool=signs.filter(s=>approved(s) && practiseVersion(s.id));
  if(!pool.length) return h("div",{class:"empty"}, h("h2",{text:"Nothing to practise yet"}), h("p",{text:"Practise uses signs that have a video, image or linked post. Watch the sign, guess what it means, then see the story that explains it."}));
  if(!deck.length || deck.some(id=>!pool.find(s=>s.id===id))) buildDeck(pool);
  const s=pool.find(x=>x.id===deck[deckPos]) || pool[0];
  const v=practiseVersion(s.id);
  const known=pool.filter(x=>progress[x.id]&&progress[x.id].known).length;
  const st=storiesFor(s.id).filter(approved);
  const best=st.find(x=>x.hook) || st.find(x=>x.body);
  return h("div",{class:"practise"},
    h("div",{class:"progress"},`${known} of ${pool.length} signs known · card ${deckPos+1} of ${deck.length}`),
    h("div",{class:"bar"},h("i",{style:`width:${Math.round(known/pool.length*100)}%`})),
    h("div",{class:"flash"},
      h("p",{style:"margin:0;font-weight:700",text:"What does this sign mean?"}),
      versionMedia(v),
      revealed ? h("div",{class:"answer"},
        h("span",{class:"gloss",text:s.gloss}),
        s.meaning ? h("p",{style:"margin:0",text:s.meaning}) : null,
        best ? h("p",{class:"hook"},h("b",{text:"Why it looks like this"}), best.hook || best.body.slice(0,280)+(best.body.length>280?"…":"")) : h("p",{class:"source",text:"No story for this sign yet."}),
        h("div",{class:"actions"},
          h("button",{class:"btn primary",type:"button",onclick:()=>mark(s.id,true),text:"I knew it"}),
          h("button",{class:"btn",type:"button",onclick:()=>mark(s.id,false),text:"Not yet"}),
          h("button",{class:"linkbtn",type:"button",onclick:()=>openSign(s.id),text:"See all versions and stories"})))
      : h("div",{class:"actions"}, h("button",{class:"btn primary",type:"button",onclick:()=>{revealed=true;render();},text:"Show the answer"}))));
}
function buildDeck(pool){
  const isKnown=s=>progress[s.id]&&progress[s.id].known;
  const shuffle=a=>a.map(v=>[Math.random(),v]).sort((x,y)=>x[0]-y[0]).map(x=>x[1]);
  deck=[...shuffle(pool.filter(s=>!isKnown(s))),...shuffle(pool.filter(isKnown))].map(s=>s.id); deckPos=0; revealed=false;
}
function mark(id,knew){
  progress[id]={known:knew,seen:((progress[id]&&progress[id].seen)||0)+1}; save("bslss-progress",progress);
  revealed=false; deckPos++; if(deckPos>=deck.length) deck=[]; render();
}

function renderAbout(){
  return h("div",{class:"about"},
    h("h2",{text:"How this collection works"}),
    h("p",{text:"BSL was made by the British Deaf community, and so were the stories of where its signs come from. This is a place to share those stories, in the words and the signs of the people who know them, for anyone who wants to."}),
    h("h3",{text:"BSL first"}),
    h("p",{text:"Signed stories come first. Written English is welcome alongside them, but it's a translation, not the original."}),
    h("h3",{text:"Confirmations"}),
    h("p",{text:"Anyone signed in can confirm a version they sign or an account they've heard. Each person confirms an item once, and can't confirm their own. A high count shows that many signers recognise something. A low count doesn't make a version wrong; it may be rare, regional or new."}),
    h("h3",{text:"Many accounts, side by side"}),
    h("p",{text:"Plenty of signs have more than one origin story. Each account says what kind it is: a documented source, a community account, a personal memory, or a story that others dispute."}),
    h("h3",{text:"Regional signs are not mistakes"}),
    h("p",{text:"There is no single correct sign for many words. A regional variant gets its own entry with the place it's used."}),
    h("h3",{text:"Approval before posts go public"}),
    h("p",{text:"New posts are checked before they appear, to keep out spam and anything shared without consent. You can see your own posts straight away, marked as awaiting approval."}),
    h("h3",{text:"Consent and name signs"}),
    h("ul",{},
      h("li",{text:"Only share what is yours to share. Only post a video or image of someone else with their agreement."}),
      h("li",{text:"Name signs belong to the people they name. Don't explain someone's name sign without their agreement."}),
      h("li",{},"If you appear in something someone else posted and want it removed, see ",h("a",{href:"privacy.html",text:"removing content"}),".")),
    h("h3",{text:"Community review"}),
    h("p",{text:"Moderators, ideally a panel of Deaf BSL users, can mark an account as reviewed. Review means the panel recognises the account. It doesn't mean other accounts are wrong."}));
}

/* ---------- Navigation ---------- */
function go(v){ view=v; armed=null; if(v!=="practise") revealed=false; render(); window.scrollTo({top:0}); }
function openSign(id){ currentSignId=id; go("sign"); }
document.querySelectorAll("[data-view]").forEach(b=>b.addEventListener("click",e=>{ e.preventDefault(); go(b.dataset.view); }));
$("#videoOnly").addEventListener("change",()=>{ if(view!=="browse") view="browse"; render(); });
$("#search").addEventListener("input",e=>{ query=e.target.value; if(view!=="browse") view="browse"; render(); });
document.querySelectorAll("[data-close]").forEach(b=>b.addEventListener("click",()=>b.closest("dialog").close()));
$("#addSignBtn").addEventListener("click",()=>requirePoster(openSignDialog));
$("#heroAdd").addEventListener("click",()=>requirePoster(openQuickDialog));

/* ---------- Sign-in ---------- */
let afterProfile=null, pendingFn=null;
function requirePoster(fn){
  if(!sb){ setStatus("This site isn't connected to its database yet."); return; }
  if(!session){ pendingFn=fn; openAuthDialog("post"); return; }
  if(!canPost()){ afterProfile=fn; openProfileDialog(); return; }
  fn();
}
function requireEmail(fn){
  if(!sb) return;
  if(!session || isAnon){ pendingFn=null; openAuthDialog("confirm"); return; }
  if(!canPost()){ afterProfile=fn; openProfileDialog(); return; }
  fn();
}
function openAuthDialog(mode){
  $("#authForm").reset(); $("#authMsg").textContent="";
  const anonPossible = mode==="post";
  $("#anonChoice").hidden = !anonPossible;
  $("#authTitle").textContent = mode==="confirm" ? "Sign in to confirm" : isAnon ? "Add your email" : mode==="post" ? "How would you like to post?" : "Sign in";
  $("#authIntro").textContent = mode==="confirm"
    ? "Confirmations count one per person, so confirming needs an email sign-in. We'll send you a link; there's no password."
    : isAnon ? "Add your email to keep control of what you've posted from any device, and to confirm other people's posts."
    : "Sign in with your email and we'll send you a link; there's no password. Signing in lets you remove your posts later and confirm what you recognise.";
  if(!$("#authDialog").open) $("#authDialog").showModal();
}
$("#anonBtn").addEventListener("click",async()=>{
  const msg=$("#authMsg"), btn=$("#anonBtn");
  btn.disabled=true; msg.dataset.tone="info"; msg.textContent="One moment…";
  afterProfile=pendingFn; pendingFn=null;
  const { error } = await sb.auth.signInAnonymously();
  btn.disabled=false;
  if(error){ afterProfile=null; msg.dataset.tone=""; msg.textContent = /disabled|not enabled/i.test(error.message) ? "Posting without an account isn't switched on yet. Please sign in with your email for now." : "That didn't work. Try again in a moment."; return; }
  $("#authDialog").close();
});
$("#authBtn").addEventListener("click",async()=>{
  if(!sb) return;
  if(session && !isAnon){ await sb.auth.signOut(); session=null; await loadMe(); await loadAll(); setStatus("You've signed out.","info"); }
  else openAuthDialog(isAnon ? "upgrade" : "signin");
});
const redirectTo = () => location.origin + location.pathname;
$("#authForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const msg=$("#authMsg"), btn=$("#authSubmit"), email=$("#aEmail").value.trim();
  msg.dataset.tone="";
  if(!/^\S+@\S+\.\S+$/.test(email)){ msg.textContent="Enter a full email address."; return; }
  btn.disabled=true; msg.dataset.tone="info"; msg.textContent="Sending…";
  const { error } = isAnon
    ? await sb.auth.updateUser({ email }, { emailRedirectTo: redirectTo() })
    : await sb.auth.signInWithOtp({ email, options:{ emailRedirectTo: redirectTo() } });
  btn.disabled=false;
  if(error){ msg.dataset.tone=""; msg.textContent = /rate/i.test(error.message) ? "Too many sign-in emails have been sent. Wait a few minutes and try again." : /already/i.test(error.message) ? "That email already has an account. Sign out of this browser's anonymous session first, then sign in with it." : "The email couldn't be sent. Check the address and try again."; return; }
  msg.textContent = isAnon ? `Check ${email} and click the link to confirm it. Everything you've posted stays yours.` : `Check ${email} for a sign-in link. You can close this window.`;
});
$("#googleBtn").addEventListener("click",()=>sb.auth.signInWithOAuth({provider:"google",options:{redirectTo:redirectTo()}}));
function openProfileDialog(){
  $("#profileMsg").textContent="";
  $("#pNameLabel").textContent = isAnon ? "Name to show (optional)" : "Name to show";
  $("#pName").required = !isAnon;
  if($("#profileDialog").open) return;
  $("#pName").value = profile ? profile.display_name : "";
  $("#pSigner").value = profile ? profile.signer_is : "";
  $("#pOver16").checked = !!(profile && profile.over_16);
  $("#profileDialog").showModal();
}
$("#profileForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const msg=$("#profileMsg"); let name=$("#pName").value.trim();
  if(!name && isAnon) name="Anonymous";
  if(!name){ msg.textContent="Add the name you'd like shown."; return; }
  if(!$("#pOver16").checked){ msg.textContent="You need to be 16 or over to post."; return; }
  $("#profileSubmit").disabled=true;
  const row={id:meId, display_name:name, signer_is:$("#pSigner").value, over_16:true};
  const { error } = await sb.from("profiles").upsert(row);
  $("#profileSubmit").disabled=false;
  if(error){ msg.textContent="That didn't save. Try again."; return; }
  profile={...(profile||{}),...row}; people[meId]=profile;
  $("#profileDialog").close(); render();
  if(afterProfile){ const f=afterProfile; afterProfile=null; f(); }
});

/* ---------- Writes ---------- */
const stillPending = () => isMod ? "" : " It will appear publicly once it's approved.";
function writeError(e){
  const m=(e && (e.message||e.error)) || "";
  if(/row-level security|permission/i.test(m)) return "You don't have permission to do that. Try signing out and in again.";
  if(/exceeded the maximum allowed size|payload too large|413/i.test(m)) return "That file is over 20 MB. Trim it or use a shorter clip.";
  if(/mime type|invalid_mime/i.test(m)) return "That file type isn't supported. Use MP4 or WebM for video, and JPEG, PNG, WebP or GIF for images. iPhone HEIC photos need exporting as JPEG first.";
  return "That didn't save. Check your connection and try again.";
}
async function upload(file, kind){
  let type=file.type;
  if(kind==="video"){ if(!type) type="video/mp4"; if(!["video/mp4","video/webm","video/quicktime"].includes(type)) throw {message:"invalid_mime"}; }
  else { if(type==="image/jpg") type="image/jpeg"; if(!["image/jpeg","image/png","image/webp","image/gif"].includes(type)) throw {message:"invalid_mime"}; }
  if(file.size>20*1024*1024) throw {message:"payload too large"};
  const ext=(file.name.split(".").pop()||"bin").toLowerCase().replace(/[^a-z0-9]/g,"").slice(0,5)||"bin";
  const path=`${meId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await sb.storage.from("media").upload(path, file, { contentType:type, upsert:false });
  if(error) throw error;
  return path;
}
async function insert(table,row){
  const { data, error } = await sb.from(table).insert(row).select().single();
  if(error) throw error;
  return data;
}

function openSignDialog(){ $("#signForm").reset(); $("#signMsg").textContent=""; $("#signDialog").showModal(); }
$("#signForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const msg=$("#signMsg"), btn=$("#signSubmit");
  const gloss=$("#sGloss").value.trim().toUpperCase();
  if(!gloss){ msg.textContent="Add a gloss for the sign."; return; }
  btn.disabled=true; msg.dataset.tone="info"; msg.textContent="Saving…";
  try{
    const row=await insert("signs",{gloss, meaning:$("#sMeaning").value.trim(), region:$("#sRegion").value.trim()});
    signs.push(row); $("#signDialog").close(); openSign(row.id); openVersionDialog(row);
  }catch(err){ msg.dataset.tone=""; msg.textContent=writeError(err); }
  finally{ btn.disabled=false; }
});

let versionSign=null;
function vkind(){ return ($("#versionForm").querySelector("input[name=vkind]:checked")||{}).value || "video"; }
function syncVersionForm(){
  const k=vkind();
  $("#vFileField").hidden = !(k==="video"||k==="image");
  $("#vUrlField").hidden = k!=="link";
  $("#vFileLabel").textContent = k==="image" ? "Image file" : "Video file";
  $("#vFile").accept = k==="image" ? "image/jpeg,image/png,image/webp,image/gif" : "video/mp4,video/webm,video/quicktime,video/*";
  $("#vFileHint").textContent = k==="image" ? "JPEG, PNG, WebP or GIF, under 20 MB. A photo sequence or diagram of the sign works well." : "MP4, WebM or iPhone video, under 20 MB. A few seconds is enough.";
  $("#vDescLabel").textContent = k==="text" ? "Describe the sign" : "Notes";
}
$("#versionForm").querySelectorAll("input[name=vkind]").forEach(r=>r.addEventListener("change",()=>{ $("#vFile").value=""; syncVersionForm(); }));
function openVersionDialog(s){
  versionSign=s; const keep=vkind(); $("#versionForm").reset();
  const r=$("#versionForm").querySelector(`input[name=vkind][value=${keep}]`); if(r) r.checked=true;
  $("#versionMsg").textContent=""; $("#versionGloss").textContent=s.gloss; syncVersionForm(); $("#versionDialog").showModal();
}
$("#versionForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const msg=$("#versionMsg"), btn=$("#versionSubmit"), k=vkind();
  const desc=$("#vDesc").value.trim(), f=$("#vFile").files[0], url=$("#vUrl").value.trim();
  msg.dataset.tone="";
  if((k==="video"||k==="image") && !f){ msg.textContent=`Choose ${k==="image"?"an image":"a video"} to upload.`; return; }
  if(k==="link" && !isUrl(url)){ msg.textContent="Paste the full link to the video, starting with https://"; return; }
  if(k==="text" && !desc){ msg.textContent="Describe the handshape, where it's made and the movement."; return; }
  if(!$("#vConsent").checked){ msg.textContent="Confirm that you're signing, or have the person's agreement."; return; }
  btn.disabled=true; msg.dataset.tone="info";
  try{
    let media_path=null;
    if(f && (k==="video"||k==="image")){ msg.textContent="Uploading…"; media_path=await upload(f,k); }
    msg.textContent="Saving…";
    versions.push(await insert("versions",{sign_id:versionSign.id, kind:k, media_path, url:k==="link"?url:"", description:desc}));
    $("#versionDialog").close(); render(); setStatus("Thanks for adding your version."+stillPending(),"info");
  }catch(err){ msg.dataset.tone=""; msg.textContent=writeError(err); }
  finally{ btn.disabled=false; }
});

function findSign(gloss,region){
  const g=gloss.toUpperCase(), r=(region||"").trim().toLowerCase();
  const same=signs.filter(s=>(s.gloss||"").toUpperCase()===g && s.status!=="hidden");
  return (r && same.find(s=>(s.region||"").toLowerCase()===r)) || (!r ? same[0] : null) || null;
}
function syncQuickHint(){
  const g=$("#qGloss").value.trim(); if(!g){ $("#qGlossHint").textContent="Start typing to pick a sign already here, or enter a new one."; return; }
  const s=findSign(g,$("#qRegion").value), r=$("#qRegion").value.trim();
  $("#qGlossHint").textContent = s ? `Adds to the existing sign ${s.gloss}${s.region?" ("+s.region+")":""}.` : `Creates a new sign, ${g.toUpperCase()}${r?" ("+r+")":""}.`;
}
function openQuickDialog(){
  $("#quickForm").reset(); $("#quickMsg").textContent=""; $("#qKindField").hidden=true;
  const seen=new Set();
  $("#glossList").replaceChildren(...signs.filter(s=>s.status!=="hidden").map(s=>s.gloss).filter(g=>g && !seen.has(g) && seen.add(g)).sort().map(g=>h("option",{value:g})));
  if(view==="sign"){ const s=signs.find(x=>x.id===currentSignId); if(s){ $("#qGloss").value=s.gloss; $("#qRegion").value=s.region||""; } }
  syncQuickHint(); $("#quickDialog").showModal();
}
$("#qGloss").addEventListener("input",syncQuickHint);
$("#qRegion").addEventListener("input",syncQuickHint);
$("#qStory").addEventListener("input",()=>{ $("#qKindField").hidden=!$("#qStory").value.trim(); });
$("#quickForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const msg=$("#quickMsg"), btn=$("#quickSubmit");
  const url=$("#qUrl").value.trim(), gloss=$("#qGloss").value.trim().toUpperCase(), region=$("#qRegion").value.trim(), story=$("#qStory").value.trim();
  msg.dataset.tone="";
  if(!isUrl(url)){ msg.textContent="Paste the full link to the video, starting with https://"; return; }
  if(!gloss){ msg.textContent="Say which sign the video shows."; return; }
  if(!$("#qConsent").checked){ msg.textContent="Confirm that it's your video, or that the person in it is happy to share it."; return; }
  btn.disabled=true; msg.dataset.tone="info"; msg.textContent="Saving…";
  try{
    let sign=findSign(gloss,region);
    if(!sign){ sign=await insert("signs",{gloss, meaning:"", region}); signs.push(sign); }
    versions.push(await insert("versions",{sign_id:sign.id, kind:"link", url, description:""}));
    if(story) stories.push(await insert("stories",{sign_id:sign.id, kind:$("#qKind").value, body:story, link:url}));
    $("#quickDialog").close(); openSign(sign.id); setStatus("Thanks for sharing."+stillPending(),"info");
  }catch(err){ msg.dataset.tone=""; msg.textContent=writeError(err); }
  finally{ btn.disabled=false; }
});

let storySign=null;
function openStoryDialog(s){ storySign=s; $("#storyForm").reset(); $("#storyMsg").textContent=""; $("#storyGloss").textContent=s.gloss; $("#storyDialog").showModal(); }
$("#storyForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const msg=$("#storyMsg"), btn=$("#storySubmit");
  const kind=($("#storyForm").querySelector("input[name=kind]:checked")||{}).value;
  const body=$("#tText").value.trim(), f=$("#tVideo").files[0], link=$("#tLink").value.trim();
  msg.dataset.tone="";
  if(!kind){ msg.textContent="Choose what kind of account this is."; return; }
  if(link && !isUrl(link)){ msg.textContent="Paste the full link to the video, starting with https://"; return; }
  if(!body && !f && !link){ msg.textContent="Add a video, a link or a written account."; return; }
  if(!$("#tConsent").checked){ msg.textContent="Confirm that this account is yours to share."; return; }
  btn.disabled=true; msg.dataset.tone="info";
  try{
    let video_path=null;
    if(f){ msg.textContent="Uploading video…"; video_path=await upload(f,"video"); }
    msg.textContent="Saving…";
    stories.push(await insert("stories",{sign_id:storySign.id, kind, body, video_path, link, hook:$("#tHook").value.trim(), source:$("#tSource").value.trim()}));
    $("#storyDialog").close(); render(); setStatus("Thanks for sharing this story."+stillPending(),"info");
  }catch(err){ msg.dataset.tone=""; msg.textContent=writeError(err); }
  finally{ btn.disabled=false; }
});

async function toggleVote(type,item){
  const key=type+":"+item.id, on=!!mine[key];
  if(on){ delete mine[key]; counts[key]=Math.max(0,(counts[key]||1)-1); } else { mine[key]=true; counts[key]=(counts[key]||0)+1; }
  render();
  const res = on
    ? await sb.from("confirmations").delete().match({user_id:meId,item_type:type,item_id:item.id})
    : await sb.from("confirmations").insert({item_type:type,item_id:item.id});
  if(res.error && !/duplicate/i.test(res.error.message)){ setStatus("Your confirmation didn't save. Try again."); loadAll(); }
}
async function moderate(table,x,status){
  const { error } = await sb.from(table).update({status}).eq("id",x.id);
  if(error){ setStatus(writeError(error)); return; }
  x.status=status; render();
}
async function toggleReview(x){
  const res = reviews[x.id] ? await sb.from("reviews").delete().eq("story_id",x.id) : await sb.from("reviews").insert({story_id:x.id});
  if(res.error){ setStatus("The review didn't save."); return; }
  if(reviews[x.id]) delete reviews[x.id]; else reviews[x.id]={story_id:x.id};
  render();
}
async function removeItem(table,x){
  const { error } = await sb.from(table).delete().eq("id",x.id);
  if(error){ setStatus(writeError(error)); return; }
  const path = x.media_path || x.video_path;
  if(path) sb.storage.from("media").remove([path]);
  if(table==="versions") versions=versions.filter(v=>v.id!==x.id); else stories=stories.filter(s=>s.id!==x.id);
  render();
}
async function removeSign(s){
  const others=[...versions,...stories].some(x=>x.sign_id===s.id && x.created_by!==meId);
  if(others && !isMod){ setStatus("Other people have added to this sign, so it can't be removed. Remove your own posts instead, or ask a moderator."); return; }
  const paths=[...versions,...stories].filter(x=>x.sign_id===s.id).map(x=>x.media_path||x.video_path).filter(Boolean);
  const { error } = await sb.from("signs").delete().eq("id",s.id);
  if(error){ setStatus(writeError(error)); return; }
  if(paths.length) sb.storage.from("media").remove(paths);
  signs=signs.filter(x=>x.id!==s.id); versions=versions.filter(x=>x.sign_id!==s.id); stories=stories.filter(x=>x.sign_id!==s.id);
  go("browse");
}

render();
boot();
