(() => {
  const pending = new Map();
  const listeners = new Map();
  let seq = 0;
  let initData = null;

  function emit(name, payload) {
    (listeners.get(name) || []).forEach(fn => {
      try { fn(payload); } catch {}
    });
  }
  function request(type, payload = {}) {
    const id = `tb_${Date.now()}_${++seq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("Platform response timeout"));
      }, 15000);
      pending.set(id, { resolve, reject, timer });
      parent.postMessage({ source: "TAKABAZAR_GAME", kind: "REQUEST", id, type, payload }, "*");
    });
  }

  addEventListener("message", event => {
    const m = event.data;
    if (!m || m.source !== "TAKABAZAR_PLATFORM") return;
    if (m.kind === "INIT") {
      initData = m.payload || {};
      emit("init", initData);
      emit("balance", initData.wallet || {});
      return;
    }
    if (m.kind === "EVENT") {
      emit(m.type, m.payload);
      return;
    }
    if (m.kind === "RESPONSE") {
      const p = pending.get(m.id);
      if (!p) return;
      clearTimeout(p.timer);
      pending.delete(m.id);
      if (m.ok) p.resolve(m.payload);
      else p.reject(new Error(m.error || "Platform request failed"));
    }
  });

  window.TakaBazarGame = Object.freeze({
    version: 1,
    ready: () => request("READY"),
    getBalance: () => request("GET_BALANCE"),
    bet: ({ stake, guess }) => request("BET", { stake, guess }),
    crashOpenRound: () => request("CRASH_OPEN"),
    crashBet: ({ roundId, stake, panel = 1 }) => request("CRASH_BET", { roundId, stake, panel }),
    crashCancel: ({ betId }) => request("CRASH_CANCEL", { betId }),
    crashStatus: ({ roundId }) => request("CRASH_STATUS", { roundId }),
    crashCashout: ({ betId }) => request("CRASH_CASHOUT", { betId }),
    close: () => request("CLOSE"),
    toast: message => request("TOAST", { message: String(message || "").slice(0, 120) }),
    on(name, fn) {
      if (typeof fn !== "function") return () => {};
      const a = listeners.get(name) || [];
      a.push(fn); listeners.set(name, a);
      return () => listeners.set(name, (listeners.get(name) || []).filter(x => x !== fn));
    },
    get init() { return initData; }
  });

  parent.postMessage({ source: "TAKABAZAR_GAME", kind: "REQUEST", id: `tb_boot_${Date.now()}`, type: "READY", payload: {} }, "*");
})();