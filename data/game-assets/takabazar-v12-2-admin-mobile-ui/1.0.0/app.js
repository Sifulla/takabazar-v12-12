const $=id=>document.getElementById(id);let token=localStorage.getItem("tb_token")||"",adminToken=sessionStorage.getItem("tb_admin_token")||"",me=null,games=[],selectedGame=null,selectedPick=null,moneyMode="deposit",moneyStep=1,siteLimits={},paymentConfig={bkash:{enabled:false,number:""},nagad:{enabled:false,number:""}},payoutAccount={method:"",number:""},homeContent={banners:[],promotions:[]},memberSummary={},bannerIndex=0,bannerTimer=null,logoTaps=[];
let loadingDepth=0,loadingSlowTimer=null,progressTimer=null;
async function fetchJson(url,opt={},admin=false){
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),20000);
  const headers={...(opt.headers||{})};
  if(admin)headers["x-admin-token"]=adminToken;
  else if(token)headers.Authorization=`Bearer ${token}`;
  try{
    const r=await fetch(url,{...opt,headers,signal:controller.signal});
    let d={};try{d=await r.json()}catch{}
    if(!r.ok)throw new Error(d.message||(admin?`Admin request failed (${r.status})`:`Request failed (${r.status})`));
    return d
  }catch(e){
    if(e?.name==="AbortError")throw new Error("নেটওয়ার্ক টাইমআউট হয়েছে। আবার চেষ্টা করুন।");
    if(!navigator.onLine)throw new Error("ইন্টারনেট সংযোগ নেই।");
    throw e
  }finally{clearTimeout(timeout)}
}
async function api(url,opt={}){return fetchJson(url,opt,false)}
async function adminApi(url,opt={}){return fetchJson(url,opt,true)}

function startTopProgress(){
  const p=$("topProgress");if(!p)return;p.classList.add("show","working");clearTimeout(progressTimer);
  progressTimer=setTimeout(()=>p.classList.add("slow"),2500)
}
function finishTopProgress(){
  const p=$("topProgress");if(!p)return;clearTimeout(progressTimer);p.classList.remove("working","slow");p.classList.add("done");
  setTimeout(()=>p.classList.remove("show","done"),320)
}
function showLoading(title="অনুগ্রহ করে অপেক্ষা করুন",text="আপনার অনুরোধ প্রসেস করা হচ্ছে..."){
  loadingDepth++;const el=$("actionLoading");if(!el)return;
  $("loadingTitle").textContent=title;$("loadingText").textContent=text;$("loadingSlow").classList.add("hidden");
  el.classList.add("show");document.body.classList.add("uiBusy");startTopProgress();
  clearTimeout(loadingSlowTimer);loadingSlowTimer=setTimeout(()=>$("loadingSlow")?.classList.remove("hidden"),5000)
}
function hideLoading(force=false){
  loadingDepth=force?0:Math.max(0,loadingDepth-1);if(loadingDepth>0)return;
  clearTimeout(loadingSlowTimer);$("actionLoading")?.classList.remove("show");document.body.classList.remove("uiBusy");finishTopProgress()
}
async function withLoading(title,text,fn){
  showLoading(title,text);
  try{return await fn()}finally{hideLoading()}
}
function showActionResult(type,title,message){
  const icon=$("resultIcon");icon.textContent=type==="success"?"✓":type==="warning"?"!":"×";
  icon.className=`resultIcon ${type}`;$("resultTitle").textContent=title;$("resultMessage").textContent=message;openModal("actionResultModal")
}
function updateNetworkState(){
  const bar=$("networkBar"),txt=$("networkBarText");if(!bar)return;
  if(navigator.onLine){bar.classList.remove("show");txt.textContent="সংযোগ ফিরে এসেছে"}
  else{txt.textContent="ইন্টারনেট সংযোগ নেই";bar.classList.add("show")}
}
window.addEventListener("online",()=>{updateNetworkState();toast("ইন্টারনেট সংযোগ ফিরে এসেছে")});
window.addEventListener("offline",updateNetworkState);

