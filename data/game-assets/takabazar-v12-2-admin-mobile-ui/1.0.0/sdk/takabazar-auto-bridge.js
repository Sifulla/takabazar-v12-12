(() => {
  function sdk(){return window.TakaBazarGame}
  const api={
    ready:()=>sdk().ready(),
    getBalance:()=>sdk().getBalance(),
    balance:()=>sdk().getBalance(),
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
  window.TakaBazarWallet=api;
  window.GameWallet=api;
  window.walletAPI=api;
  window.TBWallet=api;
  window.addEventListener('DOMContentLoaded',()=>{
    sdk()?.ready?.().then(info=>window.dispatchEvent(new CustomEvent('takabazar:ready',{detail:info}))).catch(()=>{});
  });
})();
