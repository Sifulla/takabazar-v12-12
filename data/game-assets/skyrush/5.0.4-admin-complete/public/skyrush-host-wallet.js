/*
SkyRush Universal Host Wallet Adapter
=====================================
Use this on the HOST site page that embeds the game.

Your host website must provide:
- getBalance()
- debit(amount, meta)
- credit(amount, meta)

For production, these functions should call your own backend/database.
*/

window.SkyRushHostWallet = {
  mount({
    iframeId = "skyrushGame",
    currency = "BDT",
    getBalance,
    debit,
    credit
  }) {
    const iframe = document.getElementById(iframeId);
    if (!iframe) throw new Error("SkyRush iframe not found: " + iframeId);

    const send = (type, payload={}) => {
      iframe.contentWindow.postMessage({
        source: "SKYRUSH_HOST",
        type,
        ...payload
      }, "*");
    };

    const valid = (event) =>
      event.source === iframe.contentWindow &&
      event.data &&
      event.data.source === "SKYRUSH_GAME";

    window.addEventListener("message", async (event) => {
      if (!valid(event)) return;
      const d = event.data;

      if (d.type === "SKYRUSH_READY") {
        try{
          const balance = Number(await getBalance());
          send("SKYRUSH_INIT", {balance, currency});
        }catch(e){}
        return;
      }

      if (d.type === "SKYRUSH_BALANCE_REQUEST") {
        try{
          const balance = Number(await getBalance());
          send("SKYRUSH_WALLET_RESULT",{
            requestId:d.requestId, success:true, balance
          });
        }catch(e){
          send("SKYRUSH_WALLET_RESULT",{
            requestId:d.requestId, success:false, error:"balance_failed"
          });
        }
        return;
      }

      if (d.type === "SKYRUSH_DEBIT_REQUEST") {
        try{
          const r = await debit(Number(d.amount), d.meta || {});
          send("SKYRUSH_WALLET_RESULT",{
            requestId:d.requestId,
            success:r?.success !== false,
            balance:Number(r?.balance),
            error:r?.error || null
          });
        }catch(e){
          send("SKYRUSH_WALLET_RESULT",{
            requestId:d.requestId, success:false, error:"debit_failed"
          });
        }
        return;
      }

      if (d.type === "SKYRUSH_CREDIT_REQUEST") {
        try{
          const r = await credit(Number(d.amount), d.meta || {});
          send("SKYRUSH_WALLET_RESULT",{
            requestId:d.requestId,
            success:r?.success !== false,
            balance:Number(r?.balance),
            error:r?.error || null
          });
        }catch(e){
          send("SKYRUSH_WALLET_RESULT",{
            requestId:d.requestId, success:false, error:"credit_failed"
          });
        }
      }
    });

    return {
      refresh: async () => {
        const balance = Number(await getBalance());
        send("SKYRUSH_BALANCE_UPDATE",{balance});
      }
    };
  }
};
