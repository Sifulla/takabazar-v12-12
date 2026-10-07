import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import AdmZip from "adm-zip";
import { db,getUserById,getGame,audit,notify,getSetting,getSettingInt,setSetting,addLedger } from "./src/db.js";
import { hashPassword,verifyPassword,randomToken,tokenHash,safeText,bdPhone,intAmount,txId,validSlug } from "./src/security.js";
import { playGame,SUPPORTED_ENGINES } from "./src/gameRegistry.js";

const app=express();
const PORT=Number(process.env.PORT||3000),ADMIN_PIN=String(process.env.ADMIN_PIN||"64686123"),SESSION_DAYS=Math.max(1,Number(process.env.SESSION_DAYS||7)),STARTING_CREDITS=Math.max(0,Math.floor(Number(process.env.STARTING_CREDITS||1000)));
app.disable("x-powered-by");app.set("trust proxy",1);app.use(express.json({limit:"300kb"}));
app.use((req,res,next)=>{res.setHeader("X-Content-Type-Options","nosniff");res.setHeader("Referrer-Policy","strict-origin-when-cross-origin");res.setHeader("X-Frame-Options","DENY");res.setHeader("Permissions-Policy","geolocation=(),camera=(),microphone=()");if(req.path.startsWith("/api/"))res.setHeader("Cache-Control","no-store");next()});

const buckets=new Map();
function rateLimit(name,limit,windowMs){return(req,res,next)=>{const now=Date.now(),key=`${name}:${req.ip||"unknown"}`;let b=buckets.get(key);if(!b||b.reset<=now)b={count:0,reset:now+windowMs};b.count++;buckets.set(key,b);if(b.count>limit)return res.status(429).json({success:false,message:"Too many requests. Try again shortly."});next()}}
const authLimit=rateLimit("auth",30,15*60e3),betLimit=rateLimit("bet",150,10*60e3),moneyLimit=rateLimit("wallet",40,15*60e3),adminLimit=rateLimit("admin",30,15*60e3);
const bearer=req=>{const h=String(req.headers.authorization||"");return h.startsWith("Bearer ")?h.slice(7):""};
function userAuth(req,res,next){const raw=bearer(req);if(!raw)return res.status(401).json({success:false,message:"Please login"});const row=db.prepare(`SELECT s.id session_id,s.user_id,s.expires_at,u.name,u.phone,u.available_balance,u.held_balance FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?`).get(tokenHash(raw));if(!row||Number(row.expires_at)<Date.now()){if(row)db.prepare("DELETE FROM sessions WHERE id=?").run(row.session_id);return res.status(401).json({success:false,message:"Session expired. Please login again."})}req.user=row;next()}
const adminSessions=new Map();
function adminAuth(req,res,next){const t=String(req.headers["x-admin-token"]||"");const s=adminSessions.get(t);if(!s||s.expires<Date.now())return res.status(401).json({success:false,message:"Admin login required"});s.expires=Date.now()+6*60*60e3;req.admin={token:t};next()}
const publicUser=u=>({id:u.id,name:u.name,phone:u.phone,available:Number(u.available_balance||0),held:Number(u.held_balance||0),total:Number(u.available_balance||0)+Number(u.held_balance||0)});
const limits=()=>({minDeposit:getSettingInt("min_deposit",50),maxDeposit:getSettingInt("max_deposit",10000),minWithdraw:getSettingInt("min_withdraw",150),maxWithdraw:getSettingInt("max_withdraw",5000),dailyWithdraw:getSettingInt("daily_withdraw",10000)});
const paymentSettings=()=>({
  bkash:{enabled:getSettingInt("bkash_enabled",1)===1,number:getSetting("bkash_number","")},
  nagad:{enabled:getSettingInt("nagad_enabled",1)===1,number:getSetting("nagad_number","")}
});
const todayStart=()=>{const d=new Date();d.setHours(0,0,0,0);return d.toISOString()};
const payoutMethod=v=>["bkash","nagad"].includes(String(v||"").toLowerCase())?String(v).toLowerCase():"";
const safeMediaUrl=v=>{const s=String(v||"").trim().slice(0,500);return !s||s.startsWith("/game-assets/")||/^https:\/\/[^\s]+$/i.test(s)?s:""};
const boolInt=v=>v===true||v===1||v==="1"?1:0;
const DEMO_ADMIN_CONTROLS=String(process.env.TAKABAZAR_DEMO_ADMIN_CONTROLS||"1")!=="0";
const crashMultiplier=(startAt,now=Date.now())=>{const elapsed=Math.max(0,(now-Number(startAt))/1000);return Math.max(1,Math.floor(Math.exp(elapsed*.0805)*100)/100)};
function secureCrashPoint(){const r=crypto.randomInt(0,1000000)/1000000;let x;if(r<.55)x=1.01+(r/.55)*.98;else if(r<.85)x=2+((r-.55)/.30)*2.99;else if(r<.97)x=5+((r-.85)/.12)*4.99;else x=10+((r-.97)/.03)*15;return Math.floor(x*100)/100}
function crashRoundState(round,now=Date.now()){if(now<Number(round.start_at))return{state:"WAIT",multiplier:1};const m=crashMultiplier(round.start_at,now);if(m>=Number(round.crash_point))return{state:"CRASH",multiplier:Number(round.crash_point),crashPoint:Number(round.crash_point)};return{state:"FLY",multiplier:m}}
function recordCrashHistory(row,outcome,payout,details){if(Number(row.history_recorded))return;db.prepare("INSERT INTO bets(user_id,game_slug,stake,outcome,payout,details_json,created_at) VALUES(?,?,?,?,?,?,?)").run(row.user_id,row.game_slug,row.stake,outcome,payout,JSON.stringify(details||{}),new Date().toISOString());db.prepare("UPDATE crash_bets SET history_recorded=1 WHERE bet_id=?").run(row.bet_id)}
function finalizeCrashRound(round){const st=crashRoundState(round);if(st.state!=="CRASH")return st;db.prepare("UPDATE crash_rounds SET status='CRASH',finished_at=? WHERE round_id=?").run(new Date().toISOString(),round.round_id);const rows=db.prepare("SELECT * FROM crash_bets WHERE round_id=? AND status IN ('Queued','Active')").all(round.round_id);for(const b of rows){db.prepare("UPDATE crash_bets SET status='Lost',updated_at=? WHERE bet_id=?").run(new Date().toISOString(),b.bet_id);recordCrashHistory(b,`crash@${Number(round.crash_point).toFixed(2)}x`,0,{win:false,crashPoint:Number(round.crash_point),roundId:round.round_id})}return st}

const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:25*1024*1024,files:1},fileFilter:(req,file,cb)=>cb(null,/\.zip$/i.test(file.originalname))});
const GAME_ASSET_ROOT=path.resolve("data","game-assets");fs.mkdirSync(GAME_ASSET_ROOT,{recursive:true});
function repairInstalledGameBridges(dir=GAME_ASSET_ROOT){
  let repaired=0,checked=0;
  const walk=current=>{
    let rows=[];try{rows=fs.readdirSync(current,{withFileTypes:true})}catch{return}
    for(const row of rows){
      const full=path.join(current,row.name);
      if(row.isDirectory()){walk(full);continue}
      if(!/\.html?$/i.test(row.name))continue;
      checked++;
      try{
        const before=fs.readFileSync(full,"utf8");
        let after=injectGameBridge(before);
        // Normalize old bridge references so existing pre-V12 games load the current SDK.
        after=after
          .replace(/<script[^>]+src=["']\/sdk\/takabazar-game-sdk\.js(?:\?[^"']*)?["'][^>]*><\/script>/ig,'<script src="/sdk/takabazar-game-sdk.js"></script>')
          .replace(/<script[^>]+src=["']\/sdk\/takabazar-auto-bridge\.js(?:\?[^"']*)?["'][^>]*><\/script>/ig,'<script src="/sdk/takabazar-auto-bridge.js"></script>');
        if(!/takabazar-game-sdk\.js/i.test(after)||!/takabazar-auto-bridge\.js/i.test(after))after=injectGameBridge(after);
        if(after!==before){fs.writeFileSync(full,after,"utf8");repaired++}
      }catch(e){console.warn("Game bridge repair skipped:",full,e.message)}
    }
  };
  walk(dir);
  if(checked)console.log(`Game bridge check: ${checked} HTML file(s), ${repaired} repaired`);
  return{checked,repaired}
}

repairInstalledGameBridges();

app.get("/api/config",(req,res)=>res.json({success:true,brand:"TakaBazar",currency:"CREDITS",creditsOnly:true,limits:limits(),payment:paymentSettings()}));
app.get("/api/content/home",(req,res)=>res.json({
  success:true,
  banners:db.prepare("SELECT id,title,subtitle,image_url,sort_order FROM banners WHERE enabled=1 ORDER BY sort_order,id").all(),
  promotions:db.prepare("SELECT id,title,subtitle,badge,sort_order FROM promotions WHERE enabled=1 ORDER BY sort_order,id").all()
}));
app.get("/api/games",(req,res)=>{const rows=db.prepare("SELECT slug,name,category,engine,enabled,min_bet,max_bet,publish_status,maintenance,version,icon,thumbnail,description,featured,badge,sort_order,ui_entry,package_type,bridge_version,config_json FROM games WHERE deleted=0 AND publish_status='published' ORDER BY featured DESC,sort_order ASC,name").all().map(x=>({...x,config:JSON.parse(x.config_json||"{}")}));res.json({success:true,games:rows})});

