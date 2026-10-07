/* SkyRush -> TakaBazar V11 adapter */
(function(){
  const sdk=window.TakaBazarGame;
  if(!sdk)return;
  window.SkyRushWallet={
    currency:"CREDITS",
    async getBalance(){const w=await sdk.getBalance();return Number(w?.available||0)},
    async debit(){return {success:false,error:"Use crash session bridge",balance:await this.getBalance()}},
    async credit(){return {success:false,error:"Use crash session bridge",balance:await this.getBalance()}}
  };
})();
