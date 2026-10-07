import crypto from "node:crypto";

const weightedPick=items=>{
  const total=items.reduce((n,x)=>n+Math.max(1,Number(x.weight||1)),0);
  let r=crypto.randomInt(0,total);
  for(const x of items){r-=Math.max(1,Number(x.weight||1));if(r<0)return x}
  return items[items.length-1];
};

export const SUPPORTED_ENGINES=["coin","dice","wheel","pick","crash","standalone"];

export function playGame(game,body={}){
  const engine=String(game.engine||game.type||"");
  let config={};try{config=JSON.parse(game.config_json||"{}")||{}}catch{}
  if(engine==="coin"){
    const guess=String(body.guess||"").toLowerCase();
    if(!["heads","tails"].includes(guess))throw new Error("Choose heads or tails");
    const result=crypto.randomInt(0,2)===0?"heads":"tails";
    const win=guess===result;
    return {outcome:result,multiplier:win?2:0,details:{guess,result,win}};
  }
  if(engine==="dice"){
    const guess=Number(body.guess);
    if(!Number.isInteger(guess)||guess<1||guess>6)throw new Error("Choose a number from 1 to 6");
    const result=crypto.randomInt(1,7),win=guess===result;
    return {outcome:String(result),multiplier:win?6:0,details:{guess,result,win}};
  }
  if(engine==="wheel"){
    const choices=Array.isArray(config.choices)&&config.choices.length?config.choices:[
      {key:"red",label:"Red",weight:5,payout:2},
      {key:"blue",label:"Blue",weight:5,payout:2},
      {key:"gold",label:"Gold",weight:2,payout:4}
    ];
    const guess=String(body.guess||"").toLowerCase();
    if(!choices.some(x=>String(x.key).toLowerCase()===guess))throw new Error("Choose a wheel option");
    const picked=weightedPick(choices),result=String(picked.key).toLowerCase(),win=result===guess;
    return {outcome:result,multiplier:win?Number(picked.payout||0):0,details:{guess,result,win,label:picked.label||result}};
  }

  if(engine==="pick"){
    const choices=Array.isArray(config.choices)&&config.choices.length?config.choices:[];
    if(choices.length<2)throw new Error("Pick engine has no choices");
    const guess=String(body.guess||"").toLowerCase();
    if(!choices.some(x=>String(x.key).toLowerCase()===guess))throw new Error("Choose a valid option");
    const picked=weightedPick(choices),result=String(picked.key).toLowerCase(),win=result===guess;
    return {outcome:result,multiplier:win?Number(picked.payout||0):0,details:{guess,result,win,label:picked.label||result}};
  }
  if(engine==="crash")throw new Error("Crash games use the crash session API");
  if(engine==="standalone")throw new Error("Standalone games run in the sandboxed UI and do not use the generic bet endpoint");
  throw new Error("Unsupported game engine");
}

export function defaultManifest(slug,name,engine,icon,minBet,maxBet,version="1.0.0",category="arcade",config={}){
  return {slug,name,engine,icon,version,category,minBet,maxBet,config};
}