app.post("/api/register",authLimit,(req,res)=>{try{const name=safeText(req.body.name,80),phone=bdPhone(req.body.phone),password=String(req.body.password||"");if(name.length<2)return res.status(400).json({success:false,message:"Enter your name"});if(!phone)return res.status(400).json({success:false,message:"Enter a valid 11-digit Bangladesh mobile number"});if(password.length<6)return res.status(400).json({success:false,message:"Password must be at least 6 characters"});if(db.prepare("SELECT id FROM users WHERE phone=?").get(phone))return res.status(409).json({success:false,message:"This mobile number is already registered"});const now=new Date().toISOString();const r=db.prepare("INSERT INTO users(name,phone,password_hash,available_balance,held_balance,created_at) VALUES(?,?,?,?,?,?)").run(name,phone,hashPassword(password),STARTING_CREDITS,0,now);const uid=Number(r.lastInsertRowid);addLedger(uid,"WELCOME",STARTING_CREDITS,STARTING_CREDITS,0,"Starting credits");const token=randomToken(),exp=Date.now()+SESSION_DAYS*864e5;db.prepare("INSERT INTO sessions(user_id,token_hash,expires_at,created_at) VALUES(?,?,?,?)").run(uid,tokenHash(token),exp,now);notify(uid,"Welcome","Your account is ready.","success");res.json({success:true,token,user:publicUser(getUserById(uid))})}catch(e){console.error(e);res.status(500).json({success:false,message:"Registration failed"})}});
app.post("/api/login",authLimit,(req,res)=>{const phone=bdPhone(req.body.phone),password=String(req.body.password||"");const u=db.prepare("SELECT * FROM users WHERE phone=?").get(phone);if(!u||!verifyPassword(password,u.password_hash))return res.status(401).json({success:false,message:"Mobile or password is incorrect"});const token=randomToken(),exp=Date.now()+SESSION_DAYS*864e5;db.prepare("INSERT INTO sessions(user_id,token_hash,expires_at,created_at) VALUES(?,?,?,?)").run(u.id,tokenHash(token),exp,new Date().toISOString());res.json({success:true,token,user:publicUser(u)})});
app.post("/api/logout",userAuth,(req,res)=>{db.prepare("DELETE FROM sessions WHERE id=?").run(req.user.session_id);res.json({success:true})});
app.get("/api/me",userAuth,(req,res)=>{const u=db.prepare("SELECT * FROM users WHERE id=?").get(req.user.user_id);res.json({success:true,user:publicUser(u),payout:{method:u.payout_method||"",number:u.payout_number||""}})});
app.get("/api/wallet",userAuth,(req,res)=>{const u=getUserById(req.user.user_id);const pendingDeposits=db.prepare("SELECT COUNT(*) n FROM deposits WHERE user_id=? AND status='Pending'").get(u.id).n,pendingWithdrawals=db.prepare("SELECT COUNT(*) n FROM withdrawals WHERE user_id=? AND status='Pending'").get(u.id).n;res.json({success:true,wallet:publicUser(u),limits:limits(),pending:{deposits:pendingDeposits,withdrawals:pendingWithdrawals}})});
app.get("/api/account/payout",userAuth,(req,res)=>{const u=db.prepare("SELECT payout_method,payout_number FROM users WHERE id=?").get(req.user.user_id);res.json({success:true,payout:{method:u?.payout_method||"",number:u?.payout_number||""}})});
app.put("/api/account/payout",userAuth,(req,res)=>{
  const method=payoutMethod(req.body.method),number=String(req.body.number||"").replace(/\D/g,"").slice(0,11);
  if(!method)return res.status(400).json({success:false,message:"Select bKash or Nagad"});
  if(!/^01\d{9}$/.test(number))return res.status(400).json({success:false,message:"Enter a valid 11-digit mobile wallet number"});
  db.prepare("UPDATE users SET payout_method=?,payout_number=? WHERE id=?").run(method,number,req.user.user_id);
  res.json({success:true,payout:{method,number}})
});

app.get("/api/member/summary",userAuth,(req,res)=>{
  const uid=req.user.user_id;
  const bets=db.prepare("SELECT COUNT(*) bets,COALESCE(SUM(stake),0) wagered,COALESCE(SUM(payout),0) payout FROM bets WHERE user_id=?").get(uid);
  const dep=db.prepare("SELECT COALESCE(SUM(amount),0) total,COUNT(*) count FROM deposits WHERE user_id=? AND status='Approved'").get(uid);
  const wdr=db.prepare("SELECT COALESCE(SUM(amount),0) total,COUNT(*) count FROM withdrawals WHERE user_id=? AND status='Approved'").get(uid);
  const tickets=db.prepare("SELECT COUNT(*) count FROM support_tickets WHERE user_id=? AND status!='Closed'").get(uid);
  const unread=db.prepare("SELECT COUNT(*) count FROM notifications WHERE user_id=? AND is_read=0").get(uid);
  const wagered=Number(bets?.wagered||0);
  const level=wagered>=100000?5:wagered>=50000?4:wagered>=10000?3:wagered>=2500?2:1;
  res.json({success:true,summary:{
    level,
    bets:Number(bets?.bets||0),
    wagered,
    payout:Number(bets?.payout||0),
    approvedDeposits:Number(dep?.total||0),
    approvedDepositCount:Number(dep?.count||0),
    approvedWithdrawals:Number(wdr?.total||0),
    approvedWithdrawalCount:Number(wdr?.count||0),
    openTickets:Number(tickets?.count||0),
    unread:Number(unread?.count||0),
    inviteCode:`TB${String(uid).padStart(6,"0")}`
  }})
});
app.put("/api/account/password",userAuth,authLimit,(req,res)=>{
  const current=String(req.body.currentPassword||""),next=String(req.body.newPassword||"");
  const u=db.prepare("SELECT * FROM users WHERE id=?").get(req.user.user_id);
  if(!verifyPassword(current,u.password_hash))return res.status(400).json({success:false,message:"Current password is incorrect"});
  if(next.length<6||next.length>128)return res.status(400).json({success:false,message:"New password must be 6-128 characters"});
  if(current===next)return res.status(400).json({success:false,message:"Choose a different new password"});
  db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(hashPassword(next),u.id);
  audit("PASSWORD_CHANGE",{userId:u.id});
  notify(u.id,"Security update","Your password was changed successfully.","success");
  res.json({success:true})
});
app.get("/api/transactions",userAuth,(req,res)=>{const type=safeText(req.query.type,40);const rows=type&&type!=="all"?db.prepare("SELECT id,type,amount,balance_after,held_after,note,ref_id,created_at FROM ledger WHERE user_id=? AND type=? ORDER BY id DESC LIMIT 200").all(req.user.user_id,type):db.prepare("SELECT id,type,amount,balance_after,held_after,note,ref_id,created_at FROM ledger WHERE user_id=? ORDER BY id DESC LIMIT 200").all(req.user.user_id);res.json({success:true,rows})});
app.get("/api/payments",userAuth,(req,res)=>{const deposits=db.prepare("SELECT tx_id,amount,status,note,admin_note,payment_method,payment_number,payment_ref,created_at,updated_at FROM deposits WHERE user_id=? ORDER BY id DESC LIMIT 100").all(req.user.user_id),withdrawals=db.prepare("SELECT tx_id,amount,status,note,admin_note,payout_method,payout_number,created_at,updated_at FROM withdrawals WHERE user_id=? ORDER BY id DESC LIMIT 100").all(req.user.user_id);res.json({success:true,deposits,withdrawals})});

