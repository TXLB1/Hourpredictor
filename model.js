// model.js
// Online probabilistic model for hourly direction with abstention when uncertain.
// Combines: 30d prior (and simple Markov prior), intrahour momentum vs hour open, slope, RSI.
// Produces posterior probability for UP; recommend only if above threshold or below (for DOWN).

export class HourlyModel {
  constructor() {
    this.history1h = []; // recent 1h bars
    this.history1m = []; // recent 1m closes (at least ~120)
    this.hourOpen = null;
    this.lastClosedHourDir = 0; // +1 up, -1 down, 0 unknown
    this.atr = null; // average true range of 1h over 30d (HL mean proxy)
    this.priorUp = 0.5;
    this.pUpGivenUp = 0.5;
    this.pUpGivenDown = 0.5;
  }

  loadHistory1h(bars) {
    this.history1h = bars;
    if (bars.length>=2) {
      const ups = bars.map(b=> (b.close >= b.open) ? 1:0);
      const n = ups.length;
      const upRate = ups.reduce((a,b)=>a+b,0)/n;
      this.priorUp = clamp(0.35, 0.65, upRate);

      // Markov transitions
      let uu=1, ud=1, du=1, dd=1; // Laplace smoothing
      for (let i=1;i<n;i++) {
        const prevUp = ups[i-1]; const curUp = ups[i];
        if (prevUp && curUp) uu++; else if (prevUp && !curUp) ud++;
        else if (!prevUp && curUp) du++; else dd++;
      }
      const pUpGivenUp = uu/(uu+ud);
      const pUpGivenDown = du/(du+dd);
      this.pUpGivenUp = clamp(0.4, 0.6, pUpGivenUp);
      this.pUpGivenDown = clamp(0.4, 0.6, pUpGivenDown);

      // ATR proxy: mean(high-low) over last 30d
      const hl = bars.slice(-720).map(b=> b.high-b.low);
      this.atr = average(hl);
      // Last closed hour direction
      const last = bars[bars.length-1];
      this.lastClosedHourDir = (last.close >= last.open) ? 1 : -1;
    }
  }

  setHourOpen(open) { this.hourOpen = open; }
  pushMinute(close) {
    this.history1m.push(close);
    if (this.history1m.length > 600) this.history1m.shift();
  }

  // Compute posterior probability UP and reasoning signals
  predict(confThreshold=0.62) {
    if (!this.hourOpen || this.history1m.length<3 || !this.atr) {
      return { decision: "NO CALL", probUp: 0.5, confidence: 0.5, signals: ["insufficient data"] };
    }

    const latest = this.history1m[this.history1m.length-1];
    const delta = latest - this.hourOpen;
    const atr = this.atr || Math.max(1e-8, Math.abs(this.hourOpen)*0.003); // fallback
    const z = delta / Math.max(1e-9, atr); // normalized move vs ATR

    // slope over last N minutes
    const N = Math.min(20, this.history1m.length);
    const slope = linregSlope(this.history1m.slice(-N)); // per minute
    const slopeZ = slope / (Math.max(1e-9, atr/60)); // normalize vs per-minute scale

    // RSI(14)
    const rsi = RSI(this.history1m, 14);

    // Prior (Markov-adjusted)
    const prior = (this.lastClosedHourDir>0) ? this.pUpGivenUp : this.pUpGivenDown;
    let logit = logitOf(prior);
    const reasons = [`prior=${prior.toFixed(2)}`];

    // Likelihoods (hand-tuned, gentle)
    // 1) Distance from hour open
    if (z> 0.15) { logit += 0.6; reasons.push(`above open strong (z=${z.toFixed(2)})`); }
    else if (z> 0.05) { logit += 0.25; reasons.push(`above open (z=${z.toFixed(2)})`); }
    else if (z< -0.15) { logit -= 0.6; reasons.push(`below open strong (z=${z.toFixed(2)})`); }
    else if (z< -0.05) { logit -= 0.25; reasons.push(`below open (z=${z.toFixed(2)})`); }
    else { reasons.push(`near open (z=${z.toFixed(2)})`); }

    // 2) Slope
    if (slopeZ> 0.2) { logit += 0.35; reasons.push(`positive slope`); }
    else if (slopeZ< -0.2) { logit -= 0.35; reasons.push(`negative slope`); }

    // 3) RSI
    if (rsi> 65) { logit += 0.25; reasons.push(`RSI ${rsi.toFixed(0)} high`); }
    else if (rsi> 55) { logit += 0.1; reasons.push(`RSI ${rsi.toFixed(0)} mid+`); }
    else if (rsi< 35) { logit -= 0.25; reasons.push(`RSI ${rsi.toFixed(0)} low`); }
    else if (rsi< 45) { logit -= 0.1; reasons.push(`RSI ${rsi.toFixed(0)} mid-`); }
    else { reasons.push(`RSI ${rsi.toFixed(0)} neutral`); }

    const probUp = sigmoid(logit);
    const confidence = Math.max(probUp, 1-probUp);
    let decision = "NO CALL";
    if (confidence >= confThreshold) {
      decision = (probUp>=0.5) ? "UP" : "DOWN";
    }
    return { decision, probUp, confidence, signals: reasons, z, slopeZ, rsi };
  }
}

// --- helpers ---
function average(arr){ return arr.reduce((a,b)=>a+b,0)/Math.max(1,arr.length); }
function clamp(lo,hi,x){ return Math.max(lo, Math.min(hi,x)); }
function sigmoid(x){ return 1/(1+Math.exp(-x)); }
function logitOf(p){ p = clamp(1e-6, 1-1e-6, p); return Math.log(p/(1-p)); }

function linregSlope(y){
  const n = y.length;
  const xmean = (n-1)/2;
  let num=0, den=0;
  for (let i=0;i<n;i++){
    const dx = i - xmean;
    num += dx * (y[i]);
    den += dx*dx;
  }
  const slope = num / Math.max(1e-9, den);
  return slope;
}

// Simple RSI on closes, period N
function RSI(closes, N){
  if (closes.length < N+1) return 50;
  let gains=0, losses=0;
  for (let i=closes.length-N;i<closes.length;i++){
    const diff = closes[i] - closes[i-1];
    if (diff>=0) gains += diff; else losses -= diff;
  }
  const rs = (losses>1e-9) ? (gains / losses) : 1;
  return 100 - (100/(1+rs));
}
