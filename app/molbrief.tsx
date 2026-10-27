"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine, ArrowRight, ArrowUpRight, AudioLines, BookOpen, Bookmark,
  Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, CircleHelp,
  Compass, ExternalLink, FileText, FlaskConical, Headphones, Leaf, Loader2,
  Microscope, Network, Pause, Play, Plus, RefreshCw, Search, Settings2,
  ShieldCheck, SlidersHorizontal, Sparkles, Tag, Trash2, Volume2, X,
} from "lucide-react";
import seedData from "@/data/seed.json";
import {
  Article, Category, DEFAULT_PREFERENCES, Preferences, STARTER_TOPICS, Topic, UserState,
} from "@/lib/molbrief-types";

type View = "today" | "discover" | "saved" | "topics" | "settings";
const categories=["全部","产业","研究","工具","临床"];
const categoryNames:Record<string,string>={全部:"全部内容",产业:"产业动态",研究:"研究论文",工具:"AI 工具",临床:"临床进展"};
const navItems=[
  {view:"today" as View,label:"今日精选",icon:BookOpen},
  {view:"discover" as View,label:"探索发现",icon:Compass},
  {view:"saved" as View,label:"我的收藏",icon:Bookmark},
];
const topicSuggestions=[
  {name:"蛋白制剂与递送",query:"nanobody protein formulation delivery",anchor:"VHH",description:"从分子设计，走向给药与稳定性。"},
  {name:"多特异性抗体",query:"bispecific antibody design",anchor:"抗体设计",description:"看看不同结合界面如何协同工作。"},
  {name:"AI 分子的临床验证",query:'artificial intelligence drug discovery clinical trial',anchor:"AI 制药",description:"关注计算设计走向人体研究的证据。"},
  {name:"结合动力学",query:"antibody binding kinetics affinity maturation",anchor:"抗体设计",description:"从结合强度，进一步理解结合行为。"},
  {name:"结构条件生成",query:"structure conditioned protein generation",anchor:"AI 制药",description:"跟进序列与结构联合设计的新方法。"},
  {name:"人源化与可开发性",query:"nanobody humanization developability",anchor:"VHH",description:"把设计候选与开发条件联系起来。"},
];
const formatDate=(date:string|null)=>date?date.replace(/-/g,"."): "日期未提供";
const readMinutes=(a:Article)=>Math.max(1,Math.ceil((a.summary.length+a.keyPoints.join("").length)/450));
const speechText=(a:Article)=>a.title+"。"+a.summary+"。"+a.keyPoints.join("。")+"。阅读提示："+a.limitations;
type ApiResponses = {
  feed: { articles: Article[] };
  state: UserState;
  reading: UserState;
  collect: UserState;
  topics: UserState;
  preferences: UserState;
  search: { articles: Article[]; source: "pubmed" | "web" };
  summarize: { article: Article };
  audio: { id: string; cached: boolean };
};
async function api<P extends keyof ApiResponses>(path:P,body?:unknown):Promise<ApiResponses[P]> {
  const response=await fetch("/api/"+path,body?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}:{cache:"no-store"});
  const data=await response.json() as ApiResponses[P] & {error?:string};
  if(!response.ok) throw new Error(data.error||"这次操作未完成，请稍后重试。");
  return data;
}
function TopicArt({kind="研究",large=false}:{kind?:string,large?:boolean}) {
  return <div className={"topic-art art-"+kind+(large?" large":"")} aria-hidden="true">
    <svg viewBox="0 0 200 150" fill="none">
      <g stroke="currentColor" strokeWidth="1.2" opacity=".48">
        <ellipse cx="100" cy="75" rx="67" ry="24" transform="rotate(-35 100 75)"/>
        <ellipse cx="100" cy="75" rx="67" ry="24" transform="rotate(35 100 75)"/>
        <ellipse cx="100" cy="75" rx="67" ry="24" transform="rotate(90 100 75)"/>
        <circle cx="100" cy="75" r="50" strokeDasharray="2 7"/>
      </g>
      <circle cx="100" cy="75" r="11" fill="currentColor" opacity=".8"/>
      <circle cx="65" cy="44" r="5" fill="currentColor"/>
      <circle cx="148" cy="91" r="6" fill="currentColor" opacity=".7"/>
      <circle cx="92" cy="126" r="4" fill="currentColor" opacity=".5"/>
      <path d="M13 132h28M159 18h28M27 123v18M173 9v18" stroke="currentColor" opacity=".25"/>
    </svg>
    <span>{kind==="工具"?"METHODS":kind==="产业"?"INDUSTRY":kind==="临床"?"EVIDENCE":"RESEARCH"}</span>
  </div>;
}
function Brand({small=false}:{small?:boolean}) {
  return <div className={"brand"+(small?" small":"")}><img src="/favicon.svg" alt="" width="38" height="38"/><div><strong>研览<span>MolBrief</span></strong>{!small&&<p>你的制药与研究情报站</p>}</div></div>;
}
export default function MolBrief({signedIn,displayName}:{signedIn:boolean,displayName:string}) {
  const [view,setView]=useState<View>("today");
  const [articles,setArticles]=useState<Article[]>(seedData as Article[]);
  const [user,setUser]=useState<UserState>({
    signedIn,displayName,saved:[],read:[],topics:[],
    preferences:DEFAULT_PREFERENCES,
    capabilities:{parallel:false,llm:false,tts:false,codex:false},
  });
  const [category,setCategory]=useState("全部");
  const [localQuery,setLocalQuery]=useState("");
  const [searchQuery,setSearchQuery]=useState("");
  const [searchSource,setSearchSource]=useState<"pubmed"|"web">("pubmed");
  const [searchResults,setSearchResults]=useState<Article[]|null>(null);
  const [searching,setSearching]=useState(false);
  const [searchError,setSearchError]=useState("");
  const [resultLabel,setResultLabel]=useState("");
  const [refreshing,setRefreshing]=useState(false);
  const [reader,setReader]=useState<Article|null>(null);
  const [toast,setToast]=useState("");
  const [configModal,setConfigModal]=useState<string|null>(null);
  const [helpOpen,setHelpOpen]=useState(false);
  const [topicName,setTopicName]=useState("");
  const [topicBusy,setTopicBusy]=useState(false);
  const [busyId,setBusyId]=useState<string|null>(null);
  const [hideRead,setHideRead]=useState(false);
  const [voices,setVoices]=useState<SpeechSynthesisVoice[]>([]);
  const [listening,setListening]=useState<Article|null>(null);
  const [playing,setPlaying]=useState(false);
  const [audioBusy,setAudioBusy]=useState(false);
  const [audioProgress,setAudioProgress]=useState(0);
  const [audioKind,setAudioKind]=useState("设备朗读");
  const [installPrompt,setInstallPrompt]=useState<any>(null);
  const [installHelp,setInstallHelp]=useState(false);
  const dialogRef=useRef<HTMLDialogElement>(null);
  const infoRef=useRef<HTMLDialogElement>(null);
  const utteranceRef=useRef<SpeechSynthesisUtterance|null>(null);
  const audioRef=useRef<HTMLAudioElement|null>(null);
  const queueRef=useRef<Article[]>([]);
  const generationRef=useRef(0);
  const toastTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const today=new Intl.DateTimeFormat("zh-CN",{timeZone:"Asia/Shanghai",month:"long",day:"numeric",weekday:"long"}).format(new Date());
  const notify=(text:string)=>{
    setToast(text);
    if(toastTimer.current)clearTimeout(toastTimer.current);
    toastTimer.current=setTimeout(()=>setToast(""),4200);
  };
  useEffect(()=>{
    Promise.allSettled([api("feed"),api("state")]).then(results=>{
      if(results[0].status==="fulfilled")setArticles(results[0].value.articles);
      else notify("本次刷新未完成，先为你展示已整理的精选内容。");
      if(results[1].status==="fulfilled")setUser(results[1].value);
    });
    if("serviceWorker" in navigator)navigator.serviceWorker.register("/sw.js").catch(()=>{});
    const loadVoices=()=>setVoices("speechSynthesis" in window?window.speechSynthesis.getVoices():[]);
    loadVoices();
    if("speechSynthesis" in window)window.speechSynthesis.addEventListener("voiceschanged",loadVoices);
    const beforeInstall=(e:Event)=>{e.preventDefault();setInstallPrompt(e);};
    window.addEventListener("beforeinstallprompt",beforeInstall);
    return ()=>{
      if("speechSynthesis" in window)window.speechSynthesis.removeEventListener("voiceschanged",loadVoices);
      window.removeEventListener("beforeinstallprompt",beforeInstall);
      if(toastTimer.current)clearTimeout(toastTimer.current);
    };
  },[]);
  useEffect(()=>{
    if(reader&&!dialogRef.current?.open)dialogRef.current?.showModal();
    if(!reader&&dialogRef.current?.open)dialogRef.current.close();
  },[reader]);
  useEffect(()=>{
    if((configModal||helpOpen||installHelp)&&!infoRef.current?.open)infoRef.current?.showModal();
    if(!configModal&&!helpOpen&&!installHelp&&infoRef.current?.open)infoRef.current.close();
  },[configModal,helpOpen,installHelp]);
  const filtered=useMemo(()=>articles.filter(a=>
    (category==="全部"||a.category===category)&&
    (!hideRead||!user.read.includes(a.id))&&
    (!localQuery||[a.title,a.summary,...a.topics].join(" ").toLowerCase().includes(localQuery.toLowerCase()))&&
    (view!=="saved"||user.saved.includes(a.id))
  ),[articles,category,hideRead,user.read,user.saved,localQuery,view]);
  const activeTopics=user.topics.length?user.topics:(!user.signedIn?STARTER_TOPICS.map((t,i)=>({...t,id:"preview-"+i,kind:"core" as const,reason:"初始关注",createdAt:"",expiresAt:null})):[]);
  const suggestions=useMemo(()=>topicSuggestions.filter(s=>!user.topics.some(t=>t.name===s.name)).map(s=>{
    const savedMatch=articles.filter(a=>user.saved.includes(a.id)).find(a=>a.topics.some(t=>t.includes(s.anchor)));
    const coreMatch=activeTopics.find(t=>t.name.includes(s.anchor));
    return {...s,score:(savedMatch?3:0)+(coreMatch?1:0),reason:savedMatch?"来自你的收藏 · "+s.anchor:"延伸自 "+s.anchor};
  }).sort((a,b)=>b.score-a.score).slice(0,4),[user.topics,user.saved,articles]);
  const recentCount=articles.filter(a=>a.group==="近期动态").length;
  const sourceCount=new Set(articles.map(a=>new URL(a.url).hostname)).size;
  const changeView=(v:View)=>{setView(v);setCategory("全部");setLocalQuery("");window.scrollTo({top:0,behavior:"smooth"});};
  const ensureLogin=()=>{
    if(user.signedIn)return true;
    window.location.assign("/login");return false;
  };
  async function refresh() {
    setRefreshing(true);
    try{const data=await api("feed");setArticles(data.articles);notify("内容列表已刷新。");}
    catch(e){notify((e as Error).message);}
    finally{setRefreshing(false);}
  }
  function openArticle(a:Article) {
    setReader(a);
    if(user.signedIn&&!user.read.includes(a.id))api("reading",{articleId:a.id,action:"read",value:true}).then(setUser).catch(()=>{});
  }
  async function toggleSaved(a:Article) {
    if(!ensureLogin())return;
    setBusyId(a.id);
    try{
      if(!articles.some(x=>x.id===a.id)) {
        setUser(await api("collect",{article:a}));setArticles(prev=>[a,...prev.filter(x=>x.id!==a.id)]);
        notify("已收录到你的收藏。");
      } else {
        const value=!user.saved.includes(a.id);
        setUser(await api("reading",{articleId:a.id,action:"save",value}));
        notify(value?"已收藏，稍后慢慢读。":"已从收藏移除。");
      }
    }catch(e){notify((e as Error).message);}
    finally{setBusyId(null);}
  }
  async function addTopic(name=topicName, query?:string) {
    if(!ensureLogin()||!name.trim())return;
    setTopicBusy(true);
    try{setUser(await api("topics",{action:"add",name:name.trim(),query}));setTopicName("");notify("已关注 "+name.trim());}
    catch(e){notify((e as Error).message);}
    finally{setTopicBusy(false);}
  }
  async function modifyTopic(topic:Topic,action:"remove"|"promote") {
    try{setUser(await api("topics",{action,id:topic.id}));notify(action==="remove"?"已移除关注。":"已设为长期关注。");}
    catch(e){notify((e as Error).message);}
  }
  async function updatePreference(value:Partial<Preferences>) {
    if(!ensureLogin())return;
    try{setUser(await api("preferences",value));}
    catch(e){notify((e as Error).message);}
  }
  async function runSearch(query=searchQuery, source=searchSource, topic?:string) {
    if(!query.trim()||!ensureLogin())return;
    setView("discover");setSearchQuery(query);setSearchSource(source);setSearching(true);setSearchError("");setSearchResults(null);setResultLabel(topic||query);
    try{
      const result=await api("search",{query:query.trim(),source,explore:!!topic,topic});
      setSearchResults(result.articles);
      if(topic)setUser(await api("state"));
    }catch(e){setSearchError((e as Error).message);}
    finally{setSearching(false);}
  }
  async function interpret(a:Article) {
    if(!ensureLogin())return;
    if(!user.capabilities.llm){setConfigModal("llm");return;}
    setBusyId(a.id);
    try{
      const result=await api("summarize",{article:a});
      setReader(result.article);setArticles(prev=>[result.article,...prev.filter(x=>x.id!==a.id)]);
      setSearchResults(prev=>prev?.map(x=>x.id===a.id?result.article:x)||null);
      notify("中文解读已生成并收录。");
    }catch(e){notify((e as Error).message);}
    finally{setBusyId(null);}
  }
  function stopAudio(clear=true) {
    generationRef.current++;
    if("speechSynthesis" in window)window.speechSynthesis.cancel();
    audioRef.current?.pause();
    audioRef.current=null;utteranceRef.current=null;setPlaying(false);setAudioBusy(false);
    if(clear)setListening(null);
  }
  async function listen(a:Article,queue?:Article[]) {
    stopAudio(false);
    if(queue)queueRef.current=queue;
    const generation=generationRef.current;
    setListening(a);setAudioProgress(0);
    if(user.preferences.audioMode==="cloud"&&user.capabilities.tts) {
      setAudioKind("AI 配音");setAudioBusy(true);
      try{
        const result=await api("audio",{articleId:a.id});
        if(generation!==generationRef.current)return;
        const audio=new Audio("/api/audio/"+result.id);audioRef.current=audio;
        audio.playbackRate=user.preferences.speed;
        audio.ontimeupdate=()=>setAudioProgress(audio.duration?audio.currentTime/audio.duration*100:0);
        audio.onended=()=>{setPlaying(false);setAudioProgress(100);};
        audio.onerror=()=>{setPlaying(false);notify("音频未能播放，请重试。");};
        await audio.play();setPlaying(true);
      }catch(e){if(generation===generationRef.current)notify((e as Error).message);}
      finally{if(generation===generationRef.current)setAudioBusy(false);}
    } else {
      if(!("speechSynthesis" in window)){notify("这个浏览器没有设备朗读功能，请使用支持的浏览器或连接云端配音。");return;}
      setAudioKind("设备朗读");
      const text=speechText(a);
      const utterance=new SpeechSynthesisUtterance(text);
      utterance.lang="zh-CN";utterance.rate=user.preferences.speed;
      const voice=voices.find(v=>v.voiceURI===user.preferences.voiceUri)||voices.find(v=>v.lang.startsWith("zh"));
      if(voice)utterance.voice=voice;
      utterance.onstart=()=>{if(generation===generationRef.current)setPlaying(true);};
      utterance.onboundary=e=>{if(generation===generationRef.current)setAudioProgress(e.charIndex/text.length*100);};
      utterance.onend=()=>{if(generation===generationRef.current){setPlaying(false);setAudioProgress(100);}};
      utterance.onerror=e=>{if(generation===generationRef.current&&e.error!=="canceled"&&e.error!=="interrupted"){setPlaying(false);notify("设备朗读暂不可用，请重试或切换声音。");}};
      utteranceRef.current=utterance;window.speechSynthesis.speak(utterance);
    }
    if("mediaSession" in navigator) {
      navigator.mediaSession.metadata=new MediaMetadata({title:a.title,artist:"研览 · MolBrief",album:"制药与研究精选"});
    }
  }
  function togglePlayback() {
    if(!listening)return;
    if(audioRef.current){if(playing){audioRef.current.pause();setPlaying(false);}else{audioRef.current.play().then(()=>setPlaying(true)).catch(()=>notify("请重新点击播放。"));}return;}
    if(!("speechSynthesis" in window))return;
    if(playing){window.speechSynthesis.pause();setPlaying(false);}
    else if(window.speechSynthesis.paused){window.speechSynthesis.resume();setPlaying(true);}
    else listen(listening);
  }
  function nextAudio(direction=1) {
    const queue=queueRef.current.length?queueRef.current:articles;
    const index=queue.findIndex(a=>a.id===listening?.id);
    const target=queue[index+direction];
    if(target)listen(target,queue);else notify(direction>0?"已经是最后一条。":"已经是第一条。");
  }
  function exportCollection() {
    const collection=articles.filter(a=>user.saved.includes(a.id));
    const blob=new Blob([JSON.stringify({exportedAt:new Date().toISOString(),articles:collection},null,2)],{type:"application/json"});
    const link=document.createElement("a");link.href=URL.createObjectURL(blob);link.download="molbrief-collection.json";link.click();URL.revokeObjectURL(link.href);
  }
  async function install() {
    if(installPrompt){await installPrompt.prompt();setInstallPrompt(null);}
    else setInstallHelp(true);
  }
  const closeInfo=()=>{setConfigModal(null);setHelpOpen(false);setInstallHelp(false);};
  function ArticleCard({article:a,index=0}:{article:Article,index?:number}) {
    const saved=user.saved.includes(a.id);
    return <article className={"article-card"+(user.read.includes(a.id)?" was-read":"")}>
      <div className="article-main">
        <div className="article-meta"><span className={"category-label category-"+a.category}>{categoryNames[a.category]}</span><span className="dot"/><span>{a.source}</span>{a.type==="预印本"&&<span className="preprint">预印本</span>}</div>
        <button className="article-title" onClick={()=>openArticle(a)}><h3>{a.title}</h3></button>
        <p className="article-excerpt">{a.summary}</p>
        <div className="article-bottom"><div className="article-tags">{a.topics.slice(0,2).map(t=><button key={t} onClick={()=>{if(view==="discover")changeView("today");setLocalQuery(t);}}>{t}</button>)}</div>
          <div className="article-tools"><span className="article-date">{formatDate(a.publishedAt)}</span><button className="icon-btn" onClick={()=>listen(a,filtered)} aria-label={"朗读："+a.title}><Headphones size={17}/></button><button className={"icon-btn"+(saved?" saved":"")} disabled={busyId===a.id} onClick={()=>toggleSaved(a)} aria-label={(saved?"取消收藏：":"收藏：")+a.title}>{busyId===a.id?<Loader2 size={17} className="spin"/>:<Bookmark size={17} fill={saved?"currentColor":"none"}/>}</button></div>
        </div>
      </div>
      <button className="article-visual" onClick={()=>openArticle(a)} aria-label={"阅读："+a.title}><TopicArt kind={a.category}/></button>
    </article>;
  }
  return <div className={"app-shell"+(listening?" has-player":"")}>
    <aside className="sidebar">
      <button className="brand-button" onClick={()=>changeView("today")} aria-label="回到今日精选"><Brand/></button>
      <div className="workspace-label">我的阅读空间</div>
      <nav className="desktop-nav" aria-label="主导航">{navItems.map(({view:v,label,icon:Icon})=><button key={v} className={view===v?"active":""} onClick={()=>changeView(v)}><Icon size={19}/><span>{label}</span>{v==="saved"&&user.saved.length>0&&<small>{user.saved.length}</small>}</button>)}</nav>
      <div className="sidebar-divider"/>
      <div className="section-eyebrow">正在关注<button className="mini-icon" onClick={()=>changeView("topics")} aria-label="管理关注主题"><Plus size={15}/></button></div>
      <div className="sidebar-topics">{activeTopics.slice(0,5).map(t=><button key={t.id} onClick={()=>{changeView("today");setLocalQuery(t.name);}}><span className={"topic-dot "+(t.kind==="explore"?"explore":"")}/>{t.name}</button>)}</div>
      <button className="manage-topics" onClick={()=>changeView("topics")}>管理关注主题 <ArrowUpRight size={14}/></button>
      <div className="sidebar-bottom">
        <button className="install-card" onClick={install}><div className="install-icon"><ArrowDownToLine size={18}/></div><div><strong>把研览放进口袋</strong><span>添加到手机主屏幕</span></div><ChevronRight size={15}/></button>
        <button className={"settings-nav "+(view==="settings"?"active":"")} onClick={()=>changeView("settings")}><Settings2 size={18}/>偏好与连接</button>
        <form action="/api/session" method="post" className="signout-form"><input type="hidden" name="action" value="logout"/><button type="submit" className="quiet-btn">退出登录</button></form>
        <button className="profile" onClick={()=>user.signedIn?changeView("settings"):setConfigModal("login")}><div className="avatar">{user.signedIn?user.displayName.slice(0,1).toUpperCase():"M"}</div><div><strong>{user.signedIn?"我的账号":"登录研览"}</strong><span>{user.signedIn?"个人阅读空间":"同步收藏与关注"}</span></div><ChevronDown size={14}/></button>
      </div>
    </aside>
    <div className="main-shell">
      <header className="topbar">
        <div className="mobile-brand"><Brand small/></div>
        <div className="breadcrumb">我的阅读空间 <ChevronRight size={13}/> <span>{view==="today"?"今日精选":view==="discover"?"探索发现":view==="saved"?"我的收藏":view==="topics"?"关注主题":"偏好与连接"}</span></div>
        <div className="topbar-actions"><label className="quick-search"><Search size={17}/><input aria-label="搜索已收录内容" value={localQuery} onChange={e=>{setLocalQuery(e.target.value);if(view!=="today"&&view!=="saved")setView("today");}} placeholder="搜索已收录内容"/>{localQuery&&<button onClick={()=>setLocalQuery("")} aria-label="清除搜索"><X size={14}/></button>}</label><button className="icon-btn help-button" onClick={()=>setHelpOpen(true)} aria-label="了解研览"><CircleHelp size={19}/></button><div className="topbar-avatar">{user.displayName.slice(0,1).toUpperCase()}</div></div>
      </header>
      <main className="workspace">
        {view==="today"&&<>
          <div className="page-heading"><div><div className="date-label"><span className="status-dot"/>{today}</div><h1>今天，读一点新进展<span>。</span></h1><p>从产业动态到研究前沿，为你的下一步积累线索。</p></div><button className="secondary-btn refresh-btn" onClick={refresh} disabled={refreshing}><RefreshCw size={15} className={refreshing?"spin":""}/>{refreshing?"正在刷新":"刷新内容"}</button></div>
          <section className="briefing-banner">
            <div className="briefing-copy"><div className="banner-kicker"><AudioLines size={15}/> YOUR PERSONAL BRIEFING</div><h2>换一种方式，听见新知。</h2><p>{articles.length} 篇精选 · 药企、研究与 AI 制药<br className="mobile-break"/> · 每条都能回到原文</p><button onClick={()=>articles[0]&&listen(articles[0],articles)} className="listen-btn"><Play size={14} fill="currentColor"/>听一条精选<ArrowRight size={16}/></button><span className="audio-disclosure">{user.capabilities.tts&&user.preferences.audioMode==="cloud"?"AI 配音 · 使用已连接音色":"设备朗读 · 声音随浏览器而异"}</span></div>
            <div className="banner-art" aria-hidden="true"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="orbit-dot"/><div className="audio-disc"><Headphones size={40} strokeWidth={1.2}/></div><div className="waveform">{[9,18,28,13,36,47,24,56,36,64,39,22,43,29,18,34,13,8].map((h,i)=><i key={i} style={{height:h}}/>)}</div><div className="banner-caption">LESS NOISE. MORE INSIGHT.</div></div>
          </section>
          <div className="content-columns"><section className="feed-column">
            <div className="feed-heading"><h2>为你精选 <span>{filtered.length}</span></h2><button className={"quiet-btn "+(hideRead?"selected":"")} onClick={()=>setHideRead(!hideRead)}><SlidersHorizontal size={14}/>{hideRead?"已隐藏已读":"显示全部"}</button></div>
            <div className="category-tabs" role="group" aria-label="内容分类">{categories.map(c=><button key={c} onClick={()=>setCategory(c)} className={category===c?"active":""}>{categoryNames[c]}</button>)}</div>
            {localQuery&&<div className="filter-notice">正在查看“{localQuery}”<button onClick={()=>setLocalQuery("")}>清除 <X size={13}/></button></div>}
            <div className="article-list">{filtered.map((a,i)=><ArticleCard key={a.id} article={a} index={i}/>)}</div>
            {!filtered.length&&<div className="empty-state"><Search size={30}/><h3>这里还没有匹配的内容</h3><p>换一个关键词，或到探索页寻找新的研究。</p><button className="primary-btn" onClick={()=>changeView("discover")}>去探索 <ArrowRight size={15}/></button></div>}
            {!!filtered.length&&<div className="feed-end"><Leaf size={15}/><span>本次精选到这里。留一点时间，想一想。</span></div>}
          </section>
          <aside className="insight-column">
            <section className="insight-panel"><div className="panel-title"><Compass size={18}/><h2>视野之外</h2><span className="tiny-pill">探索</span></div><p className="panel-intro">沿着你的关注，向外多看一步。</p>{suggestions.slice(0,3).map((s,i)=><button className="suggestion-row" key={s.name} onClick={()=>runSearch(s.query,"pubmed",s.name)}><span className="suggestion-number">0{i+1}</span><div><strong>{s.name}</strong><small>{s.reason}</small></div><ArrowUpRight size={15}/></button>)}<button className="text-link" onClick={()=>changeView("discover")}>发现更多线索 <ArrowRight size={14}/></button></section>
            <section className="source-panel"><div className="panel-title"><ShieldCheck size={18}/><h2>每一条，都有来处</h2></div><p>公告、论文与工具资料分别标注。查看摘要，也随时查看依据。</p><div className="source-stats"><div><strong>{sourceCount}</strong><span>来源站点</span></div><div><strong>{recentCount}</strong><span>近期动态</span></div><div><strong>{articles.length-recentCount}</strong><span>延伸阅读</span></div></div><div className="source-footnote"><Check size={13}/>保留原始发表日期与阅读范围</div></section>
            <div className="side-note"><span>READ. CONNECT. DISCOVER.</span><p>好信息，值得慢慢读。</p><div className="mini-brand">研览 <b>MolBrief</b></div></div>
          </aside></div>
        </>}
        {view==="discover"&&<>
          <div className="page-heading"><div><div className="date-label"><Compass size={15}/> FOLLOW YOUR CURIOSITY</div><h1>发现下一条线索<span>。</span></h1><p>搜索一个问题，或从熟悉的主题向外走一步。</p></div></div>
          <section className="discovery-search-panel"><div className="search-source-tabs"><button className={searchSource==="pubmed"?"active":""} onClick={()=>setSearchSource("pubmed")}><Microscope size={16}/>PubMed 论文</button><button className={searchSource==="web"?"active":""} onClick={()=>setSearchSource("web")}><Network size={16}/>全网发现{!user.capabilities.parallel&&<span>待连接</span>}</button></div><form className="discovery-search" onSubmit={e=>{e.preventDefault();runSearch();}}><Search size={21}/><input value={searchQuery} onChange={e=>setSearchQuery(e.target.value)} placeholder={searchSource==="pubmed"?"输入英文关键词，例如 nanobody delivery":"输入药企、药物或你想了解的问题"} aria-label="联网检索关键词"/><button className="primary-btn" disabled={searching||!searchQuery.trim()}>{searching?<Loader2 className="spin" size={17}/>:<ArrowRight size={17}/>}<span>{searching?"检索中":"开始探索"}</span></button></form><p>论文搜索返回原始题录与摘要；中文解读将在模型连接后提供。</p></section>
          {!searchResults&&!searching&&!searchError&&<><div className="section-heading"><h2>你可能还想了解</h2><span>适度拓展，保持相关</span></div><div className="discovery-grid">{suggestions.map((s,i)=><button className="discovery-card" key={s.name} onClick={()=>runSearch(s.query,"pubmed",s.name)}><div className={"discovery-symbol symbol-"+i}>{i%2?<Network size={28} strokeWidth={1.4}/>:<FlaskConical size={28} strokeWidth={1.4}/>}</div><span className="reason-label">{s.reason}</span><h3>{s.name}</h3><p>{s.description}</p><span className="discovery-cta">查找相关论文 <ArrowUpRight size={17}/></span></button>)}</div><div className="exploration-note"><Sparkles size={17}/><p>找到相关资料后，可自动将新方向加入 14 天探索列表。你可以随时保留或移除。</p><button onClick={()=>changeView("topics")}>管理主题 <ArrowRight size={14}/></button></div></>}
          {searching&&<div className="search-loading"><Loader2 size={29} className="spin"/><h3>正在查找相关来源</h3><p>检索完成后，你可以打开原文、收藏或继续深入。</p></div>}
          {searchError&&<div className="error-panel" role="alert"><CircleHelp size={24}/><h3>这次检索还没完成</h3><p>{searchError}</p><div className="button-row"><button className="secondary-btn" onClick={()=>runSearch()}>重试</button>{searchSource==="web"&&!user.capabilities.parallel&&<button className="primary-btn" onClick={()=>setConfigModal("parallel")}>查看连接方式</button>}</div></div>}
          {searchResults&&<><div className="section-heading"><h2>“{resultLabel}” 的检索结果 <span className="count-pill">{searchResults.length}</span></h2><button className="quiet-btn" onClick={()=>{setSearchResults(null);setSearchQuery("");}}>返回推荐 <ChevronRight size={14}/></button></div><div className="search-result-list">{searchResults.map(a=><ArticleCard key={a.id} article={a}/>)}</div>{!searchResults.length&&<div className="empty-state"><Search size={30}/><h3>暂时没有检索到相关记录</h3><p>试试英文名称、较宽泛的关键词，或调整检索来源。</p></div>}</>}
        </>}
        {view==="saved"&&<>
          <div className="page-heading"><div><div className="date-label"><Bookmark size={15}/> YOUR READING COLLECTION</div><h1>留给以后，也留给思考<span>。</span></h1><p>把值得再次打开的信息，放在一起。</p></div><button className="secondary-btn" disabled={!user.saved.length} onClick={exportCollection}><ArrowDownToLine size={15}/>导出收藏</button></div>
          <div className="saved-summary"><div><BookOpen size={22}/><strong>{user.saved.length}</strong><span>篇已收藏</span></div><p>登录同一账号，在电脑和手机继续阅读。</p></div>
          <div className="category-tabs">{categories.map(c=><button key={c} onClick={()=>setCategory(c)} className={category===c?"active":""}>{categoryNames[c]}</button>)}</div>
          <div className="saved-list">{filtered.map(a=><ArticleCard key={a.id} article={a}/>)}</div>
          {!filtered.length&&<div className="empty-state spacious"><Bookmark size={37} strokeWidth={1.4}/><h3>让值得再看的内容，留在这里</h3><p>点击文章旁的收藏图标，就能随时回来阅读。</p><button className="primary-btn" onClick={()=>changeView("today")}>浏览精选 <ArrowRight size={15}/></button></div>}
        </>}
        {view==="topics"&&<>
          <div className="page-heading"><div><div className="date-label"><Tag size={15}/> YOUR INTERESTS</div><h1>让关注，有自己的方向<span>。</span></h1><p>长期兴趣保持稳定，新发现可以先试着了解。</p></div></div>
          <div className="mobile-settings-switch"><button className="active">关注主题</button><button onClick={()=>changeView("settings")}>偏好与连接</button></div>
          <form className="add-topic-form" onSubmit={e=>{e.preventDefault();addTopic();}}><Plus size={20}/><input value={topicName} onChange={e=>setTopicName(e.target.value)} maxLength={70} placeholder="添加公司、药物、靶点或研究方向" aria-label="新关注主题"/><button className="primary-btn" disabled={!topicName.trim()||topicBusy}>{topicBusy?<Loader2 size={16} className="spin"/>:"添加关注"}</button></form>
          <section className="topics-section"><div className="section-heading"><h2>长期关注 <span className="count-pill">{activeTopics.filter(t=>t.kind==="core").length}</span></h2><span>由你决定，持续保留</span></div><div className="topic-grid">{activeTopics.filter(t=>t.kind==="core").map(t=><div className="topic-card" key={t.id}><div className="topic-card-header"><span className="topic-dot"/><h3>{t.name}</h3><button className="icon-btn" onClick={()=>modifyTopic(t,"remove")} aria-label={"移除 "+t.name}><X size={16}/></button></div><p>{t.reason}</p><button className="text-link" onClick={()=>runSearch(t.query,"pubmed")}>查找相关研究 <ArrowUpRight size={15}/></button></div>)}</div></section>
          <section className="topics-section"><div className="section-heading"><h2>探索中的方向 <span className="count-pill">{activeTopics.filter(t=>t.kind==="explore").length}</span></h2><span>14 天试用 · 最多 10 个</span></div><div className="topic-grid">{activeTopics.filter(t=>t.kind==="explore").map(t=><div className="topic-card exploration" key={t.id}><div className="topic-card-header"><Sparkles size={16}/><h3>{t.name}</h3><button className="icon-btn" onClick={()=>modifyTopic(t,"remove")} aria-label={"移除 "+t.name}><X size={16}/></button></div><p>{t.reason}</p><div className="topic-card-bottom"><small>至 {formatDate(t.expiresAt?.slice(0,10)||null)}</small><button className="text-link" onClick={()=>modifyTopic(t,"promote")}>长期关注 <Plus size={14}/></button></div></div>)}</div>{!activeTopics.some(t=>t.kind==="explore")&&<div className="empty-inline"><Compass size={23}/><p>探索新的方向后，相关主题会出现在这里。</p><button className="text-link" onClick={()=>changeView("discover")}>去探索 <ArrowRight size={14}/></button></div>}</section>
        </>}
        {view==="settings"&&<>
          <div className="page-heading"><div><div className="date-label"><Settings2 size={15}/> MAKE IT YOURS</div><h1>按照你的习惯，慢慢读<span>。</span></h1><p>声音、关注与服务连接，都由你掌握。</p></div></div>
          <div className="mobile-settings-switch"><button onClick={()=>changeView("topics")}>关注主题</button><button className="active">偏好与连接</button></div>
          <div className="settings-layout"><div>
            <section className="settings-panel"><div className="panel-title"><Headphones size={19}/><h2>听读偏好</h2></div><div className="setting-row"><div><strong>朗读方式</strong><p>设备朗读现在可用；AI 配音使用连接的固定音色。</p></div><select value={user.preferences.audioMode} onChange={e=>updatePreference({audioMode:e.target.value as "device"|"cloud"})} aria-label="朗读方式"><option value="device">设备朗读</option><option value="cloud" disabled={!user.capabilities.tts}>AI 配音{!user.capabilities.tts?" · 待连接":""}</option></select></div><div className="setting-row"><div><strong>设备声音</strong><p>可选声音由当前浏览器与系统提供。</p></div><select value={user.preferences.voiceUri} onChange={e=>updatePreference({voiceUri:e.target.value})} aria-label="设备声音"><option value="">自动选择中文声音</option>{voices.filter(v=>v.lang.startsWith("zh")||v.lang.startsWith("en")).slice(0,30).map(v=><option key={v.voiceURI} value={v.voiceURI}>{v.name} · {v.lang}</option>)}</select></div><div className="setting-row"><div><strong>播放速度</strong><p>找到舒服的阅读节奏。</p></div><select value={user.preferences.speed} onChange={e=>updatePreference({speed:Number(e.target.value)})} aria-label="播放速度">{[0.8,1,1.2,1.5,1.8].map(v=><option key={v} value={v}>{v} ×</option>)}</select></div><button className="secondary-btn" onClick={()=>articles[0]&&listen(articles[0],[articles[0]])}><Volume2 size={15}/>试听一条摘要</button></section>
            <section className="settings-panel"><div className="panel-title"><Sparkles size={19}/><h2>探索偏好</h2></div><div className="setting-row"><div><strong>自动试用新主题</strong><p>主动探索找到资料后，添加相关方向，14 天后到期。</p></div><button className={"switch "+(user.preferences.autoExplore?"on":"")} role="switch" aria-checked={user.preferences.autoExplore} aria-label="自动试用新主题" onClick={()=>updatePreference({autoExplore:!user.preferences.autoExplore})}><span/></button></div><div className="setting-row"><div><strong>管理关注主题</strong><p>查看、移除或保留你正在关注的方向。</p></div><button className="icon-btn" onClick={()=>changeView("topics")} aria-label="进入主题管理"><ArrowUpRight size={19}/></button></div></section>
          </div><div>
            <section className="settings-panel"><div className="panel-title"><Network size={19}/><h2>服务连接</h2></div><p className="settings-intro">先阅读，再逐步连接你已有的服务。</p>{[
              {id:"pubmed",name:"PubMed",description:"论文题录与摘要搜索",connected:true},
              {id:"parallel",name:"Parallel",description:"全网发现与公开来源检索",connected:user.capabilities.parallel},
              {id:"llm",name:"摘要模型",description:"兼容 API 的中文解读",connected:user.capabilities.llm},
              {id:"tts",name:"MiniMax 配音",description:"固定音色与音频缓存",connected:user.capabilities.tts},
            ].map(s=><div className="connection-row" key={s.id}><div className={"service-icon "+s.id}>{s.id==="pubmed"?<Microscope size={20}/>:s.id==="parallel"?<Network size={20}/>:s.id==="llm"?<Sparkles size={20}/>:<AudioLines size={20}/>}</div><div><strong>{s.name}</strong><p>{s.description}</p></div><button className={"connection-status "+(s.connected?"connected":"")} onClick={()=>s.id==="pubmed"?runSearch("nanobody","pubmed"):setConfigModal(s.id)}>{s.connected?(s.id==="pubmed"?"可使用":"已配置"):"待连接"}{s.connected?<Check size={12}/>:<ChevronRight size={12}/>}</button></div>)}<p className="settings-footnote"><ShieldCheck size={14}/>密钥保留在服务端，不进入网页代码。</p></section>
            <section className="settings-panel compact"><div className="panel-title"><ArrowDownToLine size={18}/><h2>手机也能随手打开</h2></div><p className="settings-intro">将研览添加到主屏幕，像打开一个日常阅读应用。</p><button className="secondary-btn full" onClick={install}>添加到主屏幕 <ArrowUpRight size={15}/></button></section>
          </div></div>
        </>}
        {view==="settings"&&<form action="/api/session" method="post" className="mobile-signout"><input type="hidden" name="action" value="logout"/><button type="submit" className="secondary-btn">退出登录</button></form>}
        <footer className="workspace-footer"><span>研览 · MolBrief</span><p>读懂进展，发现下一条线索。</p><button onClick={()=>setHelpOpen(true)}>关于研览 <ArrowUpRight size={12}/></button></footer>
      </main>
    </div>
    <nav className="mobile-nav" aria-label="手机导航">{[
      {v:"today" as View,label:"今日",icon:BookOpen},{v:"discover" as View,label:"发现",icon:Compass},{v:"saved" as View,label:"收藏",icon:Bookmark},{v:"topics" as View,label:"我的",icon:Settings2},
    ].map(({v,label,icon:Icon})=><button key={v} className={view===v||(v==="topics"&&view==="settings")?"active":""} onClick={()=>changeView(v)}><Icon size={21}/><span>{label}</span></button>)}</nav>
    {listening&&<section className="audio-player" aria-label="朗读播放器"><div className="player-progress" style={{width:audioProgress+"%"}}/><div className="player-art"><AudioLines size={24}/></div><button className="player-title" onClick={()=>openArticle(listening)}><span>{audioKind}{playing?" · 正在播放":audioBusy?" · 正在生成":" · 已暂停"}</span><strong>{listening.title}</strong></button><div className="player-controls"><button className="icon-btn previous-track" onClick={()=>nextAudio(-1)} aria-label="上一条"><ChevronLeft size={21}/></button><button className="player-play" onClick={togglePlayback} disabled={audioBusy} aria-label={playing?"暂停":"播放"}>{audioBusy?<Loader2 size={19} className="spin"/>:playing?<Pause size={18} fill="currentColor"/>:<Play size={18} fill="currentColor"/>}</button><button className="icon-btn" onClick={()=>nextAudio(1)} aria-label="下一条"><ChevronRight size={21}/></button><span className="player-speed">{user.preferences.speed} ×</span><button className="icon-btn" onClick={()=>stopAudio()} aria-label="关闭播放器"><X size={18}/></button></div></section>}
    <dialog ref={dialogRef} className="reader-dialog" onCancel={()=>setReader(null)} onClick={e=>{if(e.target===e.currentTarget)setReader(null);}}>
      {reader&&<><header className="reader-top"><div className="reader-brand"><img src="/favicon.svg" width="24" height="24" alt=""/>研览<span>阅读</span></div><button className="icon-btn" onClick={()=>setReader(null)} aria-label="关闭阅读"><X size={21}/></button></header><article className="reader-content">
        <div className="article-meta"><span className={"category-label category-"+reader.category}>{categoryNames[reader.category]}</span><span>{reader.type}</span><span className="dot"/><span>{formatDate(reader.publishedAt)}</span></div>
        <h1>{reader.title}</h1>{reader.originalTitle&&reader.originalTitle!==reader.title&&<p className="original-title">{reader.originalTitle}</p>}
        <div className="reader-source"><div><ShieldCheck size={15}/>{reader.source}</div><span>{readMinutes(reader)} 分钟阅读</span></div>
        <div className="reader-actions"><button className="primary-btn" disabled={audioBusy&&listening?.id===reader.id} onClick={()=>listening?.id===reader.id?togglePlayback():listen(reader,articles)}>{listening?.id===reader.id&&playing?<Pause size={16}/>:<Headphones size={16}/>} {listening?.id===reader.id?(audioBusy?"正在生成":playing?"暂停朗读":audioProgress>=100?"重新收听":"继续朗读"):"收听摘要"}</button><button className="secondary-btn" disabled={busyId===reader.id} onClick={()=>toggleSaved(reader)}><Bookmark size={16} fill={user.saved.includes(reader.id)?"currentColor":"none"}/>{user.saved.includes(reader.id)?"已收藏":"收藏"}</button><a className="secondary-btn" href={reader.url} target="_blank" rel="noopener noreferrer">打开原文 <ExternalLink size={14}/></a></div>
        <div className="reading-basis"><FileText size={15}/><span>阅读依据：{reader.readingBasis}</span></div>
        <section className="reader-section"><h2>内容摘要</h2><p className="reader-summary">{reader.summary}</p></section>
        {!!reader.keyPoints.length&&<section className="reader-section"><h2>值得关注</h2><ul className="key-points">{reader.keyPoints.map((p,i)=><li key={i}><span>0{i+1}</span><p>{p}</p></li>)}</ul></section>}
        <section className="evidence-note"><div><ShieldCheck size={18}/><h2>证据与局限</h2></div><p>{reader.limitations}</p></section>
        <section className="reader-section"><h2>沿着这篇，继续探索</h2><div className="reader-topic-list">{reader.topics.map(t=><button key={t} onClick={()=>addTopic(t)}><Plus size={13}/>{t}</button>)}</div></section>
        {(reader.group==="检索结果"||reader.readingBasis.includes("PubMed"))&&<button className="secondary-btn full" onClick={()=>interpret(reader)} disabled={busyId===reader.id}>{busyId===reader.id?<Loader2 size={16} className="spin"/>:<Sparkles size={16}/>}生成中文解读{!user.capabilities.llm&&" · 需连接模型"}</button>}
        <a className="original-link" href={reader.url} target="_blank" rel="noopener noreferrer"><div><span>回到原始来源</span><strong>{reader.source}</strong><small>{new URL(reader.url).hostname}</small></div><ArrowUpRight size={24}/></a>
        <p className="reader-disclaimer">摘要帮助你快速了解信息。关键判断，请结合原始材料。</p>
      </article></>}
    </dialog>
    <dialog ref={infoRef} className="info-dialog" onCancel={closeInfo} onClick={e=>{if(e.target===e.currentTarget)closeInfo();}}><button className="icon-btn info-close" onClick={closeInfo} aria-label="关闭"><X size={20}/></button>
      {configModal==="login"?<><Brand/><h2>登录，继续你的阅读空间</h2><p>使用同一账号保存收藏、关注主题和阅读偏好。</p><a className="primary-btn full" href="/login">使用站点账号登录 <ArrowRight size={16}/></a></>:
      installHelp?<><div className="info-symbol"><ArrowDownToLine size={27}/></div><h2>让研览更容易打开</h2><p><strong>iPhone：</strong>在 Safari 打开网站，点击分享按钮，再选择“添加到主屏幕”。</p><p><strong>Android：</strong>在浏览器菜单中选择“安装应用”或“添加到主屏幕”。</p><p className="muted">不同系统与浏览器的入口名称可能略有不同。</p></>:
      helpOpen?<><Brand/><h2>读懂进展，发现下一条线索。</h2><p>研览是你的制药与研究情报站。收录药企动态、研究论文和 AI 工具，帮助你阅读、收藏，也适度拓展兴趣。</p><div className="about-points"><span><CheckCheck size={17}/>真实来源，保留原始日期</span><span><ShieldCheck size={17}/>区分公告、论文与证据范围</span><span><Compass size={17}/>关注可编辑，探索可撤销</span></div><p className="muted">当前为首版。PubMed 搜索、收藏和设备朗读可使用；全网检索、模型解读和固定音色需连接相应服务。</p></>:
      configModal&&<><div className="info-symbol"><Network size={27}/></div><h2>{configModal==="parallel"?"连接 Parallel":configModal==="tts"?"连接 AI 配音":"连接摘要模型"}</h2><p>{configModal==="parallel"?"连接你已有的搜索服务后，即可在探索页检索药企公告、药物进展与其他公开信息。":configModal==="tts"?"连接 MiniMax 并指定一个音色后，可以生成并保存固定音色的摘要音频。现阶段仍可使用设备朗读。":"连接兼容接口的模型后，可将检索材料整理为中文摘要、要点与证据局限。"}</p><div className="config-fields"><span>需要配置的服务端项目</span>{(configModal==="parallel"?["PARALLEL_API_KEY"]:configModal==="tts"?["MINIMAX_API_KEY","MINIMAX_VOICE_ID"]:["LLM_BASE_URL","LLM_API_KEY","LLM_MODEL"]).map(k=><code key={k}>{k}</code>)}</div><p className="muted">在服务器的 .env 中保存服务配置并重启应用后生效。密钥只在服务端使用。</p><button className="primary-btn full" onClick={closeInfo}>知道了</button></>}
    </dialog>
    {toast&&<div className="toast" role="status"><Check size={16}/>{toast}</div>}
  </div>;
}