app.post("/api/deposits",moneyLimit,userAuth,(req,res)=>{
  const amount=intAmount(req.body.amount),note=safeText(req.body.note,180),
  clientKey=safeText(req.body.clientKey,100)||null,
  paymentMethod=safeText(req.body.paymentMethod,30).toLowerCase(),
  paymentRef=safeText(req.body.paymentRef,40).toUpperCase(),
  L=limits(),P=paymentSettings();

  if(amount<L.minDeposit||amount>L.maxDeposit)return res.status(400).json({success:false,message:`Deposit must be ${L.minDeposit}-${L.maxDeposit} credits`});
  if(!["bkash","nagad"].includes(paymentMethod))return res.status(400).json({success:false,message:"Select bKash or Nagad"});
  const method=P[paymentMethod];
  if(!method?.enabled||!/^01\d{9}$/.test(method.number||""))return res.status(503).json({success:false,message:`${paymentMethod==="bkash"?"bKash":"Nagad"} deposit is temporarily unavailable`});
  if(!/^[A-Z0-9]{6,30}$/.test(paymentRef))return res.status(400).json({success:false,message:`Enter a valid ${paymentMethod==="bkash"?"bKash":"Nagad"} transaction ID`});

  if(clientKey){
    const old=db.prepare("SELECT tx_id,status FROM deposits WHERE user_id=? AND client_key=?").get(req.user.user_id,clientKey);
    if(old)return res.json({success:true,duplicate:true,txId:old.tx_id,status:old.status});
  }
  const duplicateRef=db.prepare("SELECT tx_id FROM deposits WHERE payment_method=? AND payment_ref=?").get(paymentMethod,paymentRef);
  if(duplicateRef)return res.status(409).json({success:false,message:"This transaction ID has already been submitted for this payment method"});

  const id=txId("DEP"),now=new Date().toISOString();
  db.prepare("INSERT INTO deposits(tx_id,user_id,amount,status,note,client_key,created_at,updated_at,payment_method,payment_number,payment_ref) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
    .run(id,req.user.user_id,amount,"Pending",note,clientKey,now,now,paymentMethod,method.number,paymentRef);

  notify(req.user.user_id,"Deposit request received",`${id} is pending manual verification.`,"info");
  res.json({success:true,txId:id,status:"Pending"})
});

app.post("/api/withdrawals",moneyLimit,userAuth,(req,res)=>{
  const amount=intAmount(req.body.amount),note=safeText(req.body.note,180),clientKey=safeText(req.body.clientKey,100)||null,L=limits();
  let method=payoutMethod(req.body.payoutMethod),number=String(req.body.payoutNumber||"").replace(/\D/g,"").slice(0,11);
  const saved=db.prepare("SELECT payout_method,payout_number FROM users WHERE id=?").get(req.user.user_id);
  if(!method)method=payoutMethod(saved?.payout_method);if(!number)number=String(saved?.payout_number||"");
  if(!method)return res.status(400).json({success:false,message:"Select bKash or Nagad for withdrawal"});
  if(!/^01\d{9}$/.test(number))return res.status(400).json({success:false,message:"Enter a valid 11-digit withdrawal number"});
  if(amount<L.minWithdraw||amount>L.maxWithdraw)return res.status(400).json({success:false,message:`Withdrawal must be ${L.minWithdraw}-${L.maxWithdraw} credits`});
  if(clientKey){const old=db.prepare("SELECT tx_id,status FROM withdrawals WHERE user_id=? AND client_key=?").get(req.user.user_id,clientKey);if(old)return res.json({success:true,duplicate:true,txId:old.tx_id,status:old.status})}
  const used=Number(db.prepare("SELECT COALESCE(SUM(amount),0) n FROM withdrawals WHERE user_id=? AND status IN ('Pending','Approved') AND created_at>=?").get(req.user.user_id,todayStart()).n||0);
  if(used+amount>L.dailyWithdraw)return res.status(400).json({success:false,message:`Daily withdrawal limit is ${L.dailyWithdraw} credits`});
  db.exec("BEGIN IMMEDIATE");try{
    const u=db.prepare("SELECT * FROM users WHERE id=?").get(req.user.user_id);
    if(Number(u.available_balance)<amount){db.exec("ROLLBACK");return res.status(400).json({success:false,message:"Not enough available credits"})}
    const av=Number(u.available_balance)-amount,held=Number(u.held_balance)+amount,id=txId("WDR"),now=new Date().toISOString();
    db.prepare("UPDATE users SET available_balance=?,held_balance=?,payout_method=?,payout_number=? WHERE id=?").run(av,held,method,number,u.id);
    db.prepare("INSERT INTO withdrawals(tx_id,user_id,amount,status,note,client_key,payout_method,payout_number,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run(id,u.id,amount,"Pending",note,clientKey,method,number,now,now);
    addLedger(u.id,"WITHDRAW_HOLD",-amount,av,held,"Credits moved to hold",id,{payoutMethod:method});
    notify(u.id,"Withdrawal request received",`${id} is pending review for ${method.toUpperCase()} ${number}.`,"info");
    db.exec("COMMIT");res.json({success:true,txId:id,status:"Pending",wallet:{available:av,held,total:av+held},payout:{method,number}})
  }catch(e){try{db.exec("ROLLBACK")}catch{};res.status(500).json({success:false,message:"Withdrawal request failed"})}
});

app.post("/api/bet/:slug",betLimit,userAuth,(req,res)=>{const game=getGame(req.params.slug);if(!game||!game.enabled||game.publish_status!=="published")return res.status(404).json({success:false,message:"Game is unavailable"});if(game.maintenance)return res.status(503).json({success:false,message:"Game is under maintenance"});if(game.engine==="crash")return res.status(400).json({success:false,message:"Crash games use the crash session API"});const stake=intAmount(req.body.stake);if(!stake||stake<game.min_bet||stake>game.max_bet)return res.status(400).json({success:false,message:`Bet must be ${game.min_bet}-${game.max_bet} credits`});db.exec("BEGIN IMMEDIATE");try{const u=db.prepare("SELECT * FROM users WHERE id=?").get(req.user.user_id);if(Number(u.available_balance)<stake){db.exec("ROLLBACK");return res.status(400).json({success:false,message:"Not enough available credits"})}const result=playGame(game,req.body),payout=Math.floor(stake*Number(result.multiplier||0)),afterStake=Number(u.available_balance)-stake,newAvail=afterStake+payout,held=Number(u.held_balance||0),now=new Date().toISOString();db.prepare("UPDATE users SET available_balance=? WHERE id=?").run(newAvail,u.id);const br=db.prepare("INSERT INTO bets(user_id,game_slug,stake,outcome,payout,details_json,created_at) VALUES(?,?,?,?,?,?,?)").run(u.id,game.slug,stake,result.outcome,payout,JSON.stringify(result.details),now);const ref=`BET-${Number(br.lastInsertRowid)}`;addLedger(u.id,"BET",-stake,afterStake,held,`${game.name} stake`,ref);if(payout>0)addLedger(u.id,"WIN",payout,newAvail,held,`${game.name} payout`,ref);db.exec("COMMIT");res.json({success:true,betId:Number(br.lastInsertRowid),game:game.slug,stake,outcome:result.outcome,payout,win:Boolean(result.details.win),wallet:{available:newAvail,held,total:newAvail+held},details:result.details})}catch(e){try{db.exec("ROLLBACK")}catch{};res.status(400).json({success:false,message:e?.message||"Bet failed"})}});

// ---------- SERVER-AUTHORITATIVE CRASH GAME API ----------
app.post("/api/crash/:slug/open",betLimit,userAuth,(req,res)=>{
  const game=getGame(req.params.slug);if(!game||game.engine!=="crash"||!game.enabled||game.publish_status!=="published")return res.status(404).json({success:false,message:"Crash game is unavailable"});if(game.maintenance)return res.status(503).json({success:false,message:"Game is under maintenance"});
  const uid=req.user.user_id;const latest=db.prepare("SELECT * FROM crash_rounds WHERE user_id=? AND game_slug=? ORDER BY created_at DESC LIMIT 1").get(uid,game.slug);
  if(latest){const st=finalizeCrashRound(latest);if(st.state!=="CRASH")return res.json({success:true,roundId:latest.round_id,startAt:Number(latest.start_at),state:st.state,multiplier:st.multiplier})}
  const roundId=`CR-${Date.now()}-${crypto.randomBytes(5).toString("hex")}`,startAt=Date.now()+4200,crashPoint=secureCrashPoint(),now=new Date().toISOString();
  db.prepare("INSERT INTO crash_rounds(round_id,user_id,game_slug,start_at,crash_point,status,created_at) VALUES(?,?,?,?,?,'WAIT',?)").run(roundId,uid,game.slug,startAt,crashPoint,now);
  res.json({success:true,roundId,startAt,state:"WAIT",multiplier:1})
});
app.post("/api/crash/:slug/bet",betLimit,userAuth,(req,res)=>{
  const game=getGame(req.params.slug),roundId=safeText(req.body.roundId,120),panel=Math.max(1,Math.min(2,Number(req.body.panel)||1)),stake=intAmount(req.body.stake);if(!game||game.engine!=="crash"||!game.enabled||game.publish_status!=="published")return res.status(404).json({success:false,message:"Crash game is unavailable"});if(!stake||stake<game.min_bet||stake>game.max_bet)return res.status(400).json({success:false,message:`Bet must be ${game.min_bet}-${game.max_bet} credits`});
  const round=db.prepare("SELECT * FROM crash_rounds WHERE round_id=? AND user_id=? AND game_slug=?").get(roundId,req.user.user_id,game.slug);if(!round)return res.status(404).json({success:false,message:"Round not found"});const st=finalizeCrashRound(round);if(st.state!=="WAIT")return res.status(409).json({success:false,message:"Betting for this round is closed"});
  db.exec("BEGIN IMMEDIATE");try{const u=db.prepare("SELECT * FROM users WHERE id=?").get(req.user.user_id);if(Number(u.available_balance)<stake){db.exec("ROLLBACK");return res.status(400).json({success:false,message:"Not enough available credits"})}const av=Number(u.available_balance)-stake,held=Number(u.held_balance||0),betId=`CB-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,now=new Date().toISOString();db.prepare("UPDATE users SET available_balance=? WHERE id=?").run(av,u.id);db.prepare("INSERT INTO crash_bets(bet_id,round_id,user_id,game_slug,panel,stake,status,created_at,updated_at) VALUES(?,?,?,?,?,?,'Queued',?,?)").run(betId,roundId,u.id,game.slug,panel,stake,now,now);addLedger(u.id,"BET",-stake,av,held,`${game.name} stake`,betId,{roundId,panel});db.exec("COMMIT");res.json({success:true,betId,roundId,wallet:{available:av,held,total:av+held}})}catch(e){try{db.exec("ROLLBACK")}catch{};res.status(400).json({success:false,message:e.message||"Bet failed"})}
});
app.post("/api/crash/:slug/cancel",betLimit,userAuth,(req,res)=>{
  const betId=safeText(req.body.betId,120),b=db.prepare("SELECT b.*,r.start_at,r.crash_point FROM crash_bets b JOIN crash_rounds r ON r.round_id=b.round_id WHERE b.bet_id=? AND b.user_id=? AND b.game_slug=?").get(betId,req.user.user_id,req.params.slug);if(!b)return res.status(404).json({success:false,message:"Bet not found"});if(b.status!=="Queued")return res.status(409).json({success:false,message:"Bet can no longer be cancelled"});if(Date.now()>=Number(b.start_at))return res.status(409).json({success:false,message:"Round already started"});
  db.exec("BEGIN IMMEDIATE");try{const u=db.prepare("SELECT * FROM users WHERE id=?").get(b.user_id),av=Number(u.available_balance)+Number(b.stake),held=Number(u.held_balance||0);db.prepare("UPDATE users SET available_balance=? WHERE id=?").run(av,u.id);db.prepare("UPDATE crash_bets SET status='Cancelled',updated_at=? WHERE bet_id=?").run(new Date().toISOString(),betId);addLedger(u.id,"BET_CANCEL",Number(b.stake),av,held,"Crash bet cancelled",betId,{roundId:b.round_id});db.exec("COMMIT");res.json({success:true,betId,wallet:{available:av,held,total:av+held}})}catch(e){try{db.exec("ROLLBACK")}catch{};res.status(400).json({success:false,message:e.message||"Cancel failed"})}
});
app.get("/api/crash/:slug/status",userAuth,(req,res)=>{
  const roundId=safeText(req.query.roundId,120),round=db.prepare("SELECT * FROM crash_rounds WHERE round_id=? AND user_id=? AND game_slug=?").get(roundId,req.user.user_id,req.params.slug);if(!round)return res.status(404).json({success:false,message:"Round not found"});const st=finalizeCrashRound(round);if(st.state==="FLY")db.prepare("UPDATE crash_bets SET status='Active',updated_at=? WHERE round_id=? AND status='Queued'").run(new Date().toISOString(),roundId);res.json({success:true,roundId,startAt:Number(round.start_at),state:st.state,multiplier:st.multiplier,...(st.state==="CRASH"?{crashPoint:Number(round.crash_point)}:{})})
});
app.post("/api/crash/:slug/cashout",betLimit,userAuth,(req,res)=>{
  const betId=safeText(req.body.betId,120),b=db.prepare("SELECT b.*,r.start_at,r.crash_point,r.status round_status FROM crash_bets b JOIN crash_rounds r ON r.round_id=b.round_id WHERE b.bet_id=? AND b.user_id=? AND b.game_slug=?").get(betId,req.user.user_id,req.params.slug);if(!b)return res.status(404).json({success:false,message:"Bet not found"});if(!["Queued","Active"].includes(b.status))return res.status(409).json({success:false,message:"Bet is already settled"});const now=Date.now();if(now<Number(b.start_at))return res.status(409).json({success:false,message:"Round has not started"});const m=crashMultiplier(b.start_at,now);if(m>=Number(b.crash_point)){db.prepare("UPDATE crash_bets SET status='Lost',updated_at=? WHERE bet_id=?").run(new Date().toISOString(),betId);recordCrashHistory(b,`crash@${Number(b.crash_point).toFixed(2)}x`,0,{win:false,crashPoint:Number(b.crash_point),roundId:b.round_id});return res.status(409).json({success:false,message:`Crashed at ${Number(b.crash_point).toFixed(2)}x`,crashPoint:Number(b.crash_point)})}const cashX=Math.max(1,Math.floor(m*100)/100),payout=Math.floor(Number(b.stake)*cashX);db.exec("BEGIN IMMEDIATE");try{const u=db.prepare("SELECT * FROM users WHERE id=?").get(b.user_id),av=Number(u.available_balance)+payout,held=Number(u.held_balance||0);db.prepare("UPDATE users SET available_balance=? WHERE id=?").run(av,u.id);db.prepare("UPDATE crash_bets SET status='CashedOut',payout=?,cashout_multiplier=?,updated_at=? WHERE bet_id=?").run(payout,cashX,new Date().toISOString(),betId);addLedger(u.id,"WIN",payout,av,held,`${req.params.slug} cashout ${cashX.toFixed(2)}x`,betId,{roundId:b.round_id,multiplier:cashX});const saved={...b,history_recorded:0};recordCrashHistory(saved,`cashout@${cashX.toFixed(2)}x`,payout,{win:true,multiplier:cashX,roundId:b.round_id});db.exec("COMMIT");res.json({success:true,betId,multiplier:cashX,payout,wallet:{available:av,held,total:av+held}})}catch(e){try{db.exec("ROLLBACK")}catch{};res.status(400).json({success:false,message:e.message||"Cashout failed"})}
});

app.get("/api/bets",userAuth,(req,res)=>{const rows=db.prepare("SELECT id,game_slug,stake,outcome,payout,details_json,created_at FROM bets WHERE user_id=? ORDER BY id DESC LIMIT 100").all(req.user.user_id).map(x=>({...x,details:JSON.parse(x.details_json||"{}")}));res.json({success:true,rows})});

app.get("/api/notifications",userAuth,(req,res)=>{const rows=db.prepare("SELECT id,title,message,type,is_read,created_at FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 100").all(req.user.user_id);res.json({success:true,rows,unread:rows.filter(x=>!x.is_read).length})});
app.post("/api/notifications/read",userAuth,(req,res)=>{db.prepare("UPDATE notifications SET is_read=1 WHERE user_id=?").run(req.user.user_id);res.json({success:true})});
app.post("/api/notifications/:id/read",userAuth,(req,res)=>{db.prepare("UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?").run(Number(req.params.id),req.user.user_id);res.json({success:true})});
app.delete("/api/notifications/:id",userAuth,(req,res)=>{db.prepare("DELETE FROM notifications WHERE id=? AND user_id=?").run(Number(req.params.id),req.user.user_id);res.json({success:true})});
app.post("/api/support",userAuth,(req,res)=>{const subject=safeText(req.body.subject,120),message=safeText(req.body.message,1200);if(subject.length<3||message.length<5)return res.status(400).json({success:false,message:"Write a subject and message"});const now=new Date().toISOString(),r=db.prepare("INSERT INTO support_tickets(user_id,subject,message,status,created_at,updated_at) VALUES(?,?,?,?,?,?)").run(req.user.user_id,subject,message,"Open",now,now);res.json({success:true,ticketId:Number(r.lastInsertRowid)})});
app.get("/api/support",userAuth,(req,res)=>res.json({success:true,rows:db.prepare("SELECT id,subject,message,status,created_at,updated_at FROM support_tickets WHERE user_id=? ORDER BY id DESC").all(req.user.user_id)}));

// ---------- ADMIN ----------
app.post("/api/admin/login",adminLimit,(req,res)=>{if(String(req.body.pin||"")!==ADMIN_PIN)return res.status(401).json({success:false,message:"Wrong admin PIN"});const token=crypto.randomBytes(24).toString("hex");adminSessions.set(token,{expires:Date.now()+6*60*60e3});audit("ADMIN_LOGIN",{ip:req.ip});res.json({success:true,token})});
app.get("/api/admin/dashboard",adminAuth,(req,res)=>{const q=s=>Number(db.prepare(s).get().n||0);res.json({success:true,stats:{users:q("SELECT COUNT(*) n FROM users"),bets:q("SELECT COUNT(*) n FROM bets"),wagered:q("SELECT COALESCE(SUM(stake),0) n FROM bets"),openTickets:q("SELECT COUNT(*) n FROM support_tickets WHERE status!='Closed'"),pendingDeposits:q("SELECT COUNT(*) n FROM deposits WHERE status='Pending'"),pendingWithdrawals:q("SELECT COUNT(*) n FROM withdrawals WHERE status='Pending'"),games:q("SELECT COUNT(*) n FROM games WHERE deleted=0")}})});
app.get("/api/admin/users",adminAuth,(req,res)=>res.json({success:true,rows:db.prepare("SELECT id,name,phone,available_balance,held_balance,created_at FROM users ORDER BY id DESC LIMIT 500").all()}));
app.post("/api/admin/users/:id/adjust",adminAuth,(req,res)=>{const amount=Number(req.body.amount),note=safeText(req.body.note,160)||"Admin adjustment";if(!Number.isInteger(amount)||amount===0||Math.abs(amount)>100000)return res.status(400).json({success:false,message:"Enter a valid whole-number adjustment"});db.exec("BEGIN IMMEDIATE");try{const u=db.prepare("SELECT * FROM users WHERE id=?").get(Number(req.params.id));if(!u){db.exec("ROLLBACK");return res.status(404).json({success:false,message:"User not found"})}const av=Number(u.available_balance)+amount;if(av<0){db.exec("ROLLBACK");return res.status(400).json({success:false,message:"Available balance cannot go below zero"})}db.prepare("UPDATE users SET available_balance=? WHERE id=?").run(av,u.id);addLedger(u.id,"ADMIN",amount,av,Number(u.held_balance),note);audit("BALANCE_ADJUST",{userId:u.id,amount,note});notify(u.id,"Balance updated",`${amount>0?"+":""}${amount} credits.`,"info");db.exec("COMMIT");res.json({success:true,wallet:{available:av,held:Number(u.held_balance),total:av+Number(u.held_balance)}})}catch(e){try{db.exec("ROLLBACK")}catch{};res.status(500).json({success:false,message:"Adjustment failed"})}});

app.get("/api/admin/payments",adminAuth,(req,res)=>{const deposits=db.prepare(`SELECT d.*,u.name,u.phone FROM deposits d JOIN users u ON u.id=d.user_id ORDER BY d.id DESC LIMIT 300`).all(),withdrawals=db.prepare(`SELECT w.*,u.name,u.phone FROM withdrawals w JOIN users u ON u.id=w.user_id ORDER BY w.id DESC LIMIT 300`).all();res.json({success:true,deposits,withdrawals,limits:limits(),payment:paymentSettings()})});
app.patch("/api/admin/settings/payment",adminAuth,(req,res)=>{
  const normalizeEnabled=v=>v===false||v===0||v==="0"?0:1;
  const cleanNumber=v=>String(v||"").replace(/\D/g,"").slice(0,11);

  const bkashEnabled=normalizeEnabled(req.body.bkashEnabled);
  const nagadEnabled=normalizeEnabled(req.body.nagadEnabled);
  const bkashNumber=cleanNumber(req.body.bkashNumber);
  const nagadNumber=cleanNumber(req.body.nagadNumber);

  if(bkashEnabled&&!/^01\d{9}$/.test(bkashNumber))return res.status(400).json({success:false,message:"Enter a valid 11-digit bKash number"});
  if(nagadEnabled&&!/^01\d{9}$/.test(nagadNumber))return res.status(400).json({success:false,message:"Enter a valid 11-digit Nagad number"});

  setSetting("bkash_enabled",bkashEnabled);setSetting("bkash_number",bkashNumber);
  setSetting("nagad_enabled",nagadEnabled);setSetting("nagad_number",nagadNumber);

  audit("PAYMENT_SETTINGS_UPDATE",{
    bkashEnabled:Boolean(bkashEnabled),
    bkashNumber:bkashNumber?`${bkashNumber.slice(0,4)}***${bkashNumber.slice(-3)}`:"",
    nagadEnabled:Boolean(nagadEnabled),
    nagadNumber:nagadNumber?`${nagadNumber.slice(0,4)}***${nagadNumber.slice(-3)}`:""
  });
  res.json({success:true,payment:paymentSettings()})
});

app.patch("/api/admin/deposits/:txId",adminAuth,(req,res)=>{const status=String(req.body.status||""),adminNote=safeText(req.body.adminNote,200);if(!["Approved","Rejected"].includes(status))return res.status(400).json({success:false,message:"Invalid status"});db.exec("BEGIN IMMEDIATE");try{const d=db.prepare("SELECT * FROM deposits WHERE tx_id=?").get(req.params.txId);if(!d){db.exec("ROLLBACK");return res.status(404).json({success:false,message:"Request not found"})}if(d.status!=="Pending"){db.exec("ROLLBACK");return res.status(409).json({success:false,message:"Request already finalized"})}const now=new Date().toISOString();if(status==="Approved"){const u=db.prepare("SELECT * FROM users WHERE id=?").get(d.user_id),av=Number(u.available_balance)+Number(d.amount);db.prepare("UPDATE users SET available_balance=? WHERE id=?").run(av,u.id);addLedger(u.id,"DEPOSIT",Number(d.amount),av,Number(u.held_balance),"Deposit approved",d.tx_id);notify(u.id,"Deposit approved",`${d.amount} credits added to your balance.`,"success")}else notify(d.user_id,"Deposit rejected",adminNote||"Your request was rejected.","warning");db.prepare("UPDATE deposits SET status=?,admin_note=?,updated_at=? WHERE tx_id=?").run(status,adminNote,now,d.tx_id);audit("DEPOSIT_STATUS",{txId:d.tx_id,status,amount:d.amount,userId:d.user_id});db.exec("COMMIT");res.json({success:true})}catch(e){try{db.exec("ROLLBACK")}catch{};res.status(500).json({success:false,message:"Update failed"})}});
app.patch("/api/admin/withdrawals/:txId",adminAuth,(req,res)=>{const status=String(req.body.status||""),adminNote=safeText(req.body.adminNote,200);if(!["Approved","Rejected"].includes(status))return res.status(400).json({success:false,message:"Invalid status"});db.exec("BEGIN IMMEDIATE");try{const w=db.prepare("SELECT * FROM withdrawals WHERE tx_id=?").get(req.params.txId);if(!w){db.exec("ROLLBACK");return res.status(404).json({success:false,message:"Request not found"})}if(w.status!=="Pending"){db.exec("ROLLBACK");return res.status(409).json({success:false,message:"Request already finalized"})}const u=db.prepare("SELECT * FROM users WHERE id=?").get(w.user_id),amount=Number(w.amount);if(Number(u.held_balance)<amount)throw new Error("Held balance is inconsistent");let av=Number(u.available_balance),held=Number(u.held_balance)-amount;if(status==="Rejected"){av+=amount;db.prepare("UPDATE users SET available_balance=?,held_balance=? WHERE id=?").run(av,held,u.id);addLedger(u.id,"WITHDRAW_RELEASE",amount,av,held,"Withdrawal hold released",w.tx_id);notify(u.id,"Withdrawal rejected",adminNote||"Held credits were returned to your available balance.","warning")}else{db.prepare("UPDATE users SET held_balance=? WHERE id=?").run(held,u.id);addLedger(u.id,"WITHDRAWAL",-amount,av,held,"Withdrawal approved",w.tx_id);notify(u.id,"Withdrawal approved",`${amount} held credits were finalized.`,"success")}db.prepare("UPDATE withdrawals SET status=?,admin_note=?,updated_at=? WHERE tx_id=?").run(status,adminNote,new Date().toISOString(),w.tx_id);audit("WITHDRAW_STATUS",{txId:w.tx_id,status,amount,userId:w.user_id});db.exec("COMMIT");res.json({success:true})}catch(e){try{db.exec("ROLLBACK")}catch{};res.status(500).json({success:false,message:e.message||"Update failed"})}});
app.patch("/api/admin/settings/limits",adminAuth,(req,res)=>{const keys={minDeposit:"min_deposit",maxDeposit:"max_deposit",minWithdraw:"min_withdraw",maxWithdraw:"max_withdraw",dailyWithdraw:"daily_withdraw"};for(const [k,key] of Object.entries(keys)){if(req.body[k]!==undefined){const n=intAmount(req.body[k]);if(!n)return res.status(400).json({success:false,message:`Invalid ${k}`});setSetting(key,n)}}audit("LIMITS_UPDATE",limits());res.json({success:true,limits:limits()})});


app.get("/api/admin/content",adminAuth,(req,res)=>res.json({success:true,banners:db.prepare("SELECT * FROM banners ORDER BY sort_order,id").all(),promotions:db.prepare("SELECT * FROM promotions ORDER BY sort_order,id").all()}));
app.post("/api/admin/banners",adminAuth,(req,res)=>{const title=safeText(req.body.title,100),subtitle=safeText(req.body.subtitle,220),imageUrl=safeMediaUrl(req.body.imageUrl),sortOrder=Math.max(0,Number(req.body.sortOrder)||100),enabled=boolInt(req.body.enabled),now=new Date().toISOString();if(title.length<2)return res.status(400).json({success:false,message:"Banner title is required"});const r=db.prepare("INSERT INTO banners(title,subtitle,image_url,enabled,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").run(title,subtitle,imageUrl,enabled,sortOrder,now,now);res.json({success:true,id:Number(r.lastInsertRowid)})});
app.patch("/api/admin/banners/:id",adminAuth,(req,res)=>{const x=db.prepare("SELECT * FROM banners WHERE id=?").get(Number(req.params.id));if(!x)return res.status(404).json({success:false,message:"Banner not found"});db.prepare("UPDATE banners SET title=?,subtitle=?,image_url=?,enabled=?,sort_order=?,updated_at=? WHERE id=?").run(req.body.title===undefined?x.title:safeText(req.body.title,100),req.body.subtitle===undefined?x.subtitle:safeText(req.body.subtitle,220),req.body.imageUrl===undefined?x.image_url:safeMediaUrl(req.body.imageUrl),req.body.enabled===undefined?x.enabled:boolInt(req.body.enabled),req.body.sortOrder===undefined?x.sort_order:Math.max(0,Number(req.body.sortOrder)||0),new Date().toISOString(),x.id);res.json({success:true})});
app.delete("/api/admin/banners/:id",adminAuth,(req,res)=>{db.prepare("DELETE FROM banners WHERE id=?").run(Number(req.params.id));res.json({success:true})});

app.post("/api/admin/promotions",adminAuth,(req,res)=>{const title=safeText(req.body.title,100),subtitle=safeText(req.body.subtitle,220),badge=safeText(req.body.badge,12)||"🎁",sortOrder=Math.max(0,Number(req.body.sortOrder)||100),enabled=boolInt(req.body.enabled),now=new Date().toISOString();if(title.length<2)return res.status(400).json({success:false,message:"Promotion title is required"});const r=db.prepare("INSERT INTO promotions(title,subtitle,badge,enabled,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").run(title,subtitle,badge,enabled,sortOrder,now,now);res.json({success:true,id:Number(r.lastInsertRowid)})});
app.patch("/api/admin/promotions/:id",adminAuth,(req,res)=>{const x=db.prepare("SELECT * FROM promotions WHERE id=?").get(Number(req.params.id));if(!x)return res.status(404).json({success:false,message:"Promotion not found"});db.prepare("UPDATE promotions SET title=?,subtitle=?,badge=?,enabled=?,sort_order=?,updated_at=? WHERE id=?").run(req.body.title===undefined?x.title:safeText(req.body.title,100),req.body.subtitle===undefined?x.subtitle:safeText(req.body.subtitle,220),req.body.badge===undefined?x.badge:safeText(req.body.badge,12),req.body.enabled===undefined?x.enabled:boolInt(req.body.enabled),req.body.sortOrder===undefined?x.sort_order:Math.max(0,Number(req.body.sortOrder)||0),new Date().toISOString(),x.id);res.json({success:true})});
app.delete("/api/admin/promotions/:id",adminAuth,(req,res)=>{db.prepare("DELETE FROM promotions WHERE id=?").run(Number(req.params.id));res.json({success:true})});

app.post("/api/admin/notifications/broadcast",adminAuth,(req,res)=>{const title=safeText(req.body.title,100),message=safeText(req.body.message,500),type=["info","success","warning"].includes(req.body.type)?req.body.type:"info",phone=safeText(req.body.phone,20);if(title.length<2||message.length<2)return res.status(400).json({success:false,message:"Title and message are required"});const users=phone?db.prepare("SELECT id FROM users WHERE phone=?").all(phone):db.prepare("SELECT id FROM users").all();if(phone&&!users.length)return res.status(404).json({success:false,message:"User phone not found"});for(const u of users)notify(u.id,title,message,type);res.json({success:true,count:users.length})});


function cleanZipPath(name){return String(name||"").replace(/\\/g,"/").replace(/^\/+/,"")}
function zipDirname(name){const s=cleanZipPath(name),i=s.lastIndexOf("/");return i<0?"":s.slice(0,i+1)}
function stripPrefix(name,prefix){const s=cleanZipPath(name),p=cleanZipPath(prefix);return p&&s.startsWith(p)?s.slice(p.length):s}
function autoSlug(filename){
  const base=String(filename||"game").replace(/\.zip$/i,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,48);
  return validSlug(base)||`game-${Date.now()}`
}
function htmlTitle(text){const m=String(text||"").match(/<title[^>]*>([\s\S]*?)<\/title>/i);return safeText((m?.[1]||"").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim(),80)}
function humanizeSlug(slug){return slug.split("-").filter(Boolean).map(x=>x.charAt(0).toUpperCase()+x.slice(1)).join(" ")||"Imported Game"}
function detectEngine(text,filename=""){
  const s=(String(filename)+"\n"+String(text||"")).toLowerCase();
  if(/\b(crash|cashout|cash-out|aviator|skyrush|multiplier)\b/.test(s))return "crash";
  if(/\b(dice|roll dice|d6)\b/.test(s))return "dice";
  if(/\b(coin flip|heads|tails)\b/.test(s))return "coin";
  if(/\b(wheel|roulette|spin wheel)\b/.test(s))return "wheel";
  return "standalone"
}
function defaultConfigForEngine(engine){
  if(engine==="wheel")return{choices:[{key:"red",label:"Red",weight:5,payout:2},{key:"blue",label:"Blue",weight:5,payout:2},{key:"gold",label:"Gold",weight:2,payout:4}]};
  return{}
}
function pickAutoThumbnail(names){
  const imgs=names.filter(n=>/\.(png|jpe?g|webp|gif|svg)$/i.test(n));
  return imgs.find(n=>/(thumb|thumbnail|icon|cover|preview|logo)/i.test(n))||imgs[0]||""
}
function injectGameBridge(html){
  let out=String(html||"");
  // Remove duplicate platform bridge tags first so old installed games are repaired cleanly.
  out=out
    .replace(/<script[^>]+src=["']\/sdk\/takabazar-game-sdk\.js(?:\?[^"']*)?["'][^>]*><\/script>/ig,"")
    .replace(/<script[^>]+src=["']\/sdk\/takabazar-auto-bridge\.js(?:\?[^"']*)?["'][^>]*><\/script>/ig,"");
  const tag='<script src="/sdk/takabazar-game-sdk.js"></script><script src="/sdk/takabazar-auto-bridge.js"></script>';
  return /<head[^>]*>/i.test(out)?out.replace(/<head([^>]*)>/i,`<head$1>${tag}`):tag+out
}
function autoManifestFromZip(entries,fileName,manifestEntry,entryHtml){
  if(manifestEntry){
    const prefix=zipDirname(manifestEntry.entryName),raw=JSON.parse(manifestEntry.getData().toString("utf8"));
    const textParts=[];
    for(const e of entries){
      if(e.isDirectory)continue;const n=cleanZipPath(e.entryName);if(prefix&&!n.startsWith(prefix))continue;
      if(/\.(html|js|mjs|json)$/i.test(n)&&e.header?.size<1024*1024){try{textParts.push(e.getData().toString("utf8"))}catch{}}
    }
    const merged=textParts.join("\n").slice(0,3*1024*1024),slug=validSlug(raw.slug)||autoSlug(fileName);
    raw.slug=slug;raw.name=safeText(raw.name,80)||htmlTitle(entryHtml?.getData().toString("utf8")||"")||humanizeSlug(slug);
    raw.engine=SUPPORTED_ENGINES.includes(String(raw.engine||"").toLowerCase())?String(raw.engine).toLowerCase():detectEngine(merged,fileName);
    raw.version=safeText(raw.version,30)||"1.0.0";raw.category=safeText(raw.category,30)||"arcade";raw.icon=safeText(raw.icon,12)||(raw.engine==="crash"?"✈️":"🎮");
    raw.minBet=intAmount(raw.minBet)||1;raw.maxBet=intAmount(raw.maxBet)||1000;raw.description=safeText(raw.description,180)||"Auto-imported ZIP game";raw.config=raw.config&&typeof raw.config==="object"?raw.config:defaultConfigForEngine(raw.engine);
    raw.ui=raw.ui&&typeof raw.ui==="object"?raw.ui:{};
    if(!raw.ui.entry&&!raw.entry&&entryHtml)raw.ui.entry=stripPrefix(entryHtml.entryName,prefix);
    if(raw.ui?.entry)raw.ui.entry=stripPrefix(prefix+cleanZipPath(raw.ui.entry),prefix);else if(raw.entry)raw.entry=stripPrefix(prefix+cleanZipPath(raw.entry),prefix);
    if(raw.thumbnail&&!String(raw.thumbnail).startsWith("/game-assets/"))raw.thumbnail=stripPrefix(prefix+cleanZipPath(raw.thumbnail),prefix);
    return{manifest:normalizeManifest(raw),prefix,generated:false}
  }
  const prefix=zipDirname(entryHtml.entryName),normalized=stripPrefix(entryHtml.entryName,prefix);
  const textParts=[];
  for(const e of entries){
    if(e.isDirectory)continue;
    const n=cleanZipPath(e.entryName);
    if(!n.startsWith(prefix))continue;
    if(/\.(html|js|mjs|json)$/i.test(n)&&e.header?.size<1024*1024){try{textParts.push(e.getData().toString("utf8"))}catch{}}
  }
  const merged=textParts.join("\n").slice(0,3*1024*1024),slug=autoSlug(fileName),engine=detectEngine(merged,fileName),names=entries.filter(e=>!e.isDirectory&&cleanZipPath(e.entryName).startsWith(prefix)).map(e=>stripPrefix(e.entryName,prefix));
  const title=htmlTitle(entryHtml.getData().toString("utf8"))||humanizeSlug(slug),thumbnail=pickAutoThumbnail(names);
  return{manifest:{slug,name:title,engine,version:"1.0.0",category:"arcade",icon:engine==="crash"?"✈️":"🎮",description:"Auto-imported ZIP game",thumbnail,minBet:1,maxBet:1000,config:defaultConfigForEngine(engine),uiEntry:normalized,packageType:"auto",bridgeVersion:1},prefix,generated:true}
}
function normalizeManifest(raw){
  const slug=validSlug(raw.slug),name=safeText(raw.name,80),engine=String(raw.engine||"").toLowerCase(),
  version=safeText(raw.version,30)||"1.0.0",category=safeText(raw.category,30)||"arcade",
  icon=safeText(raw.icon,12)||"🎮",description=safeText(raw.description,180),
  minBet=intAmount(raw.minBet),maxBet=intAmount(raw.maxBet);
  let thumbnail=safeText(raw.thumbnail,180);
  const ui=raw.ui&&typeof raw.ui==="object"?raw.ui:{};
  const uiEntry=safeText(ui.entry||raw.entry||"",180).replace(/^\/+/,"");
  const bridgeVersion=Math.max(1,Math.min(1,Number(ui.bridgeVersion||1)||1));
  if(!slug||name.length<2)throw new Error("Invalid game name or slug");
  if(!SUPPORTED_ENGINES.includes(engine))throw new Error(`Engine must be: ${SUPPORTED_ENGINES.join(", ")}`);
  if(!minBet||!maxBet||maxBet<minBet||maxBet>100000)throw new Error("Invalid bet limits");
  if(uiEntry && (!/^[A-Za-z0-9._/-]+\.html$/i.test(uiEntry)||uiEntry.includes("..")))throw new Error("ui.entry must be a safe HTML file path");
  if(thumbnail && !thumbnail.startsWith("/game-assets/") && !/^(?:assets\/)?[A-Za-z0-9._/-]+\.(png|jpe?g|webp|gif|svg)$/i.test(thumbnail))throw new Error("thumbnail must point to an image inside the ZIP");
  if(thumbnail.includes(".."))throw new Error("Unsafe thumbnail path");
  const config=raw.config&&typeof raw.config==="object"?raw.config:{};
  if(engine==="wheel"||engine==="pick"){
    const choices=Array.isArray(config.choices)?config.choices:[];
    const maxChoices=engine==="pick"?50:12;
    if(choices.length<2||choices.length>maxChoices)throw new Error(`${engine} engine needs 2-${maxChoices} choices`);
    const seen=new Set();
    config.choices=choices.map(c=>{
      const key=safeText(c.key,30).toLowerCase(),label=safeText(c.label,40)||key,weight=Math.floor(Number(c.weight)),payout=Number(c.payout);
      if(!key||seen.has(key))throw new Error("Choice keys must be unique");
      if(!Number.isInteger(weight)||weight<1||weight>1000)throw new Error("Invalid choice weight");
      if(!Number.isFinite(payout)||payout<0||payout>1000)throw new Error("Invalid choice payout");
      seen.add(key);return {key,label,weight,payout};
    });
  }
  return{
    slug,name,engine,version,category,icon,description,thumbnail,minBet,maxBet,config,
    uiEntry,packageType:uiEntry?"universal":"engine",bridgeVersion
  }
}
function applyManifest(m){
  const now=new Date().toISOString(),ex=db.prepare("SELECT * FROM games WHERE slug=?").get(m.slug);
  if(!ex){
    db.prepare(`INSERT INTO games(slug,name,type,enabled,min_bet,max_bet,created_at,category,engine,publish_status,maintenance,version,icon,config_json,deleted,updated_at,test_passed,thumbnail,description,ui_entry,package_type,bridge_version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(m.slug,m.name,m.category,1,m.minBet,m.maxBet,now,m.category,m.engine,"test",0,m.version,m.icon,JSON.stringify(m.config||{}),0,now,0,m.thumbnail||"",m.description||"",m.uiEntry||"",m.packageType||"engine",m.bridgeVersion||1);
  }else{
    db.prepare("UPDATE games SET name=?,type=?,category=?,engine=?,min_bet=?,max_bet=?,version=?,icon=?,config_json=?,publish_status='test',maintenance=0,deleted=0,updated_at=?,test_passed=0,thumbnail=?,description=?,ui_entry=?,package_type=?,bridge_version=? WHERE slug=?")
      .run(m.name,m.category,m.category,m.engine,m.minBet,m.maxBet,m.version,m.icon,JSON.stringify(m.config||{}),now,m.thumbnail||"",m.description||"",m.uiEntry||"",m.packageType||"engine",m.bridgeVersion||1,m.slug);
  }
  db.prepare("INSERT OR REPLACE INTO game_versions(slug,version,manifest_json,created_at) VALUES(?,?,?,?)").run(m.slug,m.version,JSON.stringify(m),now);
  return !ex
}
app.get("/api/admin/games",adminAuth,(req,res)=>{const rows=db.prepare(`SELECT g.*,COUNT(b.id) plays,COALESCE(SUM(b.stake),0) wagered,COALESCE(SUM(b.payout),0) payout,COUNT(DISTINCT b.user_id) players FROM games g LEFT JOIN bets b ON b.game_slug=g.slug WHERE g.deleted=0 GROUP BY g.slug ORDER BY g.updated_at DESC,g.name`).all().map(x=>({...x,config:JSON.parse(x.config_json||"{}")}));res.json({success:true,rows,supportedEngines:SUPPORTED_ENGINES})});
app.post("/api/admin/games",adminAuth,(req,res)=>{try{const m=normalizeManifest(req.body);const created=applyManifest(m);audit("GAME_ADD",{slug:m.slug,version:m.version,created});res.json({success:true,slug:m.slug,status:"test"})}catch(e){res.status(400).json({success:false,message:e.message})}});
app.post("/api/admin/games/install",adminAuth,upload.single("package"),(req,res)=>{
  try{
    if(!req.file)return res.status(400).json({success:false,message:"Choose a ZIP package"});
    const zip=new AdmZip(req.file.buffer),entries=zip.getEntries();
    if(entries.length>500)throw new Error("ZIP contains too many files");
    if(entries.some(e=>{const n=cleanZipPath(e.entryName);return n.includes("..")||n.startsWith("/")}))throw new Error("Unsafe ZIP paths are not allowed");
    const totalSize=entries.reduce((n,e)=>n+(e.header?.size||0),0);
    if(totalSize>60*1024*1024)throw new Error("Uncompressed game package is too large");

    // game.json can be at root OR inside one normal folder. It is optional in V12.
    const manifestCandidates=entries.filter(e=>!e.isDirectory&&/(^|\/)game\.json$/i.test(cleanZipPath(e.entryName))).sort((a,b)=>a.entryName.split("/").length-b.entryName.split("/").length);
    const manifestEntry=manifestCandidates[0]||null;
    const htmlCandidates=entries.filter(e=>!e.isDirectory&&/(^|\/)index\.html?$/i.test(cleanZipPath(e.entryName))).sort((a,b)=>a.entryName.split("/").length-b.entryName.split("/").length);
    const entryHtml=htmlCandidates[0]||entries.filter(e=>!e.isDirectory&&/\.html?$/i.test(cleanZipPath(e.entryName))).sort((a,b)=>a.entryName.split("/").length-b.entryName.split("/").length)[0];
    if(!entryHtml&&!manifestEntry)throw new Error("No index.html or game.json found in this ZIP");

    const auto=autoManifestFromZip(entries,req.file.originalname,manifestEntry,entryHtml);
    let m=auto.manifest;
    const prefix=auto.prefix||"";

    // If a provided manifest did not specify UI, locate index.html automatically.
    if(!m.uiEntry&&entryHtml){m.uiEntry=stripPrefix(entryHtml.entryName,prefix);m.packageType="auto"}
    if(!m.uiEntry)throw new Error("No playable HTML entry found in this ZIP");

    const dangerous=/\.(exe|apk|aab|bat|cmd|com|dll|so|dylib|sh|bash|zsh|ps1|php|cgi|pl|py|rb|jar)$/i;
    const allowed=/\.(html?|css|js|mjs|json|png|jpe?g|webp|gif|svg|ico|mp3|ogg|wav|m4a|mp4|webm|wasm|woff2?|ttf|otf)$/i;
    const ignored=/\.(txt|md|pdf|docx?|xlsx?|pptx?|log)$/i;
    const copied=[];
    for(const entry of entries){
      if(entry.isDirectory)continue;
      const rawName=cleanZipPath(entry.entryName);
      if(manifestEntry&&rawName===cleanZipPath(manifestEntry.entryName))continue;
      if(prefix&&!rawName.startsWith(prefix))continue;
      const rel=stripPrefix(rawName,prefix);
      if(!rel||rel==="game.json")continue;
      if(dangerous.test(rel))throw new Error(`Blocked unsafe file: ${rel}`);
      if(ignored.test(rel)||/(^|\/)__MACOSX\//i.test(rawName)||/(^|\/)\.DS_Store$/i.test(rawName))continue;
      if(!allowed.test(rel))continue; // harmless unknown/docs are ignored instead of failing install
      copied.push({entry,rel})
    }
    if(!copied.some(x=>x.rel===m.uiEntry)){
      const byBase=copied.find(x=>x.rel.endsWith("/"+m.uiEntry)||x.rel===m.uiEntry);
      if(byBase)m.uiEntry=byBase.rel;else throw new Error(`HTML entry not found: ${m.uiEntry}`)
    }

    // Auto-detect engine for manifest packages that used standalone or omitted engine-like behavior.
    if(!SUPPORTED_ENGINES.includes(m.engine))m.engine="standalone";
    if(m.engine==="pick"&&(!Array.isArray(m.config?.choices)||m.config.choices.length<2))m.engine="standalone";

    const assetDir=path.join(GAME_ASSET_ROOT,m.slug,m.version);
    fs.rmSync(assetDir,{recursive:true,force:true});fs.mkdirSync(assetDir,{recursive:true});
    for(const {entry,rel} of copied){
      const target=path.resolve(assetDir,rel);
      if(target!==assetDir&&!target.startsWith(assetDir+path.sep))throw new Error("Unsafe asset path");
      fs.mkdirSync(path.dirname(target),{recursive:true});
      let data=entry.getData();
      if(rel===m.uiEntry&&/\.html?$/i.test(rel))data=Buffer.from(injectGameBridge(data.toString("utf8")),"utf8");
      fs.writeFileSync(target,data)
    }

    if(m.thumbnail&&!m.thumbnail.startsWith("/game-assets/")){
      let rel=cleanZipPath(m.thumbnail).replace(/^\.\//,"");
      if(!copied.some(x=>x.rel===rel)){const autoThumb=pickAutoThumbnail(copied.map(x=>x.rel));rel=autoThumb||""}
      if(rel)m.thumbnail=`/game-assets/${encodeURIComponent(m.slug)}/${encodeURIComponent(m.version)}/${rel.split("/").map(encodeURIComponent).join("/")}`;else m.thumbnail=""
    }
    m.uiEntry=`/game-assets/${encodeURIComponent(m.slug)}/${encodeURIComponent(m.version)}/${m.uiEntry.split("/").map(encodeURIComponent).join("/")}`;
    m.packageType=auto.generated?"auto":(m.packageType||"universal");

    applyManifest(m);
    // V12 one-step flow: safe static validation is the test; publish immediately.
    db.prepare("UPDATE games SET test_passed=1,publish_status='published',enabled=1,maintenance=0,updated_at=? WHERE slug=?").run(new Date().toISOString(),m.slug);
    audit("GAME_AUTO_IMPORT",{slug:m.slug,version:m.version,file:req.file.originalname,engine:m.engine,generatedManifest:auto.generated,packageType:m.packageType});
    res.json({success:true,slug:m.slug,name:m.name,version:m.version,status:"published",engine:m.engine,packageType:m.packageType,generatedManifest:auto.generated,next:"Ready to play"});
  }catch(e){res.status(400).json({success:false,message:e.message||"Game ZIP install failed"})}
});
app.patch("/api/admin/games/:slug",adminAuth,(req,res)=>{
  const g=getGame(req.params.slug);if(!g)return res.status(404).json({success:false,message:"Game not found"});
  const enabled=req.body.enabled===undefined?g.enabled:(req.body.enabled?1:0),
  maintenance=req.body.maintenance===undefined?g.maintenance:(req.body.maintenance?1:0),
  publishStatus=["test","published","hidden"].includes(req.body.publishStatus)?req.body.publishStatus:g.publish_status,
  minBet=req.body.minBet===undefined?g.min_bet:intAmount(req.body.minBet),
  maxBet=req.body.maxBet===undefined?g.max_bet:intAmount(req.body.maxBet),
  name=req.body.name===undefined?g.name:safeText(req.body.name,80),
  category=req.body.category===undefined?g.category:safeText(req.body.category,30),
  icon=req.body.icon===undefined?g.icon:safeText(req.body.icon,12),
  description=req.body.description===undefined?g.description:safeText(req.body.description,180),
  thumbnail=req.body.thumbnail===undefined?g.thumbnail:safeMediaUrl(req.body.thumbnail),
  featured=req.body.featured===undefined?g.featured:boolInt(req.body.featured),
  badge=req.body.badge===undefined?g.badge:safeText(req.body.badge,20),
  sortOrder=req.body.sortOrder===undefined?g.sort_order:Math.max(0,Number(req.body.sortOrder)||0);
  if(!minBet||!maxBet||maxBet<minBet)return res.status(400).json({success:false,message:"Invalid limits"});
  if(publishStatus==="published"&&!Number(g.test_passed))return res.status(409).json({success:false,message:"Run a successful Test before publishing this version"});
  db.prepare("UPDATE games SET enabled=?,maintenance=?,publish_status=?,min_bet=?,max_bet=?,name=?,category=?,icon=?,description=?,thumbnail=?,featured=?,badge=?,sort_order=?,updated_at=? WHERE slug=?")
    .run(enabled,maintenance,publishStatus,minBet,maxBet,name,category,icon,description,thumbnail,featured,badge,sortOrder,new Date().toISOString(),g.slug);
  audit("GAME_UPDATE",{slug:g.slug,enabled,maintenance,publishStatus,minBet,maxBet});
  res.json({success:true})
});

app.post("/api/admin/games/:slug/open-internal-admin",adminAuth,(req,res)=>{
  const g=getGame(req.params.slug);
  if(!g)return res.status(404).json({success:false,message:"Game not found"});
  let config={};try{config=JSON.parse(g.config_json||"{}")}catch{}
  audit("GAME_INTERNAL_ADMIN_OPEN",{slug:g.slug,packageType:g.package_type,engine:g.engine});
  res.json({success:true,game:{
    slug:g.slug,name:g.name,category:g.category,engine:g.engine,enabled:g.enabled,maintenance:g.maintenance,
    min_bet:g.min_bet,max_bet:g.max_bet,publish_status:g.publish_status,version:g.version,
    icon:g.icon,thumbnail:g.thumbnail,description:g.description,ui_entry:g.ui_entry,
    package_type:g.package_type,bridge_version:g.bridge_version,config
  }})
});

// Demo-only crash admin control.
// Requires BOTH authenticated TakaBazar Admin and the currently logged-in user.
// It can only force the current user's own crash round.
app.post("/api/admin/games/:slug/demo-force-crash",adminAuth,userAuth,(req,res)=>{
  if(!DEMO_ADMIN_CONTROLS){
    return res.status(403).json({success:false,message:"Demo admin controls are disabled"});
  }

  const game=getGame(req.params.slug);
  if(!game)return res.status(404).json({success:false,message:"Game not found"});
  if(game.engine!=="crash")return res.status(400).json({success:false,message:"This control is only for crash games"});
  if(req.body?.confirmDemo!==true)return res.status(400).json({success:false,message:"Demo confirmation required"});

  const roundId=safeText(req.body?.roundId,120);
  if(!roundId)return res.status(400).json({success:false,message:"No active crash round"});

  const round=db.prepare(
    "SELECT * FROM crash_rounds WHERE round_id=? AND user_id=? AND game_slug=?"
  ).get(roundId,req.user.user_id,game.slug);

  if(!round)return res.status(404).json({success:false,message:"Active demo round not found"});

  const st=crashRoundState(round);
  if(st.state!=="FLY"){
    return res.status(409).json({
      success:false,
      message:st.state==="WAIT"?"Round has not started yet":"Round already crashed",
      state:st.state
    });
  }

  const forcedAt=Math.max(1.01,Math.floor(Number(st.multiplier||1.01)*100)/100);

  db.prepare(
    "UPDATE crash_rounds SET crash_point=? WHERE round_id=? AND user_id=? AND game_slug=?"
  ).run(forcedAt,roundId,req.user.user_id,game.slug);

  const fresh=db.prepare(
    "SELECT * FROM crash_rounds WHERE round_id=? AND user_id=? AND game_slug=?"
  ).get(roundId,req.user.user_id,game.slug);

  const finalState=finalizeCrashRound(fresh);

  audit("DEMO_FORCE_CRASH",{
    slug:game.slug,
    roundId,
    userId:req.user.user_id,
    crashPoint:forcedAt,
    demo:true
  });

  res.json({
    success:true,
    demo:true,
    roundId,
    state:finalState.state,
    crashPoint:forcedAt,
    multiplier:forcedAt
  });
});

app.post("/api/admin/games/:slug/test",adminAuth,(req,res)=>{
  try{
    const g=getGame(req.params.slug);if(!g)return res.status(404).json({success:false,message:"Game not found"});
    if(g.engine==="crash"){
      const cp=secureCrashPoint(),start=Date.now()-3500,m=crashMultiplier(start,Date.now());
      if(!(cp>=1.01&&m>=1))throw new Error("Crash session self-test failed");
      db.prepare("UPDATE games SET test_passed=1,updated_at=? WHERE slug=?").run(new Date().toISOString(),g.slug);
      audit("GAME_TEST_PASS",{slug:g.slug,version:g.version,engine:"crash"});
      return res.json({success:true,outcome:"crash-session-ready",multiplier:m,details:{serverAuthoritative:true},testPassed:true})
    }
    if(g.engine==="standalone"){
      if(!g.ui_entry)throw new Error("Standalone game has no HTML entry");
      db.prepare("UPDATE games SET test_passed=1,updated_at=? WHERE slug=?").run(new Date().toISOString(),g.slug);
      audit("GAME_TEST_PASS",{slug:g.slug,version:g.version,engine:"standalone"});
      return res.json({success:true,outcome:"ui-ready",multiplier:1,details:{walletBridgeAvailable:true},testPassed:true})
    }
    const body={...req.body};
    if(body.guess===undefined){
      if(g.engine==="coin")body.guess="heads";
      else if(g.engine==="dice")body.guess=1;
      else if(g.engine==="wheel"||g.engine==="pick"){let c={};try{c=JSON.parse(g.config_json||"{}")}catch{};body.guess=c.choices?.[0]?.key||"red"}
    }
    const result=playGame(g,body);
    db.prepare("UPDATE games SET test_passed=1,updated_at=? WHERE slug=?").run(new Date().toISOString(),g.slug);
    audit("GAME_TEST_PASS",{slug:g.slug,version:g.version});
    res.json({success:true,outcome:result.outcome,multiplier:result.multiplier,details:result.details,testPassed:true})
  }catch(e){res.status(400).json({success:false,message:e.message})}
});
app.post("/api/admin/games/:slug/rollback",adminAuth,(req,res)=>{const g=getGame(req.params.slug);if(!g)return res.status(404).json({success:false,message:"Game not found"});const rows=db.prepare("SELECT * FROM game_versions WHERE slug=? ORDER BY id DESC").all(g.slug),prev=rows.find(x=>x.version!==g.version);if(!prev)return res.status(400).json({success:false,message:"No previous version available"});try{const m=normalizeManifest(JSON.parse(prev.manifest_json));applyManifest(m);audit("GAME_ROLLBACK",{slug:g.slug,from:g.version,to:m.version});res.json({success:true,version:m.version,status:"test"})}catch(e){res.status(400).json({success:false,message:e.message})}});
app.delete("/api/admin/games/:slug",adminAuth,(req,res)=>{const g=getGame(req.params.slug);if(!g)return res.status(404).json({success:false,message:"Game not found"});db.prepare("UPDATE games SET deleted=1,enabled=0,publish_status='hidden',updated_at=? WHERE slug=?").run(new Date().toISOString(),g.slug);audit("GAME_DELETE",{slug:g.slug});res.json({success:true})});

app.get("/api/admin/bets",adminAuth,(req,res)=>res.json({success:true,rows:db.prepare(`SELECT b.id,b.game_slug,b.stake,b.outcome,b.payout,b.created_at,u.name,u.phone FROM bets b JOIN users u ON u.id=b.user_id ORDER BY b.id DESC LIMIT 300`).all()}));
app.get("/api/admin/support",adminAuth,(req,res)=>res.json({success:true,rows:db.prepare(`SELECT t.id,t.subject,t.message,t.status,t.created_at,t.updated_at,u.name,u.phone FROM support_tickets t JOIN users u ON u.id=t.user_id ORDER BY t.id DESC LIMIT 300`).all()}));
app.patch("/api/admin/support/:id",adminAuth,(req,res)=>{const status=["Open","In Progress","Closed"].includes(req.body.status)?req.body.status:"Open";db.prepare("UPDATE support_tickets SET status=?,updated_at=? WHERE id=?").run(status,new Date().toISOString(),Number(req.params.id));audit("SUPPORT_STATUS",{ticketId:Number(req.params.id),status});res.json({success:true})});
app.get("/api/admin/audit",adminAuth,(req,res)=>res.json({success:true,rows:db.prepare("SELECT id,action,details_json,created_at FROM admin_audit ORDER BY id DESC LIMIT 300").all()}));

app.use("/game-assets",(req,res,next)=>{
  res.removeHeader("X-Frame-Options");
  res.setHeader("X-Content-Type-Options","nosniff");
  res.setHeader("Cross-Origin-Resource-Policy","same-site");
  if(/\.html$/i.test(req.path)){
    res.setHeader("Content-Security-Policy","default-src 'self' data: blob:; img-src 'self' data: blob:; media-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'");
  }
  next()
},express.static(GAME_ASSET_ROOT,{
  fallthrough:false,
  maxAge:"1d",
  setHeaders(res,filePath){
    if(/\.html?$/i.test(filePath))res.setHeader("Cache-Control","no-store, max-age=0");
  }
}));
app.use(express.static("public",{extensions:["html"]}));
app.get("/{*splat}",(req,res)=>{if(req.path.startsWith("/api/"))return res.status(404).json({success:false,message:"API not found"});res.sendFile(new URL("./public/index.html",import.meta.url).pathname)});
app.use((err,req,res,next)=>{console.error(err);if(err?.code==="LIMIT_FILE_SIZE")return res.status(400).json({success:false,message:"ZIP package must be under 25 MB"});res.status(500).json({success:false,message:"Server error"})});
app.listen(PORT,()=>{console.log(`TakaBazar running on http://localhost:${PORT}`);if(process.env.ADMIN_PIN===undefined)console.warn("WARNING: change the default ADMIN_PIN before public deployment.")});
