(() => {
  const state = {
    roundId: null,
    bets: new Map(),
    lastBalance: 0,
    trustedAdmin: false
  };

  function sdk(){ return window.TakaBazarGame }

  function number(v, fallback=0){
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function visible(el){
    if(!el) return false;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden";
  }

  function ensureFallbackBalance(){ return null; }

  function paintBalance(walletOrNumber){
    const value = typeof walletOrNumber === "object"
      ? number(walletOrNumber?.available ?? walletOrNumber?.balance)
      : number(walletOrNumber);

    state.lastBalance = Math.max(0,value);

    // Put the central TakaBazar balance into the GAME'S OWN balance component.
    // No extra TakaBazar balance chip is drawn over the game.
    const selectors = [
      "#balance",
      "#walletBalance",
      "#gameBalance",
      "#userBalance",
      "[data-balance]",
      "[data-wallet-balance]",
      ".balance b",
      ".balance strong",
      ".wallet-balance",
      ".user-balance",
      ".game-balance"
    ];

    for(const sel of selectors){
      document.querySelectorAll(sel).forEach(el=>{
        el.textContent = state.lastBalance.toLocaleString(undefined,{maximumFractionDigits:2});
      });
    }

    const detail={
      available:state.lastBalance,
      balance:state.lastBalance,
      currency:"BDT"
    };

    window.dispatchEvent(new CustomEvent("takabazar:balance",{detail}));

    try{
      window.postMessage({
        source:"TAKABAZAR_WALLET",
        type:"BALANCE_UPDATE",
        payload:detail
      },"*")
    }catch{}
  }

  async function currentBalance(){
    const w = await sdk().getBalance();
    paintBalance(w);
    return w;
  }

  async function crashRound(){
    if(state.roundId) return state.roundId;
    const r = await sdk().crashOpenRound();
    state.roundId = r.roundId;
    return state.roundId;
  }

  async function safeSkyRushDebit(amount, meta={}){
    const stake = Math.max(0,Math.floor(number(amount)));
    if(stake <= 0) return {success:false,error:"invalid_amount",balance:state.lastBalance};

    // For SkyRush/crash-style games, a "debit" means a real server crash bet.
    if(meta?.action === "bet" && typeof sdk().crashBet === "function"){
      try{
        const roundId = await crashRound();
        const panel = Math.max(1,Math.min(2,Number(meta.betPanel)||1));
        const r = await sdk().crashBet({roundId,stake,panel});
        state.bets.set(panel,r.betId);
        paintBalance(r.wallet);
        return {success:true,balance:number(r.wallet?.available),betId:r.betId,roundId};
      }catch(e){
        // If the old round already started, get a fresh round once and retry.
        state.roundId = null;
        try{
          const roundId = await crashRound();
          const panel = Math.max(1,Math.min(2,Number(meta.betPanel)||1));
          const r = await sdk().crashBet({roundId,stake,panel});
          state.bets.set(panel,r.betId);
          paintBalance(r.wallet);
          return {success:true,balance:number(r.wallet?.available),betId:r.betId,roundId};
        }catch(err){
          return {success:false,error:err?.message||e?.message||"bet_failed",balance:state.lastBalance};
        }
      }
    }

    // Never expose an arbitrary "subtract balance" primitive to an unknown ZIP.
    return {success:false,error:"unsupported_debit_use_platform_bet",balance:state.lastBalance};
  }

  async function safeSkyRushCredit(amount, meta={}){
    const panel = Math.max(1,Math.min(2,Number(meta.betPanel)||1));
    const betId = state.bets.get(panel);

    try{
      if(meta?.action === "bet_cancel" && betId){
        const r = await sdk().crashCancel({betId});
        state.bets.delete(panel);
        paintBalance(r.wallet);
        return {success:true,balance:number(r.wallet?.available)};
      }

      if(meta?.action === "cashout" && betId){
        // Claimed amount/payout from the game is ignored.
        // Server calculates the actual multiplier and payout.
        const r = await sdk().crashCashout({betId});
        state.bets.delete(panel);
        paintBalance(r.wallet);
        return {
          success:true,
          balance:number(r.wallet?.available),
          payout:number(r.payout),
          multiplier:number(r.multiplier,1)
        };
      }
    }catch(e){
      return {success:false,error:e?.message||"wallet_action_failed",balance:state.lastBalance};
    }

    return {success:false,error:"unsupported_credit_use_platform_settlement",balance:state.lastBalance};
  }

  const api = {
    ready:()=>sdk().ready(),
    getBalance:currentBalance,
    balance:currentBalance,
    bet:(stake,guess)=>sdk().bet({stake:Number(stake),guess}),
    placeBet:(stake,guess)=>sdk().bet({stake:Number(stake),guess}),
    crashOpen:()=>sdk().crashOpenRound(),
    crashBet:(roundId,stake,panel=1)=>sdk().crashBet({roundId,stake:Number(stake),panel}),
    crashCancel:betId=>sdk().crashCancel({betId}),
    crashStatus:roundId=>sdk().crashStatus({roundId}),
    cashOut:betId=>sdk().crashCashout({betId}),
    crashCashout:betId=>sdk().crashCashout({betId}),
    close:()=>sdk().close(),
    toast:m=>sdk().toast(m),
    on:(n,f)=>sdk().on(n,f)
  };

  // Common aliases used by imported ZIP games.
  window.TakaBazarWallet = api;
  window.GameWallet = api;
  window.walletAPI = api;
  window.TBWallet = api;

  // Compatibility for SkyRush "site wallet" editions.
  // Defined before the game scripts run because this bridge is injected in <head>.
  
  // Optional standard interface for future games.
  // A game may set window.TakaBazarNativeAdmin.open = () => its own admin panel.
  window.TakaBazarNativeAdmin = window.TakaBazarNativeAdmin || {
    open(){
      for(const name of [
        "openAdminPanel","showAdminPanel","openGameAdmin","showGameAdmin",
        "adminOpen","openControlPanel","showControlPanel","openControls","showControls"
      ]){
        if(typeof window[name]==="function"){ window[name](); return true; }
      }
      return false;
    }
  };

window.SkyRushWallet = {
    currency:"BDT",
    async getBalance(){
      const w = await currentBalance();
      return number(w?.available);
    },
    debit:safeSkyRushDebit,
    credit:safeSkyRushCredit,
    async sync(){
      const w = await currentBalance();
      return number(w?.available);
    }
  };

  function installDemoAdminCompatibility(){
    // Keep the game's original admin UI unchanged.
    // Only when the game was opened from authenticated TakaBazar Admin,
    // route its existing Force Crash button to the server-authoritative demo round.
    document.addEventListener("click",e=>{
      const btn=e.target?.closest?.("#forceCrashBtn,[data-force-crash],[data-admin-action='force-crash']");
      if(!btn||!state.trustedAdmin)return;

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      const msg=document.getElementById("adminPanelMsg");
      if(msg)msg.textContent="DEMO Force Crash processing...";

      try{
        parent.postMessage({
          source:"TAKABAZAR_GAME_ADMIN",
          type:"FORCE_CRASH_REQUEST"
        },"*")
      }catch{}
    },true);
  }

  function boot(){
    const s = sdk();
    if(!s) return;

    installDemoAdminCompatibility();

    s.on?.("balance",paintBalance);
    s.on?.("admin-force-crash-result",payload=>{
      const msg=document.getElementById("adminPanelMsg");
      if(msg){
        msg.textContent=payload?.success
          ? `DEMO crash at ${Number(payload.crashPoint||1).toFixed(2)}x`
          : String(payload?.message||"Force Crash failed");
      }
    });
    s.on?.("admin",payload=>{
      const detail=payload||{};
      if(!detail?.trusted||!detail?.open)return;
      state.trustedAdmin=true;

      // Only ask the game to open its OWN existing admin UI.
      // No game settings, round logic, balance logic or controls are rewritten here.
      const hooks=[
        "openAdminPanel",
        "showAdminPanel",
        "openGameAdmin",
        "showGameAdmin",
        "adminOpen",
        "openControlPanel",
        "showControlPanel",
        "openControls",
        "showControls"
      ];

      let opened=false,method="";
      for(const name of hooks){
        if(typeof window[name]==="function"){
          try{
            window[name]();
            opened=true;method=name;
            break
          }catch{}
        }
      }

      // Standard events for future/other game packages.
      try{
        window.dispatchEvent(new CustomEvent("takabazar:admin",{
          detail:{...detail,action:"open-native-admin"}
        }));
        window.postMessage({
          source:"TAKABAZAR_ADMIN",
          type:"OPEN_NATIVE_ADMIN",
          payload:{...detail,action:"open-native-admin"}
        },"*");
      }catch{}

      // Discover, but do not modify, game-native admin/control hooks.
      const availableHooks=hooks.filter(name=>typeof window[name]==="function");
      try{
        parent.postMessage({
          source:"TAKABAZAR_GAME_ADMIN",
          type:"OPEN_RESULT",
          opened,
          method,
          availableHooks
        },"*");
      }catch{}
    });


    s.ready?.().then(info=>{
      paintBalance(info?.wallet||{});
      window.dispatchEvent(new CustomEvent("takabazar:ready",{detail:info}));
    }).catch(()=>{});

    // Repaint after the imported game builds/replaces its header.
    setTimeout(()=>paintBalance(state.lastBalance),700);
    setTimeout(()=>paintBalance(state.lastBalance),1800);
  }

  if(document.readyState === "loading") window.addEventListener("DOMContentLoaded",boot,{once:true});
  else boot();
})();