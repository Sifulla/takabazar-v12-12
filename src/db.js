import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { defaultManifest } from "./gameRegistry.js";

const DATA_DIR=path.resolve("data");fs.mkdirSync(DATA_DIR,{recursive:true});
export const db=new DatabaseSync(path.join(DATA_DIR,"takabazar.sqlite"));
db.exec("PRAGMA journal_mode=WAL;");db.exec("PRAGMA foreign_keys=ON;");db.exec("PRAGMA busy_timeout=5000;");

const hasTable=name=>Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name));
const columns=table=>hasTable(table)?db.prepare(`PRAGMA table_info(${table})`).all().map(x=>x.name):[];
const ensureColumn=(table,name,def)=>{if(!columns(table).includes(name))db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`)};

// Base tables are intentionally compatible with the earlier project.
db.exec(`
CREATE TABLE IF NOT EXISTS users(
 id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,phone TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,
 available_balance INTEGER NOT NULL DEFAULT 0,held_balance INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions(
 id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,token_hash TEXT NOT NULL UNIQUE,expires_at INTEGER NOT NULL,created_at TEXT NOT NULL,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS games(
 slug TEXT PRIMARY KEY,name TEXT NOT NULL,type TEXT NOT NULL DEFAULT 'arcade',enabled INTEGER NOT NULL DEFAULT 1,min_bet INTEGER NOT NULL DEFAULT 10,max_bet INTEGER NOT NULL DEFAULT 500,created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bets(
 id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,game_slug TEXT NOT NULL,stake INTEGER NOT NULL,outcome TEXT NOT NULL,payout INTEGER NOT NULL,details_json TEXT NOT NULL,created_at TEXT NOT NULL,
 FOREIGN KEY(user_id) REFERENCES users(id),FOREIGN KEY(game_slug) REFERENCES games(slug)
);
CREATE TABLE IF NOT EXISTS ledger(
 id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,type TEXT NOT NULL,amount INTEGER NOT NULL,balance_after INTEGER NOT NULL,note TEXT NOT NULL,created_at TEXT NOT NULL,
 FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS support_tickets(
 id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,subject TEXT NOT NULL,message TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'Open',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS admin_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,action TEXT NOT NULL,details_json TEXT NOT NULL,created_at TEXT NOT NULL);
`);

// Migrate earlier databases without deleting user data.
if(columns("users").includes("demo_balance")){
  ensureColumn("users","available_balance","INTEGER NOT NULL DEFAULT 0");
  ensureColumn("users","held_balance","INTEGER NOT NULL DEFAULT 0");
  db.exec("UPDATE users SET available_balance=demo_balance WHERE available_balance=0 AND demo_balance>0");
}else{
  ensureColumn("users","available_balance","INTEGER NOT NULL DEFAULT 0");ensureColumn("users","held_balance","INTEGER NOT NULL DEFAULT 0");
}
ensureColumn("users","payout_method","TEXT NOT NULL DEFAULT ''");
ensureColumn("users","payout_number","TEXT NOT NULL DEFAULT ''");
for(const [n,d] of [
["category","TEXT NOT NULL DEFAULT 'arcade'"],
["engine","TEXT NOT NULL DEFAULT 'coin'"],
["publish_status","TEXT NOT NULL DEFAULT 'published'"],
["maintenance","INTEGER NOT NULL DEFAULT 0"],
["version","TEXT NOT NULL DEFAULT '1.0.0'"],
["icon","TEXT NOT NULL DEFAULT '🎮'"],
["config_json","TEXT NOT NULL DEFAULT '{}'"],
["deleted","INTEGER NOT NULL DEFAULT 0"],
["updated_at","TEXT"],
["test_passed","INTEGER NOT NULL DEFAULT 0"],
["thumbnail","TEXT NOT NULL DEFAULT ''"],
["description","TEXT NOT NULL DEFAULT ''"],
["featured","INTEGER NOT NULL DEFAULT 0"],
["badge","TEXT NOT NULL DEFAULT ''"],
["sort_order","INTEGER NOT NULL DEFAULT 100"],
["ui_entry","TEXT NOT NULL DEFAULT ''"],
["package_type","TEXT NOT NULL DEFAULT 'engine'"],
["bridge_version","INTEGER NOT NULL DEFAULT 1"]
])ensureColumn("games",n,d);
db.exec("UPDATE games SET engine=type WHERE type IN ('coin','dice','wheel')");
db.exec("UPDATE games SET test_passed=1 WHERE publish_status='published'");
for(const [n,d] of [["held_after","INTEGER NOT NULL DEFAULT 0"],["ref_id","TEXT"],["meta_json","TEXT NOT NULL DEFAULT '{}'" ]])ensureColumn("ledger",n,d);

// New wallet/payment/game-manager tables.
db.exec(`
CREATE TABLE IF NOT EXISTS deposits(
 id INTEGER PRIMARY KEY AUTOINCREMENT,tx_id TEXT NOT NULL UNIQUE,user_id INTEGER NOT NULL,amount INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'Pending',note TEXT NOT NULL DEFAULT '',admin_note TEXT NOT NULL DEFAULT '',client_key TEXT UNIQUE,
 payment_method TEXT NOT NULL DEFAULT '',payment_number TEXT NOT NULL DEFAULT '',payment_ref TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS withdrawals(
 id INTEGER PRIMARY KEY AUTOINCREMENT,tx_id TEXT NOT NULL UNIQUE,user_id INTEGER NOT NULL,amount INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'Pending',note TEXT NOT NULL DEFAULT '',admin_note TEXT NOT NULL DEFAULT '',client_key TEXT UNIQUE,
 payout_method TEXT NOT NULL DEFAULT '',payout_number TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS notifications(
 id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,title TEXT NOT NULL,message TEXT NOT NULL,type TEXT NOT NULL DEFAULT 'info',is_read INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS game_versions(
 id INTEGER PRIMARY KEY AUTOINCREMENT,slug TEXT NOT NULL,version TEXT NOT NULL,manifest_json TEXT NOT NULL,created_at TEXT NOT NULL,
 UNIQUE(slug,version)
);
CREATE TABLE IF NOT EXISTS banners(
 id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT NOT NULL,subtitle TEXT NOT NULL DEFAULT '',image_url TEXT NOT NULL DEFAULT '',
 enabled INTEGER NOT NULL DEFAULT 1,sort_order INTEGER NOT NULL DEFAULT 100,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS promotions(
 id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT NOT NULL,subtitle TEXT NOT NULL DEFAULT '',badge TEXT NOT NULL DEFAULT '',
 enabled INTEGER NOT NULL DEFAULT 1,sort_order INTEGER NOT NULL DEFAULT 100,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS crash_rounds(
 round_id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,game_slug TEXT NOT NULL,start_at INTEGER NOT NULL,crash_point REAL NOT NULL,status TEXT NOT NULL DEFAULT 'WAIT',created_at TEXT NOT NULL,finished_at TEXT NOT NULL DEFAULT '',
 FOREIGN KEY(user_id) REFERENCES users(id),FOREIGN KEY(game_slug) REFERENCES games(slug)
);
CREATE TABLE IF NOT EXISTS crash_bets(
 bet_id TEXT PRIMARY KEY,round_id TEXT NOT NULL,user_id INTEGER NOT NULL,game_slug TEXT NOT NULL,panel INTEGER NOT NULL DEFAULT 1,stake INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'Queued',payout INTEGER NOT NULL DEFAULT 0,cashout_multiplier REAL NOT NULL DEFAULT 0,history_recorded INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 FOREIGN KEY(round_id) REFERENCES crash_rounds(round_id),FOREIGN KEY(user_id) REFERENCES users(id),FOREIGN KEY(game_slug) REFERENCES games(slug)
);
CREATE INDEX IF NOT EXISTS idx_crash_round_user_game ON crash_rounds(user_id,game_slug,created_at);
CREATE INDEX IF NOT EXISTS idx_crash_bet_round ON crash_bets(round_id,status);
`);
for(const [n,d] of [["payment_method","TEXT NOT NULL DEFAULT ''"],["payment_number","TEXT NOT NULL DEFAULT ''"],["payment_ref","TEXT NOT NULL DEFAULT ''"]])ensureColumn("deposits",n,d);
for(const [n,d] of [["payout_method","TEXT NOT NULL DEFAULT ''"],["payout_number","TEXT NOT NULL DEFAULT ''"]])ensureColumn("withdrawals",n,d);

const now=new Date().toISOString();
const setDefault=(key,value)=>db.prepare("INSERT OR IGNORE INTO settings(key,value,updated_at) VALUES(?,?,?)").run(key,String(value),now);
setDefault("min_deposit",50);setDefault("max_deposit",10000);setDefault("min_withdraw",150);setDefault("max_withdraw",5000);setDefault("daily_withdraw",10000);
setDefault("bkash_number","");setDefault("bkash_enabled","1");setDefault("nagad_number","");setDefault("nagad_enabled","1");
if(!db.prepare("SELECT id FROM banners LIMIT 1").get()){
  db.prepare("INSERT INTO banners(title,subtitle,image_url,enabled,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?)")
    .run("এক অ্যাকাউন্টে সবকিছু","নতুন গেম • সেন্ট্রাল ওয়ালেট • সহজ হিস্ট্রি","",1,10,now,now);
}
if(!db.prepare("SELECT id FROM promotions LIMIT 1").get()){
  db.prepare("INSERT INTO promotions(title,subtitle,badge,enabled,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?)")
    .run("রিওয়ার্ড সেন্টার","অ্যাকাউন্ট, মিশন ও নোটিফিকেশন একসাথে দেখুন","🎁",1,10,now,now);
}

const upsertSeed=(m)=>{
  const ex=db.prepare("SELECT slug FROM games WHERE slug=?").get(m.slug);
  if(!ex){db.prepare(`INSERT INTO games(slug,name,type,enabled,min_bet,max_bet,created_at,category,engine,publish_status,maintenance,version,icon,config_json,deleted,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(m.slug,m.name,m.category,1,m.minBet,m.maxBet,now,m.category,m.engine,"published",0,m.version,m.icon,JSON.stringify(m.config||{}),0,now)}
  else{
    db.prepare("UPDATE games SET engine=CASE WHEN engine='' OR engine IS NULL THEN ? ELSE engine END, icon=CASE WHEN icon='' OR icon IS NULL THEN ? ELSE icon END, updated_at=COALESCE(updated_at,?) WHERE slug=?").run(m.engine,m.icon,now,m.slug);
  }
  db.prepare("INSERT OR IGNORE INTO game_versions(slug,version,manifest_json,created_at) VALUES(?,?,?,?)").run(m.slug,m.version,JSON.stringify(m),now);
};
upsertSeed(defaultManifest("coin-flip","Coin Flip","coin","🪙",10,500));
upsertSeed(defaultManifest("dice-six","Dice Six","dice","🎲",10,300));
upsertSeed(defaultManifest("lucky-wheel","Lucky Wheel","wheel","🎡",10,400,"1.0.0","arcade",{choices:[{key:"red",label:"Red",weight:5,payout:2},{key:"blue",label:"Blue",weight:5,payout:2},{key:"gold",label:"Gold",weight:2,payout:4}]}));

export const getUserById=id=>db.prepare("SELECT id,name,phone,available_balance,held_balance,created_at FROM users WHERE id=?").get(id);
export const getGame=slug=>db.prepare("SELECT * FROM games WHERE slug=? AND deleted=0").get(slug);
export function audit(action,details={}){db.prepare("INSERT INTO admin_audit(action,details_json,created_at) VALUES(?,?,?)").run(action,JSON.stringify(details),new Date().toISOString())}
export function notify(userId,title,message,type="info"){db.prepare("INSERT INTO notifications(user_id,title,message,type,created_at) VALUES(?,?,?,?,?)").run(userId,title,message,type,new Date().toISOString())}
export function getSetting(key,fallback=""){const x=db.prepare("SELECT value FROM settings WHERE key=?").get(key);return x?.value??fallback}
export function getSettingInt(key,fallback=0){const x=db.prepare("SELECT value FROM settings WHERE key=?").get(key);const n=Number(x?.value);return Number.isFinite(n)?Math.floor(n):fallback}
export function setSetting(key,value){db.prepare("INSERT INTO settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").run(key,String(value),new Date().toISOString())}
export function addLedger(userId,type,amount,available,held,note,refId=null,meta={}){db.prepare("INSERT INTO ledger(user_id,type,amount,balance_after,held_after,note,ref_id,meta_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)").run(userId,type,amount,available,held,note,refId,JSON.stringify(meta||{}),new Date().toISOString())}
