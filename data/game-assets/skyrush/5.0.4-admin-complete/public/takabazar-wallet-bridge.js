/*
TakaBazar Wallet Bridge for SkyRush
===================================
Use this on the TakaBazar page that contains the SkyRush iframe.

The bridge looks for one of these host wallet objects:
- window.TakaBazarWallet
- window.TakaBazarGameSDK.wallet
- window.TakaBazarGameSDK
- window.SiteWallet

Required methods:
- getBalance()
- debit(amount, meta)
- credit(amount, meta)

If your TakaBazar uses different method names, edit ONLY resolveWallet().
*/
(function(){
  function resolveWallet(){
    const candidates=[
      window.TakaBazarWallet,
      window.TakaBazarGameSDK && window.TakaBazarGameSDK.wallet,
      window.TakaBazarGameSDK,
      window.SiteWallet
    ].filter(Boolean);

    for(const w of candidates){
      const getBalance=w.getBalance || w.balance;
      const debit=w.debit || w.subtract;
      const credit=w.credit || w.add;

      if(typeof getBalance==="function" &&
         typeof debit==="function" &&
         typeof credit==="function"){
        return {
          currency:w.currency || "BDT",
          getBalance:getBalance.bind(w),
          debit:debit.bind(w),
          credit:credit.bind(w)
        };
      }
    }
    return null;
  }

  window.connectSkyRushToTakaBazar=function({
    iframeId="skyrushGame",
    wallet=null
  }={}){
    const iframe=document.getElementById(iframeId);
    if(!iframe) throw new Error("SkyRush iframe not found: "+iframeId);

    const w=wallet || resolveWallet();
    if(!w) throw new Error(
      "TakaBazar wallet API not found. Provide getBalance/debit/credit."
    );

    const send=(type,payload={})=>{
      iframe.contentWindow.postMessage({
        source:"SKYRUSH_HOST",
        type,
        ...payload
      },"*");
    };

    window.addEventListener("message",async event=>{
      if(event.source!==iframe.contentWindow) return;
      const d=event.data||{};
      if(d.source!=="SKYRUSH_GAME") return;

      if(d.type==="SKYRUSH_READY"){
        const balance=Number(await w.getBalance());
        send("SKYRUSH_INIT",{balance,currency:w.currency||"BDT"});
        return;
      }

      if(d.type==="SKYRUSH_BALANCE_REQUEST"){
        try{
          const balance=Number(await w.getBalance());
          send("SKYRUSH_WALLET_RESULT",{
            requestId:d.requestId,
            success:true,
            balance
          });
        }catch(e){
          send("SKYRUSH_WALLET_RESULT",{
            requestId:d.requestId,
            success:false,
            error:"balance_failed"
          });
        }
        return;
      }

      if(d.type==="SKYRUSH_DEBIT_REQUEST"){
        try{
          const r=await w.debit(Number(d.amount),d.meta||{});
          const balance=Number(
            r && Number.isFinite(Number(r.balance))
              ? r.balance
              : await w.getBalance()
          );
          send("SKYRUSH_WALLET_RESULT",{
            requestId:d.requestId,
            success:!r || r.success!==false,
            balance,
            error:r && r.error || null
          });
        }catch(e){
          send("SKYRUSH_WALLET_RESULT",{
            requestId:d.requestId,
            success:false,
            error:"debit_failed"
          });
        }
        return;
      }

      if(d.type==="SKYRUSH_CREDIT_REQUEST"){
        try{
          const r=await w.credit(Number(d.amount),d.meta||{});
          const balance=Number(
            r && Number.isFinite(Number(r.balance))
              ? r.balance
              : await w.getBalance()
          );
          send("SKYRUSH_WALLET_RESULT",{
            requestId:d.requestId,
            success:!r || r.success!==false,
            balance,
            error:r && r.error || null
          });
        }catch(e){
          send("SKYRUSH_WALLET_RESULT",{
            requestId:d.requestId,
            success:false,
            error:"credit_failed"
          });
        }
      }
    });

    return {
      refresh:async()=>{
        const balance=Number(await w.getBalance());
        send("SKYRUSH_BALANCE_UPDATE",{balance});
        return balance;
      }
    };
  };
})();