function toast(msg){const t=$("toast");t.textContent=msg;t.classList.add("show");clearTimeout(window.__toast);window.__toast=setTimeout(()=>t.classList.remove("show"),2600)}
function go(id){startTopProgress();$(id)?.scrollIntoView({behavior:"smooth"});setTimeout(finishTopProgress,420)}
function openModal(id){$(id)?.classList.add("show")}
function closeModal(id){$(id)?.classList.remove("show")}
function setWallet(w={}){const a=Number(w.available||0),h=Number(w.held||0),t=Number(w.total??a+h);["balanceTop","heroAvailable","walletAvailable","profileBalance"].forEach(id=>{if($(id))$(id).textContent=a});["heroHeld","walletHeld","profileHeld"].forEach(id=>{if($(id))$(id).textContent=h});if($("walletTotal"))$("walletTotal").textContent=t;if(me)Object.assign(me,{available:a,held:h,total:t})}
function showAuth(mode){const login=mode==="login";$("loginBox").classList.toggle("hidden",!login);$("registerBox").classList.toggle("hidden",login);$("loginTab").classList.toggle("on",login);$("registerTab").classList.toggle("on",!login)}
function initials(name){return String(name||"TB").split(/\s+/).slice(0,2).map(x=>x[0]||"").join("").toUpperCase()||"TB"}
function openAccount(){renderAccount();openModal("accountModal");if(me)refreshMemberDashboard()}
function renderAccount(){const on=Boolean(me);$("loggedOutBox").classList.toggle("hidden",on);$("loggedInBox").classList.toggle("hidden",!on);$("headerGuest")?.classList.toggle("hidden",on);$("headerMember")?.classList.toggle("hidden",!on);$("accountPageTitle")&&($("accountPageTitle").textContent=on?"My Account":"Account");if(on){$("profileName").textContent=me.name;$("profilePhone").textContent=me.phone;$("profileAvatar").textContent=initials(me.name);setWallet(me);renderMemberSummary()}}
async function register(){
  try{await withLoading("অ্যাকাউন্ট তৈরি হচ্ছে","তথ্য যাচাই করা হচ্ছে...",async()=>{
    const d=await api("/api/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:$("regName").value.trim(),phone:$("regPhone").value.trim(),password:$("regPassword").value})});
    token=d.token;localStorage.setItem("tb_token",token);me=d.user;payoutAccount=d.payout||payoutAccount;setWallet(me);renderAccount();closeModal("accountModal");await refreshPrivate()
  });showActionResult("success","অ্যাকাউন্ট তৈরি হয়েছে","আপনার TakaBazar account প্রস্তুত।")}
  catch(e){showActionResult("error","অ্যাকাউন্ট তৈরি হয়নি",e.message)}
}
async function login(){
  try{await withLoading("লগইন হচ্ছে","আপনার account যাচাই করা হচ্ছে...",async()=>{
    const d=await api("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({phone:$("loginPhone").value.trim(),password:$("loginPassword").value})});
    token=d.token;localStorage.setItem("tb_token",token);me=d.user;setWallet(me);renderAccount();closeModal("accountModal");await refreshPrivate()
  });toast("Login successful")}
  catch(e){showActionResult("error","লগইন ব্যর্থ",e.message)}
}
function askLogout(){openModal("logoutModal")}
async function confirmLogout(){closeModal("logoutModal");await logout()}
async function logout(){try{await api("/api/logout",{method:"POST"})}catch{}token="";me=null;memberSummary={};payoutAccount={method:"",number:""};localStorage.removeItem("tb_token");setWallet({available:0,held:0,total:0});renderAccount();["ledgerList","betList","paymentList","notificationList","ticketList"].forEach(id=>{if($(id))$(id).innerHTML='<p class="muted">Login to view this section.</p>'});toast("Logged out");openAccount()}
async function loadMe(){if(!token){me=null;setWallet({});return}try{const d=await api("/api/me");me=d.user;payoutAccount=d.payout||payoutAccount;setWallet(me)}catch{token="";me=null;localStorage.removeItem("tb_token");setWallet({})}}
async function loadConfig(){try{const d=await api("/api/config");siteLimits=d.limits||{};paymentConfig=d.payment||paymentConfig}catch{}}
function bannerAction(target){if(["games","wallet","promotions","notifications","support"].includes(String(target||"")))go(target)}
function renderBanner(){const list=homeContent.banners||[],stage=$("bannerStage"),dots=$("bannerDots");if(!stage||!list.length)return;bannerIndex=((bannerIndex%list.length)+list.length)%list.length;const b=list[bannerIndex];stage.style.backgroundImage=b.image_url?`linear-gradient(90deg,rgba(1,28,31,.88),rgba(3,67,67,.38)),url("${esc(b.image_url)}")`:"";stage.innerHTML=`<div class="promoCopy"><span class="promoBadge">TAKABAZAR</span><h1>${esc(b.title)}</h1><p>${esc(b.subtitle||"")}</p><button onclick="bannerAction('${esc(b.cta_target||"games")}')">${esc(b.cta_text||"এখন খেলুন")}</button></div><div class="promoArt"><div class="jackpot">TB<br><small>PLAY</small></div></div>`;dots.innerHTML=list.map((_,i)=>`<button class="${i===bannerIndex?"on":""}" onclick="showBanner(${i})"></button>`).join("")}
function showBanner(i){bannerIndex=i;renderBanner();restartBannerTimer()}
function restartBannerTimer(){clearInterval(bannerTimer);if((homeContent.banners||[]).length>1)bannerTimer=setInterval(()=>{bannerIndex++;renderBanner()},4500)}
function renderPromotions(){const el=$("promotionGrid"),list=homeContent.promotions||[];if(!el)return;el.innerHTML=list.length?list.map(p=>`<div class="promoStrip"><div><span>${esc(p.badge||"🎁")}</span><b>${esc(p.title)}</b><small>${esc(p.subtitle||"")}</small></div><button onclick="openAccount()">দেখুন</button></div>`).join(""):'<div class="panel muted">No active promotions.</div>'}
async function loadHomeContent(){try{const d=await api("/api/content/home");homeContent={banners:d.banners||[],promotions:d.promotions||[]};renderBanner();renderPromotions();restartBannerTimer()}catch{}}
async function loadPayoutAccount(){if(!me)return;try{const d=await api("/api/account/payout");payoutAccount=d.payout||{method:"",number:""}}catch{}}
function renderGameSkeletons(){
  const el=$("gameGrid");if(!el)return;
  el.innerHTML=Array.from({length:8},()=>`<article class="gameCard gameSkeleton"><div class="skeletonBlock"></div><span></span><small></small></article>`).join("")
}
async function loadGames(){try{renderGameSkeletons();const d=await api("/api/games");games=d.games||[];renderGames()}catch(e){$("gameGrid").innerHTML='<div class="panel muted">Games load করা যায়নি। Refresh করুন।</div>';toast(e.message)}}
function renderGames(){
  $("gameGrid").innerHTML=games.length?games.map(g=>{
    const media=g.thumbnail?`<img class="gameThumb" src="${esc(g.thumbnail)}" alt="${esc(g.name)}" loading="lazy">`:`<div class="gameIcon">${g.icon||'🎮'}</div>`;
    return `<article class="gameCard ${g.maintenance||!g.enabled?'off':''}" data-category="${esc(g.category||'arcade').toLowerCase()}" ${g.maintenance||!g.enabled?'':`onclick="openGame('${g.slug}')"`}>
      ${media}<h3>${esc(g.name)}</h3><p>${g.maintenance?'Under maintenance':esc(g.description||'Central-wallet game')}</p>
      <div class="gameMeta"><span class="chip">${esc(g.category)}</span><span class="chip">Min ${g.min_bet}</span><span class="chip">Max ${g.max_bet}</span><span class="chip">v${esc(g.version)}</span></div>
      <button class="primary" ${g.maintenance||!g.enabled?'disabled':''} onclick="event.stopPropagation();openGame('${g.slug}')">${g.maintenance?'Maintenance':'Play'}</button>
    </article>`
  }).join(""):'<div class="panel muted">No games available.</div>'
}
function enginePickUI(g){if(g.engine==="coin")return `<div class="pickGrid"><button id="pick_heads" onclick="pick('heads')">Heads</button><button id="pick_tails" onclick="pick('tails')">Tails</button></div>`;if(g.engine==="dice")return `<div class="pickGrid six">${[1,2,3,4,5,6].map(n=>`<button id="pick_${n}" onclick="pick(${n})">${n}</button>`).join("")}</div>`;const choices=g.config?.choices?.length?g.config.choices:[{key:'red',label:'Red'},{key:'blue',label:'Blue'},{key:'gold',label:'Gold'}];return `<div class="pickGrid">${choices.map(c=>`<button id="pick_${c.key}" onclick="pick('${c.key}')">${esc(c.label||c.key)}</button>`).join("")}</div>`}

function closeGameViewer(){document.body.classList.remove("gameViewerOpen");closeModal("gameModal")}
function openGameViewer(){document.body.classList.add("gameViewerOpen");openModal("gameModal")}
function universalFrame(){return $("universalGameFrame")}
function platformMessage(frame,payload){
  try{frame?.contentWindow?.postMessage({source:"TAKABAZAR_PLATFORM",...payload},"*")}catch{}
}
function universalInitPayload(){
  return {
    game:selectedGame?{
      slug:selectedGame.slug,name:selectedGame.name,version:selectedGame.version,
      minBet:selectedGame.min_bet,maxBet:selectedGame.max_bet,engine:selectedGame.engine
    }:null,
    wallet:me?{available:Number(me.available||0),held:Number(me.held||0),total:Number(me.total||0)}:{available:0,held:0,total:0},
    currency:"CREDITS",
    bridgeVersion:1
  }
}
window.addEventListener("message",async event=>{
  const msg=event.data,frame=universalFrame();
  if(!msg||msg.source!=="TAKABAZAR_GAME"||msg.kind!=="REQUEST"||!frame||event.source!==frame.contentWindow||!selectedGame||selectedGame.package_type!=="universal")return;
  const respond=(ok,payload,error)=>platformMessage(frame,{kind:"RESPONSE",id:msg.id,ok,payload,error});
  try{
    if(msg.type==="READY"){
      platformMessage(frame,{kind:"INIT",payload:universalInitPayload()});
      return respond(true,universalInitPayload())
    }
    if(msg.type==="GET_BALANCE"){
      const d=await api("/api/wallet");setWallet(d.wallet);renderAccount();
      const wallet={available:Number(d.wallet.available||0),held:Number(d.wallet.held||0),total:Number(d.wallet.total||0)};
      platformMessage(frame,{kind:"EVENT",type:"balance",payload:wallet});return respond(true,wallet)
    }
    if(msg.type==="BET"){
      const stake=Number(msg.payload?.stake),guess=msg.payload?.guess;
      const d=await withLoading("Bet processing","Server ফলাফল যাচাই করছে...",()=>api(`/api/bet/${selectedGame.slug}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({stake,guess})}));
      setWallet(d.wallet);renderAccount();
      const payload={betId:d.betId,stake:d.stake,outcome:d.outcome,payout:d.payout,win:Boolean(d.win),wallet:d.wallet,details:d.details};
      platformMessage(frame,{kind:"EVENT",type:"balance",payload:d.wallet});
      await Promise.all([loadTransactions(),loadBets(),loadMemberSummary()]);
      return respond(true,payload)
    }
    if(msg.type==="CRASH_OPEN"){const d=await api(`/api/crash/${selectedGame.slug}/open`,{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});return respond(true,d)}
    if(msg.type==="CRASH_BET"){const d=await api(`/api/crash/${selectedGame.slug}/bet`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(msg.payload||{})});setWallet(d.wallet);renderAccount();platformMessage(frame,{kind:"EVENT",type:"balance",payload:d.wallet});return respond(true,d)}
    if(msg.type==="CRASH_CANCEL"){const d=await api(`/api/crash/${selectedGame.slug}/cancel`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(msg.payload||{})});setWallet(d.wallet);renderAccount();platformMessage(frame,{kind:"EVENT",type:"balance",payload:d.wallet});await Promise.all([loadTransactions(),loadMemberSummary()]);return respond(true,d)}
    if(msg.type==="CRASH_STATUS"){const q=new URLSearchParams({roundId:String(msg.payload?.roundId||"")});const d=await api(`/api/crash/${selectedGame.slug}/status?${q.toString()}`);return respond(true,d)}
    if(msg.type==="CRASH_CASHOUT"){const d=await api(`/api/crash/${selectedGame.slug}/cashout`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(msg.payload||{})});setWallet(d.wallet);renderAccount();platformMessage(frame,{kind:"EVENT",type:"balance",payload:d.wallet});await Promise.all([loadTransactions(),loadBets(),loadMemberSummary()]);return respond(true,d)}
    if(msg.type==="CLOSE"){closeGameViewer();return respond(true,{closed:true})}
    if(msg.type==="TOAST"){toast(String(msg.payload?.message||"").slice(0,120));return respond(true,{shown:true})}
    return respond(false,null,"Unsupported SDK request")
  }catch(e){respond(false,null,e.message||"Request failed")}
});

function openGame(slug){
  if(!me)return openAccount();
  showLoading("গেম প্রস্তুত হচ্ছে","গেম এবং ওয়ালেট তথ্য লোড হচ্ছে...");
  setTimeout(()=>{
    try{
      selectedGame=games.find(g=>g.slug===slug);selectedPick=null;if(!selectedGame)return;
      if(["universal","auto"].includes(selectedGame.package_type)&&selectedGame.ui_entry){
        $("gameBody").innerHTML=`<div class="universalGameShell fullscreenGameShell"><iframe id="universalGameFrame" title="${esc(selectedGame.name)}" src="${esc(selectedGame.ui_entry)}" sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe></div>`;
        openGameViewer();
        const frame=universalFrame();
        frame?.addEventListener("load",()=>platformMessage(frame,{kind:"INIT",payload:universalInitPayload()}),{once:true});
        return
      }
      const hero=selectedGame.thumbnail?`<img class="gameHeroThumb" src="${esc(selectedGame.thumbnail)}" alt="${esc(selectedGame.name)}">`:`<div class="big">${selectedGame.icon||'🎮'}</div>`;
      $("gameBody").innerHTML=`<div class="gamePlay"><span class="eyebrow">${esc(selectedGame.category).toUpperCase()}</span><h2>${esc(selectedGame.name)}</h2>${hero}<p class="gameDescription">${esc(selectedGame.description||'')}</p>${enginePickUI(selectedGame)}<label>Bet amount (${selectedGame.min_bet}-${selectedGame.max_bet})</label><input id="stake" type="number" min="${selectedGame.min_bet}" max="${selectedGame.max_bet}" value="${selectedGame.min_bet}"><div id="gameResult" class="resultBox muted">Choose your prediction and place a bet.</div><button class="primary wide" onclick="placeBet()">Place Bet</button></div>`;
      openGameViewer()
    }finally{hideLoading(true)}
  },320)
}
function pick(v){selectedPick=v;document.querySelectorAll(".pickGrid button").forEach(b=>b.classList.remove("on"));$("pick_"+v)?.classList.add("on")}
async function placeBet(){
  if(selectedPick===null)return toast("Choose your prediction");
  try{await withLoading("Bet processing","ফলাফল তৈরি হচ্ছে...",async()=>{
    const d=await api(`/api/bet/${selectedGame.slug}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({stake:Number($("stake").value),guess:selectedPick})});
    setWallet(d.wallet);const box=$("gameResult");box.className=`resultBox ${d.win?'win':'lose'}`;
    box.innerHTML=d.win?`WIN 🎉 Outcome: <b>${esc(d.outcome)}</b> • Payout ${d.payout}`:`No win • Outcome: <b>${esc(d.outcome)}</b>`;
    await Promise.all([loadTransactions(),loadBets(),loadMemberSummary()])
  })}catch(e){showActionResult("error","Bet failed",e.message)}
}

function renderMemberSummary(){
  if(!me)return;const s=memberSummary||{};
  if($("profileVip"))$("profileVip").textContent=`VIP ${s.level||1}`;
  if($("profileInvite"))$("profileInvite").textContent=s.inviteCode||`TB${String(me.id||0).padStart(6,"0")}`;
  if($("summaryBets"))$("summaryBets").textContent=Number(s.bets||0).toLocaleString();
  if($("summaryWagered"))$("summaryWagered").textContent=Number(s.wagered||0).toLocaleString();
  if($("summaryDeposits"))$("summaryDeposits").textContent=Number(s.approvedDeposits||0).toLocaleString();
  if($("summaryWithdrawals"))$("summaryWithdrawals").textContent=Number(s.approvedWithdrawals||0).toLocaleString();
  if($("memberUnread"))$("memberUnread").textContent=Number(s.unread||0);
  if($("memberTickets"))$("memberTickets").textContent=Number(s.openTickets||0);
}
async function loadMemberSummary(){if(!me)return;try{const d=await api("/api/member/summary");memberSummary=d.summary||{};renderMemberSummary()}catch{}}
async function refreshMemberDashboard(){if(!me)return;try{await withLoading("Account refresh হচ্ছে","সর্বশেষ balance ও তথ্য নেওয়া হচ্ছে...",async()=>{await Promise.all([loadWallet(),loadMemberSummary(),loadPayoutAccount(),loadNotifications()]);renderAccount()})}catch(e){toast(e.message)}}
function copyInviteCode(){const code=memberSummary.inviteCode||"";if(!code)return;navigator.clipboard?.writeText(code).then(()=>toast("Invite code copied")).catch(()=>toast(code))}
function showMemberInfo(type){
  const s=memberSummary||{};let body="";
  if(type==="vip")body=`<div class="memberInfoIcon">♛</div><h3>VIP ${s.level||1}</h3><p>Total wagered: <b>${Number(s.wagered||0).toLocaleString()}</b></p><div class="vipProgress"><span style="width:${Math.min(100,Number(s.level||1)*20)}%"></span></div><small>VIP level automatically increases with account activity.</small>`;
  else body=`<div class="memberInfoIcon">♣</div><h3>Invite Center</h3><p>Your invite code</p><div class="inviteCode">${esc(s.inviteCode||"")}</div><button class="authPrimary" onclick="copyInviteCode()">Copy Code</button><small>Referral rewards are not enabled in this build.</small>`;
  $("memberInfoBody").innerHTML=body;openModal("memberInfoModal")
}
function openSecurityCenter(){closeModal("accountModal");$("currentPassword").value="";$("newPassword").value="";$("confirmPassword").value="";openModal("securityModal")}
async function changePassword(){
  const currentPassword=$("currentPassword").value,newPassword=$("newPassword").value,confirm=$("confirmPassword").value;
  if(newPassword!==confirm)return toast("New passwords do not match");
  try{await withLoading("Security update","Password পরিবর্তন করা হচ্ছে...",async()=>{
    await api("/api/account/password",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({currentPassword,newPassword})})
  });closeModal("securityModal");showActionResult("success","Password changed","আপনার password সফলভাবে পরিবর্তন হয়েছে।")}
  catch(e){showActionResult("error","Password change failed",e.message)}
}
function providerLabel(method){return method==="nagad"?"Nagad":"bKash"}
function renderPaymentMethods(){
  for(const method of ["bkash","nagad"]){
    const p=paymentConfig[method]||{},btn=$(method+"MethodBtn");
    if(!btn)continue;
    const available=Boolean(p.enabled&&/^01\d{9}$/.test(p.number||""));
    btn.classList.toggle("unavailable",!available);
    btn.querySelector("small").textContent=available?"Send Money":"Unavailable";
  }
  const current=window.__moneyMethod||"bkash";
  const cur=paymentConfig[current]||{};
  if(!(cur.enabled&&/^01\d{9}$/.test(cur.number||""))){
    const next=["bkash","nagad"].find(m=>paymentConfig[m]?.enabled&&/^01\d{9}$/.test(paymentConfig[m]?.number||""));
    if(next){
      window.__moneyMethod=next;
      document.querySelectorAll(".paymentMethodBtn").forEach(x=>x.classList.remove("selected"));
      $(next+"MethodBtn")?.classList.add("selected");
    }
  }
}
function selectDepositMethod(btn,method){
  const p=paymentConfig[method]||{};
  if(!p.enabled||!/^01\d{9}$/.test(p.number||""))return toast(`${providerLabel(method)} is not configured`);
  document.querySelectorAll(".paymentMethodBtn").forEach(x=>x.classList.remove("selected"));
  btn.classList.add("selected");window.__moneyMethod=method;
  $("bkashAvailability").innerHTML=`<span class="okDot"></span> ${providerLabel(method)} Send Money available`;
}
function openMoney(mode){
  if(!me)return openAccount();
  moneyMode=mode;moneyStep=1;window.__moneyMethod="bkash";
  const dep=mode==="deposit",min=dep?siteLimits.minDeposit:siteLimits.minWithdraw,max=dep?siteLimits.maxDeposit:siteLimits.maxWithdraw;
  $("moneyTitle").textContent=dep?"জমা দিন":"উত্তোলন";
  $("moneyLimitText").textContent=`Allowed: ${min||0}-${max||0} credits${dep?'':` • Daily limit ${siteLimits.dailyWithdraw||0}`}`;
  $("moneyAmount").value=min||"";$("moneyNote").value="";$("paymentTxId").value="";
  $("moneyStep1").classList.remove("hidden");$("moneyStep2").classList.add("hidden");
  $("depositMethodArea").classList.toggle("hidden",!dep);$("withdrawAccountArea").classList.toggle("hidden",dep);$("bkashAvailability").classList.toggle("hidden",!dep);
  if(!dep){const method=payoutAccount.method||"bkash";window.__withdrawMethod=method;document.querySelectorAll(".withdrawMethodBtn").forEach(x=>x.classList.remove("selected"));$(method==="nagad"?"withdrawNagadBtn":"withdrawBkashBtn")?.classList.add("selected");$("withdrawNumber").value=payoutAccount.number||"";}
  if(dep){
    renderPaymentMethods();
    const method=window.__moneyMethod||"bkash",p=paymentConfig[method]||{};
    $("bkashAvailability").innerHTML=p.enabled&&p.number
      ?`<span class="okDot"></span> ${providerLabel(method)} Send Money available`
      :`<span class="offDot"></span> bKash/Nagad number এখনও Admin Panel থেকে সেট করা হয়নি`;
    $("moneySubmit").textContent="পরবর্তী";
  }else $("moneySubmit").textContent="উত্তোলন অনুরোধ করুন";
  document.querySelectorAll(".amountGrid button").forEach(b=>b.classList.remove("active"));syncMoneyButton();openModal("moneyModal")
}
function moneyBack(){
  if(moneyMode==="deposit"&&moneyStep===2){
    moneyStep=1;$("moneyStep2").classList.add("hidden");$("moneyStep1").classList.remove("hidden");$("moneyTitle").textContent="জমা দিন";$("moneySubmit").textContent="পরবর্তী";syncMoneyButton();return
  }
  closeModal("moneyModal")
}
function setupPaymentStep(method,amount){
  const p=paymentConfig[method]||{},label=providerLabel(method),isNagad=method==="nagad";
  $("paymentBrandName").textContent=`${label} Send Money`;
  $("paymentBrandMark").textContent=isNagad?"N":"b";
  $("paymentBrandMark").className=isNagad?"nagadMark big":"bkashMark big";
  $("paymentNumberLabel").textContent=`${label} Number`;
  $("paymentNumberText").textContent=p.number||"Not set";
  $("instructionMethodName").textContent=label;$("instructionTxMethod").textContent=label;
  $("payAmount").textContent=amount;$("paymentTxId").placeholder=isNagad?"যেমন: 7AB12CD34E":"যেমন: A1B2C3D4E5";
}
function copyPaymentNumber(){
  const method=window.__moneyMethod||"bkash",n=(paymentConfig[method]||{}).number||"";
  if(!n)return toast(`${providerLabel(method)} number is not configured`);
  navigator.clipboard?.writeText(n).then(()=>toast(`${providerLabel(method)} number copied`)).catch(()=>toast(n))
}

function selectWithdrawMethod(btn,method){document.querySelectorAll(".withdrawMethodBtn").forEach(x=>x.classList.remove("selected"));btn?.classList.add("selected");window.__withdrawMethod=method;syncMoneyButton()}
function selectPayoutMethod(btn,method){document.querySelectorAll(".payoutMethodBtn").forEach(x=>x.classList.remove("selected"));btn?.classList.add("selected");window.__payoutMethod=method}
function openPayoutSettings(){closeModal("accountModal");window.__payoutMethod=payoutAccount.method||"bkash";document.querySelectorAll(".payoutMethodBtn").forEach(x=>x.classList.remove("selected"));$(window.__payoutMethod==="nagad"?"payoutNagadBtn":"payoutBkashBtn")?.classList.add("selected");$("payoutNumber").value=payoutAccount.number||"";openModal("payoutModal")}
async function savePayoutSettings(){
  try{await withLoading("Account save হচ্ছে","bKash/Nagad account যাচাই করা হচ্ছে...",async()=>{
    const method=window.__payoutMethod||"bkash",number=$("payoutNumber").value.replace(/\D/g,"");
    const d=await api("/api/account/payout",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({method,number})});
    payoutAccount=d.payout
  });closeModal("payoutModal");showActionResult("success","Account saved","আপনার withdrawal account সংরক্ষণ হয়েছে।")}
  catch(e){showActionResult("error","Save failed",e.message)}
}
async function submitMoney(){
  const amount=Number($("moneyAmount").value),note=$("moneyNote").value.trim();
  if(moneyMode==="deposit"&&moneyStep===1){
    const method=window.__moneyMethod||"bkash",p=paymentConfig[method]||{};
    if(!p.enabled||!/^01\d{9}$/.test(p.number||""))return toast(`${providerLabel(method)} deposit is unavailable`);
    if(amount<Number(siteLimits.minDeposit||0)||amount>Number(siteLimits.maxDeposit||Infinity))return toast(`Amount must be ${siteLimits.minDeposit}-${siteLimits.maxDeposit}`);
    moneyStep=2;$("moneyStep1").classList.add("hidden");$("moneyStep2").classList.remove("hidden");
    $("moneyTitle").textContent=`${providerLabel(method)} পেমেন্ট`;setupPaymentStep(method,amount);$("moneySubmit").textContent="আমি টাকা পাঠিয়েছি";syncMoneyButton();return
  }
  const clientKey=`${moneyMode}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try{
    const body={amount,note,clientKey};
    if(moneyMode==="deposit"){
      const method=window.__moneyMethod||"bkash";
      body.paymentMethod=method;body.paymentRef=$("paymentTxId").value.trim().toUpperCase();
      if(!/^[A-Z0-9]{6,30}$/.test(body.paymentRef))return toast(`সঠিক ${providerLabel(method)} Transaction ID লিখুন`);
    }
    else{body.payoutMethod=window.__withdrawMethod||payoutAccount.method||"";body.payoutNumber=$("withdrawNumber").value.replace(/\D/g,"");if(!["bkash","nagad"].includes(body.payoutMethod))return toast("bKash অথবা Nagad নির্বাচন করুন");if(!/^01\d{9}$/.test(body.payoutNumber))return toast("সঠিক ১১ সংখ্যার উত্তোলন নম্বর লিখুন");}
    const actionName=moneyMode==="deposit"?"Deposit request":"Withdrawal request";
    const d=await withLoading(`${actionName} পাঠানো হচ্ছে`,"অনুগ্রহ করে পেজ বন্ধ করবেন না...",()=>api(moneyMode==="deposit"?"/api/deposits":"/api/withdrawals",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}));
    if(d.wallet)setWallet(d.wallet);if(d.payout)payoutAccount=d.payout;closeModal("moneyModal");moneyStep=1;
    await Promise.all([loadWallet(),loadTransactions(),loadPayments(),loadNotifications(),loadMemberSummary()]);
    showActionResult("success",`${actionName} গ্রহণ করা হয়েছে`,`${d.txId} • Status: ${d.status}`)
  }catch(e){toast(e.message)}
}
async function loadWallet(){if(!me)return;try{const d=await api("/api/wallet");siteLimits=d.limits||siteLimits;setWallet(d.wallet)}catch(e){toast(e.message)}}
async function loadTransactions(){if(!me)return;try{const type=$("txFilter")?.value||"all",d=await api(`/api/transactions?type=${encodeURIComponent(type)}`);$("ledgerList").innerHTML=d.rows.length?d.rows.map(r=>`<div class="row"><b>${esc(r.type)}</b><span class="${r.amount>=0?'pos':'neg'}">${r.amount>0?'+':''}${r.amount}</span><span>Avail ${r.balance_after}<br><small class="muted">Held ${r.held_after}</small></span><span class="muted">${esc(r.ref_id||'')}<br>${new Date(r.created_at).toLocaleString()}</span></div>`).join(""):'<p class="muted">No transactions yet.</p>'}catch(e){toast(e.message)}}
async function loadPayments(){if(!me)return;try{const d=await api("/api/payments"),rows=[...d.deposits.map(x=>({...x,kind:'Deposit'})),...d.withdrawals.map(x=>({...x,kind:'Withdrawal'}))].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));$("paymentList").innerHTML=rows.length?rows.map(x=>`<div class="row"><b>${x.kind}<br><small>${esc(x.tx_id)}</small>${x.payment_method?`<br><small>${esc(x.payment_method)} • ${esc(x.payment_ref||'')}</small>`:''}${x.payout_method?`<br><small>${esc(x.payout_method)} • ${esc(x.payout_number||'')}</small>`:''}</b><span>${x.amount}</span><span class="status">${esc(x.status)}</span><span class="muted">${new Date(x.created_at).toLocaleString()}<br>${esc(x.admin_note||'')}</span></div>`).join(""):'<p class="muted">No requests yet.</p>'}catch(e){toast(e.message)}}
async function loadBets(){if(!me)return;try{const d=await api("/api/bets");$("betList").innerHTML=d.rows.length?d.rows.map(r=>`<div class="row"><b>${esc(r.game_slug)}</b><span>Stake ${r.stake}</span><span class="${r.payout>0?'pos':'neg'}">Payout ${r.payout}</span><span class="muted">${esc(r.outcome)}<br>${new Date(r.created_at).toLocaleString()}</span></div>`).join(""):'<p class="muted">No bets yet.</p>'}catch(e){toast(e.message)}}
async function loadNotifications(){if(!me)return;try{const d=await api("/api/notifications");$("unreadDot").classList.toggle("show",d.unread>0);if($("unreadCount"))$("unreadCount").textContent=d.unread;$("notificationList").innerHTML=d.rows.length?d.rows.map(n=>`<div class="notificationCard ${n.is_read?'read':'unread'}"><div class="notificationIcon">${n.type==='success'?'✓':n.type==='warning'?'!':'i'}</div><div><b>${esc(n.title)}</b><p>${esc(n.message)}</p><small>${new Date(n.created_at).toLocaleString()}</small></div><div class="notificationActions">${n.is_read?'':`<button onclick="readOneNotification(${n.id})">Read</button>`}<button onclick="deleteNotification(${n.id})">×</button></div></div>`).join(""):'<p class="muted">No notifications.</p>'}catch(e){toast(e.message)}}async function markRead(){if(!me)return;try{await api("/api/notifications/read",{method:"POST"});loadNotifications()}catch(e){toast(e.message)}}async function readOneNotification(id){try{await api(`/api/notifications/${id}/read`,{method:"POST"});loadNotifications()}catch(e){toast(e.message)}}async function deleteNotification(id){try{await api(`/api/notifications/${id}`,{method:"DELETE"});loadNotifications()}catch(e){toast(e.message)}}
async function sendSupport(){if(!me)return openAccount();try{await api("/api/support",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({subject:$("supportSubject").value,message:$("supportMessage").value})});$("supportSubject").value="";$("supportMessage").value="";toast("Support ticket created");loadTickets()}catch(e){toast(e.message)}}async function loadTickets(){if(!me)return;try{const d=await api("/api/support");$("ticketList").innerHTML=d.rows.length?d.rows.map(t=>`<div class="row"><b>#${t.id} ${esc(t.subject)}</b><span class="status">${esc(t.status)}</span><span></span><span class="muted">${new Date(t.created_at).toLocaleString()}</span></div>`).join(""):'<p class="muted">No support tickets.</p>'}catch(e){toast(e.message)}}
async function refreshPrivate(){if(!me)return;await Promise.all([loadWallet(),loadTransactions(),loadPayments(),loadBets(),loadNotifications(),loadTickets(),loadPayoutAccount(),loadMemberSummary()])}
function esc(v){return String(v??"").replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}

$("brandBtn").addEventListener("click",()=>{const now=Date.now();logoTaps=logoTaps.filter(x=>now-x<2200);logoTaps.push(now);if(logoTaps.length>=5){logoTaps=[];adminEnter()}});
async function adminEnter(){
  if(adminToken){try{await withLoading("Admin Panel","Dashboard load হচ্ছে...",loadAdmin);return openModal("adminModal")}catch{adminToken="";sessionStorage.removeItem("tb_admin_token")}}
  const pin=prompt("Admin PIN");if(pin===null)return;
  try{
    await withLoading("Admin login","Security যাচাই করা হচ্ছে...",async()=>{
      const r=await fetch("/api/admin/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({pin})}),d=await r.json();
      if(!r.ok)throw new Error(d.message);adminToken=d.token;sessionStorage.setItem("tb_admin_token",adminToken);await loadAdmin()
    });openModal("adminModal")
  }catch(e){showActionResult("error","Admin login failed",e.message)}
}
async function loadAdmin(){const d=await adminApi("/api/admin/dashboard"),s=d.stats;$("adminStats").innerHTML=[["Users",s.users],["Bets",s.bets],["Wagered",s.wagered],["Deposits",s.pendingDeposits],["Withdrawals",s.pendingWithdrawals],["Games",s.games]].map(x=>`<div class="stat"><b>${x[1]}</b><span>${x[0]}</span></div>`).join("");await adminTab("users",document.querySelector(".adminTabs button"))}
async function adminTab(name,btn){document.querySelectorAll(".adminTabs button").forEach(x=>x.classList.remove("on"));btn?.classList.add("on");try{if(name==="users")return adminUsers();if(name==="payments")return adminPayments();if(name==="games")return adminGames();if(name==="content")return adminContent();if(name==="notify")return adminNotifications();if(name==="bets")return adminBets();if(name==="support")return adminSupport();return adminAudit()}catch(e){toast(e.message)}}
async function adminUsers(){const d=await adminApi("/api/admin/users");$("adminContent").innerHTML=d.rows.map(u=>`<div class="adminUser"><div><b>${esc(u.name)}</b><br><span class="muted">${esc(u.phone)}</span></div><div>Avail <b>${u.available_balance}</b><br>Held ${u.held_balance}</div><input id="adj_${u.id}" type="number" placeholder="+/- credits"><button class="mini" onclick="adjustUser(${u.id})">Adjust</button></div>`).join("")}
async function adjustUser(id){const amount=Number($("adj_"+id).value);if(!amount)return toast("Enter adjustment");try{await adminApi(`/api/admin/users/${id}/adjust`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({amount,note:"Admin credit adjustment"})});toast("Balance updated");loadAdmin()}catch(e){toast(e.message)}}
async function adminPayments(){
  const d=await adminApi("/api/admin/payments"),L=d.limits,B=d.payment?.bkash||{},N=d.payment?.nagad||{};
  $("adminContent").innerHTML=`
  <div class="adminBlock">
    <b>Deposit Payment Settings</b>
    <p class="muted">User-এর Deposit screen-এ bKash এবং Nagad Send Money number দেখাবে। এখান থেকে যেকোনো সময় পরিবর্তন/বন্ধ করতে পারবেন।</p>
    <div class="paymentSettingsGrid">
      <div class="providerAdminCard">
        <div class="providerAdminTitle"><span class="bkashMark">b</span><b>bKash</b></div>
        <label>bKash Number<input id="bkashAdminNumber" inputmode="numeric" maxlength="11" placeholder="01XXXXXXXXX" value="${esc(B.number||'')}"></label>
        <label>Status<select id="bkashAdminEnabled"><option value="1" ${B.enabled?'selected':''}>Enabled</option><option value="0" ${!B.enabled?'selected':''}>Disabled</option></select></label>
      </div>
      <div class="providerAdminCard">
        <div class="providerAdminTitle"><span class="nagadMark">N</span><b>Nagad</b></div>
        <label>Nagad Number<input id="nagadAdminNumber" inputmode="numeric" maxlength="11" placeholder="01XXXXXXXXX" value="${esc(N.number||'')}"></label>
        <label>Status<select id="nagadAdminEnabled"><option value="1" ${N.enabled?'selected':''}>Enabled</option><option value="0" ${!N.enabled?'selected':''}>Disabled</option></select></label>
      </div>
    </div>
    <button class="mini wide" onclick="savePaymentSettings()">Save bKash & Nagad</button>
  </div>
  <div class="adminBlock"><b>Wallet Limits</b><div class="adminGrid"><label>Min Deposit<input id="limMinD" value="${L.minDeposit}"></label><label>Max Deposit<input id="limMaxD" value="${L.maxDeposit}"></label><label>Min Withdraw<input id="limMinW" value="${L.minWithdraw}"></label><label>Max Withdraw<input id="limMaxW" value="${L.maxWithdraw}"></label><label>Daily Withdraw<input id="limDailyW" value="${L.dailyWithdraw}"></label><button class="mini" onclick="saveLimits()">Save Limits</button></div></div>
  <div class="adminBlock"><b>Deposit Requests</b>${d.deposits.map(x=>paymentAdminRow(x,'deposit')).join('')||'<p class="muted">No requests</p>'}</div>
  <div class="adminBlock"><b>Withdrawal Requests</b>${d.withdrawals.map(x=>paymentAdminRow(x,'withdrawal')).join('')||'<p class="muted">No requests</p>'}</div>`
}
function paymentAdminRow(x,kind){
  const pending=x.status==='Pending';
  const label=x.payment_method==="nagad"?"Nagad":"bKash";
  const pay=kind==='deposit'&&x.payment_method?`<div class="paymentProof"><b>${esc(label)}</b><br>Send Money: ${esc(x.payment_number||'')}<br>TxID: <strong>${esc(x.payment_ref||'')}</strong></div>`:kind==='withdrawal'&&x.payout_method?`<div class="paymentProof"><b>${esc((x.payout_method||'').toUpperCase())}</b><br>Receive to: <strong>${esc(x.payout_number||'')}</strong></div>`:'';
  return `<div class="adminUser"><div><b>${esc(x.name)}</b><br>${esc(x.phone)}<br><span class="muted">${esc(x.tx_id)}</span>${pay}</div><div>${x.amount}<br><span class="status">${esc(x.status)}</span></div><input id="note_${x.tx_id}" placeholder="Admin note" value="${esc(x.admin_note||'')}"><div class="adminActions">${pending?`<button class="mini" onclick="paymentAction('${kind}','${x.tx_id}','Approved')">Approve</button><button class="danger" onclick="paymentAction('${kind}','${x.tx_id}','Rejected')">Reject</button>`:''}</div></div>`
}
async function paymentAction(kind,id,status){
  try{await withLoading("Admin action processing",`${id} ${status} করা হচ্ছে...`,()=>adminApi(`/api/admin/${kind==='deposit'?'deposits':'withdrawals'}/${id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({status,adminNote:$("note_"+id)?.value||""})}));
    toast(`${id} ${status}`);await Promise.all([adminPayments(),loadAdmin()])
  }catch(e){showActionResult("error","Admin action failed",e.message)}
}
async function savePaymentSettings(){
  try{
    const bkashNumber=$("bkashAdminNumber").value.replace(/\D/g,""),
    nagadNumber=$("nagadAdminNumber").value.replace(/\D/g,""),
    bkashEnabled=$("bkashAdminEnabled").value==="1",
    nagadEnabled=$("nagadAdminEnabled").value==="1";
    const d=await adminApi("/api/admin/settings/payment",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({bkashNumber,bkashEnabled,nagadNumber,nagadEnabled})});
    paymentConfig=d.payment||paymentConfig;toast("bKash & Nagad settings updated");await loadConfig();adminPayments()
  }catch(e){toast(e.message)}
}
async function saveLimits(){try{await adminApi("/api/admin/settings/limits",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({minDeposit:Number($("limMinD").value),maxDeposit:Number($("limMaxD").value),minWithdraw:Number($("limMinW").value),maxWithdraw:Number($("limMaxW").value),dailyWithdraw:Number($("limDailyW").value)})});toast("Limits updated");loadConfig();adminPayments()}catch(e){toast(e.message)}}
async function adminGames(){
  const d=await adminApi("/api/admin/games");
  $("adminContent").innerHTML=`
  <div class="gameManagerHero"><b>Easy Game Manager</b><span>১) ZIP নির্বাচন → ২) Auto Install → ৩) Auto Publish → ৪) Play</span></div>
  <div class="adminBlock">
    <b>Auto Game ZIP Runner</b>
    <p class="muted">শুধু Game ZIP দিন। game.json না থাকলেও index.html নিজে খুঁজে নেবে, nested folder বুঝবে, safe files install করবে, Wallet SDK inject করবে এবং game Auto Publish করবে।</p>
    <label class="fileLabel gameUploadBox">＋ Choose Game ZIP<input id="gameZip" type="file" accept=".zip" onchange="installGameZip()"></label>
    <div id="gameInstallStatus" class="installStatus">Package size limit: 25 MB • game.json optional • nested ZIP supported • auto publish</div>
  </div>
  <div class="adminBlock">
    <b>Quick Create</b>
    <div class="adminGrid">
      <label>Name<input id="gName" placeholder="Lucky Colors"></label>
      <label>Slug<input id="gSlug" placeholder="lucky-colors"></label>
      <label>Category<select id="gCategory"><option>arcade</option><option>popular</option><option>slot</option><option>card</option><option>live</option></select></label>
      <label>Engine<select id="gEngine">${d.supportedEngines.map(e=>`<option>${e}</option>`).join('')}</select></label>
      <label>Icon<input id="gIcon" value="🎮"></label>
      <label>Min Bet<input id="gMin" value="10"></label>
      <label>Max Bet<input id="gMax" value="500"></label>
      <label class="span2">Description<input id="gDescription" placeholder="Short game description"></label>
    </div>
    <button class="mini" onclick="addGame()">Create in Test Mode</button>
  </div>
  <div class="adminBlock">
    <b>Installed Games</b>
    <p class="muted">ZIP upload হলেই safe validation শেষে game Auto Publish হয়। প্রয়োজন হলে নিচের controls দিয়ে Test, Maintenance, Unpublish বা Delete করতে পারবেন।</p>
    ${d.rows.map(gameAdminRow).join('')}
  </div>`
}
function adminGameVisual(g){
  const thumb=String(g.thumbnail||"").trim();
  if(thumb && (/^https:\/\//i.test(thumb)||thumb.startsWith("/game-assets/"))){
    return `<img class="adminGameThumb" src="${esc(thumb)}" alt="${esc(g.name||"Game")}" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'adminGameIcon',textContent:'🎮'}))">`;
  }
  const raw=String(g.icon||"").trim();
  const icon=(!raw||raw.length>8||raw.includes("/")||raw.includes("\\")||raw.includes(".html")||raw.includes("public"))?"🎮":raw;
  return `<span class="adminGameIcon">${esc(icon)}</span>`;
}
function gameAdminRow(g){
  const passed=Number(g.test_passed)===1,visual=adminGameVisual(g);
  const statusLabel=g.publish_status==="published"?"Published":g.publish_status==="test"?"Test Mode":String(g.publish_status||"Unknown");
  return `<section class="adminGameCard">
    <div class="adminGameCardHead">
      <div class="adminGameIdentity">${visual}<div class="adminGameTitleWrap">
        <b class="adminGameTitle" title="${esc(g.name)}">${esc(g.name)}</b>
        <span class="adminGameSlug" title="${esc(g.slug)}">${esc(g.slug)}</span>
        <div class="adminGameMeta">
          <span>${esc(g.engine||"game")}</span><span>v${esc(g.version||"1.0.0")}</span><span>${esc(g.package_type||"engine")}</span>
        </div>
      </div></div>
      <div class="adminGameStatusWrap">
        <span class="status ${g.publish_status==="published"?"publishedStatus":""}">${esc(statusLabel)}</span>
        ${passed?'<span class="status testOk">TEST ✓</span>':'<span class="status testNeed">TEST REQUIRED</span>'}
      </div>
    </div>

    <div class="gameEditGrid mobileGameEditGrid">
      <label>Name<input id="gname_${g.slug}" value="${esc(g.name)}"></label>
      <label>Category<select id="gcat_${g.slug}">${["popular","slot","arcade","card","live"].map(c=>`<option ${g.category===c?'selected':''}>${c}</option>`).join("")}</select></label>
      <label>Badge<input id="gbadge_${g.slug}" value="${esc(g.badge||'')}" placeholder="HOT / NEW"></label>
      <label>Sort<input id="gsort_${g.slug}" type="number" value="${Number(g.sort_order||100)}"></label>
      <label>Min Bet<input id="gmin_${g.slug}" inputmode="numeric" value="${g.min_bet}"></label>
      <label>Max Bet<input id="gmax_${g.slug}" inputmode="numeric" value="${g.max_bet}"></label>
      <label class="span2">Thumbnail URL<input id="gthumb_${g.slug}" value="${esc(g.thumbnail||'')}" placeholder="Optional image URL"></label>
      <label class="span2">Description<input id="gdesc_${g.slug}" value="${esc(g.description||'')}" placeholder="Short game description"></label>
      <label class="featuredToggle"><input id="gfeatured_${g.slug}" type="checkbox" ${g.featured?'checked':''}><span>Featured game</span></label>
    </div>

    <div class="adminGameStats">
      <div><b>${Number(g.plays||0).toLocaleString()}</b><small>Plays</small></div>
      <div><b>${Number(g.wagered||0).toLocaleString()}</b><small>Wagered</small></div>
      <div><b>${Number(g.payout||0).toLocaleString()}</b><small>Payout</small></div>
      <div><b>${Number(g.players||0).toLocaleString()}</b><small>Players</small></div>
    </div>

    <div class="adminGameActions">
      <button class="primaryAction" onclick="saveGame('${g.slug}','${g.publish_status}',${g.enabled},${g.maintenance})">Save</button>
      <button onclick="testGame('${g.slug}')">Run Test</button>
      <button ${!passed&&g.publish_status!=='published'?'disabled':''} onclick="setGameState('${g.slug}','${g.publish_status==='published'?'test':'published'}',${g.enabled},${g.maintenance})">${g.publish_status==='published'?'Unpublish':'Publish'}</button>
      <button onclick="setGameState('${g.slug}','${g.publish_status}',${g.enabled},${g.maintenance?0:1})">${g.maintenance?'Resume':'Maintenance'}</button>
      <button onclick="rollbackGame('${g.slug}')">Rollback</button>
      <button class="danger" onclick="deleteGame('${g.slug}')">Delete</button>
    </div>
  </section>`
}
async function addGame(){
  try{
    await adminApi("/api/admin/games",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
      name:$("gName").value,slug:$("gSlug").value,engine:$("gEngine").value,icon:$("gIcon").value,
      category:$("gCategory").value,description:$("gDescription").value,
      minBet:Number($("gMin").value),maxBet:Number($("gMax").value),version:"1.0.0",
      config:$("gEngine").value==="wheel"?{choices:[{key:"red",label:"Red",weight:5,payout:2},{key:"blue",label:"Blue",weight:5,payout:2},{key:"gold",label:"Gold",weight:2,payout:4}]}:{}
    })});
    toast("Game created. Run Test before Publish.");adminGames()
  }catch(e){toast(e.message)}
}
async function installGameZip(){
  const file=$("gameZip").files[0];if(!file)return;
  const status=$("gameInstallStatus");status.textContent=`Installing ${file.name}...`;
  const fd=new FormData();fd.append("package",file);
  try{
    const d=await withLoading("Game install হচ্ছে","ZIP package পরীক্ষা ও install করা হচ্ছে...",async()=>{
      const r=await fetch("/api/admin/games/install",{method:"POST",headers:{"x-admin-token":adminToken},body:fd});
      const d=await r.json();if(!r.ok)throw new Error(d.message);return d
    });
    status.textContent=`Ready: ${d.name||d.slug} • ${d.engine} • Published`;
    showActionResult("success","Game ready",`${d.name||d.slug} install + publish হয়েছে। এখন Home থেকে Play করুন।`);await adminGames();await loadGames()
  }catch(e){status.textContent=e.message;showActionResult("error","Game install failed",e.message)}
}
async function saveGame(slug,status,enabled,maintenance){return setGameState(slug,status,enabled,maintenance,true)}async function setGameState(slug,status,enabled,maintenance,limitsOnly=false){try{const body={publishStatus:status,enabled:Boolean(enabled),maintenance:Boolean(maintenance),minBet:Number($("gmin_"+slug)?.value||10),maxBet:Number($("gmax_"+slug)?.value||500),name:$("gname_"+slug)?.value,category:$("gcat_"+slug)?.value,badge:$("gbadge_"+slug)?.value,sortOrder:Number($("gsort_"+slug)?.value||100),thumbnail:$("gthumb_"+slug)?.value,description:$("gdesc_"+slug)?.value,featured:Boolean($("gfeatured_"+slug)?.checked)};await adminApi(`/api/admin/games/${slug}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});toast("Game updated");adminGames();loadGames()}catch(e){toast(e.message)}}
async function testGame(slug){try{const d=await adminApi(`/api/admin/games/${slug}/test`,{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});alert(`TEST PASSED ✓\nOutcome: ${d.outcome}\nMultiplier: ${d.multiplier}\n\nNow you can Publish this version.`);await adminGames()}catch(e){toast(e.message)}}async function rollbackGame(slug){try{const d=await adminApi(`/api/admin/games/${slug}/rollback`,{method:"POST"});toast(`Rolled back to v${d.version}`);adminGames()}catch(e){toast(e.message)}}async function deleteGame(slug){if(!confirm("Delete this game from the lobby? Bet history will be kept."))return;try{await adminApi(`/api/admin/games/${slug}`,{method:"DELETE"});toast("Game removed");adminGames();loadGames()}catch(e){toast(e.message)}}
async function adminContent(){const d=await adminApi("/api/admin/content");$("adminContent").innerHTML=`<div class="adminBlock"><b>Banner Manager</b><div class="adminGrid"><label>Title<input id="newBannerTitle"></label><label>Subtitle<input id="newBannerSubtitle"></label><label class="span2">Image URL<input id="newBannerImage" placeholder="https://..."></label><label>Sort<input id="newBannerSort" type="number" value="100"></label></div><button class="mini" onclick="addBanner()">Add Banner</button>${d.banners.map(b=>`<div class="adminUser contentAdminRow"><div><b>#${b.id} ${esc(b.title)}</b><br><span class="muted">${esc(b.subtitle||"")}</span></div><input id="btitle_${b.id}" value="${esc(b.title)}"><input id="bimg_${b.id}" value="${esc(b.image_url||"")}" placeholder="Image URL"><div class="adminActions"><button class="mini" onclick="saveBanner(${b.id},${b.enabled},${b.sort_order})">Save</button><button class="mini" onclick="toggleBanner(${b.id},${b.enabled?0:1},${b.sort_order})">${b.enabled?'Disable':'Enable'}</button><button class="danger" onclick="deleteBanner(${b.id})">Delete</button></div></div>`).join("")}</div><div class="adminBlock"><b>Promotion Manager</b><div class="adminGrid"><label>Title<input id="newPromoTitle"></label><label>Subtitle<input id="newPromoSubtitle"></label><label>Badge<input id="newPromoBadge" value="🎁"></label><label>Sort<input id="newPromoSort" type="number" value="100"></label></div><button class="mini" onclick="addPromotion()">Add Promotion</button>${d.promotions.map(p=>`<div class="adminUser contentAdminRow"><div><b>${esc(p.badge||"🎁")} ${esc(p.title)}</b><br><span class="muted">${esc(p.subtitle||"")}</span></div><input id="ptitle_${p.id}" value="${esc(p.title)}"><input id="psub_${p.id}" value="${esc(p.subtitle||"")}"><div class="adminActions"><button class="mini" onclick="savePromotion(${p.id},${p.enabled},${p.sort_order})">Save</button><button class="mini" onclick="togglePromotion(${p.id},${p.enabled?0:1},${p.sort_order})">${p.enabled?'Disable':'Enable'}</button><button class="danger" onclick="deletePromotion(${p.id})">Delete</button></div></div>`).join("")}</div>`}
async function addBanner(){try{await adminApi("/api/admin/banners",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({title:$("newBannerTitle").value,subtitle:$("newBannerSubtitle").value,imageUrl:$("newBannerImage").value,sortOrder:Number($("newBannerSort").value),enabled:true})});toast("Banner added");adminContent();loadHomeContent()}catch(e){toast(e.message)}}async function saveBanner(id,en,sort){try{await adminApi(`/api/admin/banners/${id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({title:$("btitle_"+id).value,imageUrl:$("bimg_"+id).value,enabled:Boolean(en),sortOrder:Number(sort)})});adminContent();loadHomeContent()}catch(e){toast(e.message)}}async function toggleBanner(id,en,sort){try{await adminApi(`/api/admin/banners/${id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({enabled:Boolean(en),sortOrder:Number(sort)})});adminContent();loadHomeContent()}catch(e){toast(e.message)}}async function deleteBanner(id){if(confirm("Delete banner?")){await adminApi(`/api/admin/banners/${id}`,{method:"DELETE"});adminContent();loadHomeContent()}}
async function addPromotion(){try{await adminApi("/api/admin/promotions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({title:$("newPromoTitle").value,subtitle:$("newPromoSubtitle").value,badge:$("newPromoBadge").value,sortOrder:Number($("newPromoSort").value),enabled:true})});toast("Promotion added");adminContent();loadHomeContent()}catch(e){toast(e.message)}}async function savePromotion(id,en,sort){try{await adminApi(`/api/admin/promotions/${id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({title:$("ptitle_"+id).value,subtitle:$("psub_"+id).value,enabled:Boolean(en),sortOrder:Number(sort)})});adminContent();loadHomeContent()}catch(e){toast(e.message)}}async function togglePromotion(id,en,sort){try{await adminApi(`/api/admin/promotions/${id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({enabled:Boolean(en),sortOrder:Number(sort)})});adminContent();loadHomeContent()}catch(e){toast(e.message)}}async function deletePromotion(id){if(confirm("Delete promotion?")){await adminApi(`/api/admin/promotions/${id}`,{method:"DELETE"});adminContent();loadHomeContent()}}
async function adminNotifications(){$("adminContent").innerHTML=`<div class="adminBlock"><b>Notification Center</b><p class="muted">Phone blank রাখলে সব user-কে যাবে।</p><div class="adminGrid"><label>Title<input id="broadcastTitle"></label><label>Type<select id="broadcastType"><option>info</option><option>success</option><option>warning</option></select></label><label class="span2">Message<textarea id="broadcastMessage"></textarea></label><label>Specific phone<input id="broadcastPhone" placeholder="01XXXXXXXXX"></label></div><button class="mini" onclick="sendBroadcast()">Send Notification</button></div>`}async function sendBroadcast(){try{const d=await adminApi("/api/admin/notifications/broadcast",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({title:$("broadcastTitle").value,message:$("broadcastMessage").value,type:$("broadcastType").value,phone:$("broadcastPhone").value})});toast(`Sent to ${d.count} user(s)`)}catch(e){toast(e.message)}}
async function adminBets(){const d=await adminApi("/api/admin/bets");$("adminContent").innerHTML=`<table class="adminTable"><tr><th>User</th><th>Game</th><th>Stake</th><th>Payout</th><th>Outcome</th></tr>${d.rows.map(b=>`<tr><td>${esc(b.name)}<br><span class="muted">${esc(b.phone)}</span></td><td>${esc(b.game_slug)}</td><td>${b.stake}</td><td>${b.payout}</td><td>${esc(b.outcome)}</td></tr>`).join('')}</table>`}
async function adminSupport(){const d=await adminApi("/api/admin/support");$("adminContent").innerHTML=d.rows.map(t=>`<div class="adminUser"><div><b>#${t.id} ${esc(t.subject)}</b><br><span class="muted">${esc(t.name)} • ${esc(t.phone)}</span><br>${esc(t.message)}</div><div>${esc(t.status)}</div><select id="ts_${t.id}"><option>Open</option><option ${t.status==='In Progress'?'selected':''}>In Progress</option><option ${t.status==='Closed'?'selected':''}>Closed</option></select><button class="mini" onclick="saveTicket(${t.id})">Save</button></div>`).join('')}async function saveTicket(id){try{await adminApi(`/api/admin/support/${id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({status:$("ts_"+id).value})});toast("Ticket updated")}catch(e){toast(e.message)}}
async function adminAudit(){const d=await adminApi("/api/admin/audit");$("adminContent").innerHTML=`<table class="adminTable"><tr><th>Action</th><th>Details</th><th>Time</th></tr>${d.rows.map(a=>`<tr><td>${esc(a.action)}</td><td>${esc(a.details_json)}</td><td>${new Date(a.created_at).toLocaleString()}</td></tr>`).join('')}</table>`}

function togglePass(id,btn){const el=$(id);if(!el)return;el.type=el.type==='password'?'text':'password';if(btn)btn.textContent=el.type==='password'?'◉':'○'}
function setBottomActive(btn){document.querySelectorAll('.bottomNav button').forEach(b=>b.classList.remove('active'));btn?.classList.add('active')}
function filterLobby(category,btn){if(btn){document.querySelectorAll('.quickCats button').forEach(b=>b.classList.remove('active'));btn.classList.add('active')}document.querySelectorAll('#gameGrid .gameCard').forEach((card,i)=>{const c=(card.dataset.category||'').toLowerCase();let show=category==='all'||(category==='popular'&&i<10)||c.includes(category);card.style.display=show?'flex':'none'})}
function selectAmount(n){$('moneyAmount').value=n;document.querySelectorAll('.amountGrid button').forEach(b=>b.classList.toggle('active',Number(b.textContent.replace(/,/g,''))===Number(n)));syncMoneyButton()}
function selectMethod(btn,name){document.querySelectorAll('.methodGrid button').forEach(b=>b.classList.remove('selected'));btn?.classList.add('selected');window.__moneyMethod=name}
function syncMoneyButton(){const b=$('moneySubmit'),a=Number($('moneyAmount')?.value||0);if(!b)return;let ready=a>0;if(moneyMode==='deposit'&&moneyStep===2)ready=ready&&/^[A-Za-z0-9]{6,30}$/.test($('paymentTxId')?.value.trim()||'');if(moneyMode==='withdraw')ready=ready&&/^01\d{9}$/.test($('withdrawNumber')?.value.trim()||'');b.classList.toggle('ready',ready)}
$('moneyAmount')?.addEventListener('input',syncMoneyButton);
function accountAction(action){
  if(!me)return openAccount();
  if(action==="deposit")return openMoney("deposit");
  if(action==="withdraw")return openMoney("withdraw");
  if(action==="vip")return showMemberInfo("vip");
  if(action==="invite")return showMemberInfo("invite");
  if(action==="security")return openSecurityCenter();
  closeModal("accountModal");
  if(action==="bets")return go("history");
  if(action==="depositRecord"||action==="withdrawRecord"||action==="transactions")return go("wallet");
  if(action==="notifications")return go("notifications");
  if(action==="promotions")return go("promotions");
  if(action==="support")return go("support");
}
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&$("gameModal")?.classList.contains("show"))closeGameViewer()});
(async function init(){
  updateNetworkState();renderGameSkeletons();const started=Date.now();
  try{await Promise.all([loadConfig(),loadGames(),loadMe(),loadHomeContent()]);renderAccount();if(me)await refreshPrivate()}
  finally{const wait=Math.max(0,850-(Date.now()-started));setTimeout(()=>$("startupSplash")?.classList.add("hide"),wait)}
})();