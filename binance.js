// binance.js
// Lightweight wrappers around Binance REST + WebSocket for public market data.
// Note: Works in browser. CORS is enabled on api.binance.com for public endpoints.

export const Binance = {
  restBase: "https://api.binance.com",
  streamBase: "wss://stream.binance.com:9443",

  async fetchKlines(symbol, interval, limit=500) {
    const url = `${this.restBase}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetchKlines failed: ${res.status}`);
    const data = await res.json();
    // map to objects
    return data.map(d => ({
      openTime: d[0], open: +d[1], high: +d[2], low: +d[3], close: +d[4],
      volume: +d[5], closeTime: d[6]
    }));
  },

  // Open a 1m kline stream for symbol. Returns close function.
  openMinuteKlineStream(symbol, onKline) {
    const stream = `${symbol.toLowerCase()}@kline_1m`;
    const url = `${this.streamBase}/ws/${stream}`;
    const ws = new WebSocket(url);
    ws.onmessage = (evt) => {
      try{
        const msg = JSON.parse(evt.data);
        if (msg.k) {
          const k = msg.k;
          const kline = {
            openTime: k.t, open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v, isFinal: !!k.x
          };
          onKline(kline);
        }
      }catch(e){ console.error("WS parse", e); }
    };
    ws.onerror = (e) => console.error("WS error", e);
    return () => { try{ ws.close(); }catch(e){} };
  },

  async fetchPricePrecision(symbol) {
    // Get exchange info to determine tick size / precision (optional UI nicety)
    const url = `${this.restBase}/api/v3/exchangeInfo?symbol=${symbol}`;
    const res = await fetch(url);
    const info = await res.json();
    const f = info.symbols?.[0]?.filters?.find(f=>f.filterType==="PRICE_FILTER");
    if (!f) return 2;
    // precision via stepSize exponent if decimal
    const step = f.tickSize;
    const decimals = (step.indexOf(".")>=0) ? (step.length - step.indexOf(".") - 1) : 0;
    // remove trailing zeros
    let p = decimals;
    while(p>0 && step.endsWith("0")) p--;
    return Math.max(0, p);
  }
};
