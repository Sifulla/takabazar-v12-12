/*
SkyRush ↔ TakaBazar V9 adapter
==============================
This file does NOT keep a second game balance.

Supported integration order:
1) A host-provided TakaBazarGameSDK with wallet methods.
2) Parent iframe wallet bridge (handled by the game itself).
3) Local fallback ONLY when opening index.html by itself for testing.

If your TakaBazar V9 exposes different wallet method names,
edit only this adapter file.
*/
(function () {
  const sdk = window.TakaBazarGameSDK || window.takaBazarGameSDK || null;
  if (!sdk) return;

  const wallet = sdk.wallet || sdk;

  const getFn =
    wallet.getBalance ||
    wallet.balance ||
    sdk.getBalance;

  const debitFn =
    wallet.debit ||
    wallet.subtract ||
    sdk.debit;

  const creditFn =
    wallet.credit ||
    wallet.add ||
    sdk.credit;

  if (
    typeof getFn !== "function" ||
    typeof debitFn !== "function" ||
    typeof creditFn !== "function"
  ) {
    return;
  }

  async function normalizeResult(result, fallbackBalance) {
    if (typeof result === "number") {
      return { success: true, balance: result };
    }
    if (result && typeof result === "object") {
      return {
        success: result.success !== false,
        balance:
          Number.isFinite(Number(result.balance))
            ? Number(result.balance)
            : fallbackBalance,
        error: result.error || null,
      };
    }
    return { success: true, balance: fallbackBalance };
  }

  window.SkyRushWallet = {
    currency: "BDT",

    async getBalance() {
      const value = await getFn.call(wallet);
      if (typeof value === "number") return value;
      if (value && Number.isFinite(Number(value.balance))) {
        return Number(value.balance);
      }
      return 0;
    },

    async debit(amount, meta) {
      const result = await debitFn.call(wallet, amount, meta);
      const current = await this.getBalance();
      return normalizeResult(result, current);
    },

    async credit(amount, meta) {
      const result = await creditFn.call(wallet, amount, meta);
      const current = await this.getBalance();
      return normalizeResult(result, current);
    },
  };
})();


/*
AGGREGATE BET MONITORING
------------------------
Forwards only accepted bet amounts to the backend.
No player identity or cashout activity is transmitted.
*/
window.SkyRushBetTotalMonitor = {
  mount({
    iframeId = "skyrushGame",
    endpoint = "/api/skyrush/bets"
  } = {}) {
    const iframe = document.getElementById(iframeId);
    if(!iframe) throw new Error("SkyRush iframe not found: "+iframeId);

    window.addEventListener("message", async (event) => {
      if(event.source !== iframe.contentWindow) return;
      const d = event.data || {};
      if(d.source !== "SKYRUSH_GAME" || d.type !== "SKYRUSH_BET_TOTAL_EVENT") return;

      const amount = Number(d.amount || 0);
      if(!Number.isFinite(amount) || amount <= 0) return;

      try{
        await fetch(endpoint,{
          method:"POST",
          headers:{"Content-Type":"application/json"},
          credentials:"include",
          body:JSON.stringify({
            amount,
            time:d.time || new Date().toISOString(),
            game:"skyrush"
          })
        });
      }catch(e){
        // Monitoring failure must never stop the game.
      }
    });

    return {mounted:true};
  }
};
