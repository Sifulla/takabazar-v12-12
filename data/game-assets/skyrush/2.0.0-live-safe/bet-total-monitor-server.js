/**
 * SkyRush Aggregate Bet Monitor
 * Stores only aggregate/recent bet amounts.
 * No player identity, cashout, or personal activity.
 *
 * Endpoints:
 * POST /api/skyrush/bets
 * GET  /api/skyrush/bet-summary
 * GET  /api/skyrush/bet-live   (SSE)
 */

const http = require("http");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 3010);

let sessionTotal = 0;
let sessionCount = 0;
const daily = new Map(); // YYYY-MM-DD -> { total, count }
const clients = new Set();

function todayKey(date = new Date()){
  return date.toISOString().slice(0,10);
}

function round2(v){
  return Math.round(Number(v || 0) * 100) / 100;
}

function json(res, code, data){
  res.writeHead(code,{
    "Content-Type":"application/json; charset=utf-8",
    "Access-Control-Allow-Origin":"*",
    "Access-Control-Allow-Headers":"Content-Type",
    "Access-Control-Allow-Methods":"GET,POST,OPTIONS"
  });
  res.end(JSON.stringify(data));
}

function summary(){
  const key = todayKey();
  const d = daily.get(key) || {total:0,count:0};
  return {
    sessionTotal:round2(sessionTotal),
    sessionCount,
    todayTotal:round2(d.total),
    todayCount:d.count,
    date:key
  };
}

function broadcast(){
  const line = `data: ${JSON.stringify(summary())}\n\n`;
  for(const res of clients){
    try{ res.write(line); }
    catch(e){ clients.delete(res); }
  }
}

const server = http.createServer((req,res)=>{
  if(req.method === "OPTIONS"){
    res.writeHead(204,{
      "Access-Control-Allow-Origin":"*",
      "Access-Control-Allow-Headers":"Content-Type",
      "Access-Control-Allow-Methods":"GET,POST,OPTIONS"
    });
    return res.end();
  }

  const url = new URL(req.url,`http://${req.headers.host}`);

  if(req.method==="POST" && url.pathname==="/api/skyrush/bets"){
    let raw="";
    req.on("data",chunk=>{
      raw += chunk;
      if(raw.length > 20000) req.destroy();
    });

    req.on("end",()=>{
      try{
        const body=JSON.parse(raw||"{}");
        const amount=round2(body.amount);

        if(!Number.isFinite(amount) || amount<=0 || amount>100000000){
          return json(res,400,{success:false,error:"invalid_amount"});
        }

        sessionTotal=round2(sessionTotal+amount);
        sessionCount++;

        const key=todayKey();
        const d=daily.get(key) || {total:0,count:0};
        d.total=round2(d.total+amount);
        d.count++;
        daily.set(key,d);

        broadcast();
        return json(res,200,{success:true,...summary()});
      }catch(e){
        return json(res,400,{success:false,error:"bad_json"});
      }
    });
    return;
  }

  if(req.method==="GET" && url.pathname==="/api/skyrush/bet-summary"){
    return json(res,200,{success:true,...summary()});
  }

  if(req.method==="GET" && url.pathname==="/api/skyrush/bet-live"){
    res.writeHead(200,{
      "Content-Type":"text/event-stream",
      "Cache-Control":"no-cache",
      "Connection":"keep-alive",
      "Access-Control-Allow-Origin":"*"
    });
    clients.add(res);
    res.write(`data: ${JSON.stringify(summary())}\n\n`);
    req.on("close",()=>clients.delete(res));
    return;
  }

  json(res,404,{success:false,error:"not_found"});
});

server.listen(PORT,()=>{
  console.log(`SkyRush aggregate bet monitor: http://localhost:${PORT}`);
});
