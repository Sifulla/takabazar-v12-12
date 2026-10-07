import crypto from "node:crypto";

export function hashPassword(password){
  const salt=crypto.randomBytes(16).toString("hex");
  const hash=crypto.scryptSync(password,salt,64).toString("hex");
  return `${salt}:${hash}`;
}
export function verifyPassword(password,stored){
  try{
    const [salt,hex]=String(stored).split(":");
    const a=Buffer.from(hex,"hex"),b=crypto.scryptSync(password,salt,64);
    return a.length===b.length && crypto.timingSafeEqual(a,b);
  }catch{return false}
}
export const randomToken=()=>crypto.randomBytes(32).toString("hex");
export const tokenHash=t=>crypto.createHash("sha256").update(String(t)).digest("hex");
export function safeText(v,max=200){return String(v??"").replace(/[\u0000-\u001f\u007f]/g," ").trim().slice(0,max)}
export function bdPhone(v){const x=String(v??"").replace(/\D/g,"");return /^01\d{9}$/.test(x)?x:""}
export function intAmount(v){const n=Number(v);return Number.isInteger(n)&&n>0?n:0}
export function txId(prefix){return `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`}
export function validSlug(v){const s=String(v??"").toLowerCase().trim();return /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(s)?s:""}
