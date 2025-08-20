// app.js
import { Binance } from './binance.js';
import { HourlyModel } from './model.js';

const els = {
  price: document.getElementById('price'),
  hourOpen: document.getElementById('hourOpen'),
  prediction: document.getElementById('prediction'),
  confidenceOut: document.getElementById('confidenceOut'),
  reasoning: document.getElementById('reasoning'),
  prior: document.getElementById('prior'),
  atr: document.getElementById('atr'),
  lastHourDir: document.getElementById('lastHourDir'),
  symbolSelect: document.getElementById('symbolSelect'),
  startBtn: document.getElementById('startBtn'),
  stopBtn: document.getElementById('stopBtn'),
  confInput: document.getElementById('confidence'),
  netStatus: document.getElementById('netStatus'),
  lastUpdate: document.getElementById('lastUpdate'),
};

let chart, chartData;
let closeWS = null;
let model = new HourlyModel();
let currentSymbol = els.symbolSelect.value;
let pricePrecision = 2;

function fmt(n, p) { return n.toLocaleString(undefined, {maximumFractionDigits: p, minimumFractionDigits: p}); }
function nowStr(){ return new Date().toLocaleTimeString(); }

async function initChart() {
  const ctx = document.getElementById('priceChart').getContext('2d');
  chartData = {
    labels: [],
    datasets: [{
      label: '1m Close',
      data: [],
      borderWidth: 1,
      tension: 0.2,
    }]
  };
  chart = new Chart(ctx, {
    type: 'line',
    data: chartData,
    options: {
      animation: false,
      responsive: true,
      scales: {
        x: { ticks: { maxTicksLimit: 6 }},
        y: { beginAtZero: false }
      },
      plugins: {
        legend: { display: false }
      }
    }
  });
}

async function loadHistory(symbol) {
  // 30d of 1h
  const bars1h = await Binance.fetchKlines(symbol, "1h", 720);
  model.loadHistory1h(bars1h);
  els.prior.textContent = model.priorUp.toFixed(2);
  els.atr.textContent = fmt(model.atr || 0, 4);
  els.lastHourDir.textContent = model.lastClosedHourDir>0 ? "UP" : "DOWN";

  // Determine current hour open as last open of latest 1h kline (if still open hour, use that open price)
  const last1h = bars1h[bars1h.length-1];
  model.setHourOpen(last1h.open);
  els.hourOpen.textContent = `Hour open: ${fmt(last1h.open, pricePrecision)}`;

  // Preload last ~120 of 1m to get RSI slope etc.
  const bars1m = await Binance.fetchKlines(symbol, "1m", 200);
  for (const b of bars1m) { model.pushMinute(b.close); }
  for (const b of bars1m) { pushChartPoint(new Date(b.closeTime).toLocaleTimeString(), b.close); }
  updateAll(bars1m[bars1m.length-1].close);
}

function pushChartPoint(label, value) {
  const maxPts = 180;
  chartData.labels.push(label);
  chartData.data = chartData.datasets[0].data;
  chartData.data.push(value);
  if (chartData.labels.length>maxPts){ chartData.labels.shift(); chartData.data.shift(); }
  chart.update();
}

function updateAll(latestClose) {
  els.price.textContent = fmt(latestClose, pricePrecision);
  const res = model.predict(parseFloat(els.confInput.value || "0.62"));
  const confPct = (res.confidence*100).toFixed(1) + "%";
  els.confidenceOut.textContent = "Confidence: " + confPct + ` (p_up=${res.probUp.toFixed(2)})`;
  els.reasoning.textContent = "Signals: " + res.signals.join(", ");
  els.prediction.textContent = res.decision;
  els.prediction.className = res.decision==="UP" ? "big up" : (res.decision==="DOWN" ? "big down" : "big abstain");
  els.lastUpdate.textContent = nowStr();
}

async function start() {
  currentSymbol = els.symbolSelect.value;
  els.startBtn.disabled = true;
  els.stopBtn.disabled = false;

  pricePrecision = await Binance.fetchPricePrecision(currentSymbol);
  await initChart();
  await loadHistory(currentSymbol);

  // Open WS
  if (closeWS) closeWS();
  closeWS = Binance.openMinuteKlineStream(currentSymbol, (kline)=>{
    // New minute
    model.pushMinute(kline.close);
    pushChartPoint(new Date(kline.openTime + 60_000).toLocaleTimeString(), kline.close);
    updateAll(kline.close);

    // If we got an isFinal and it's exactly on a new hour, reset hourOpen to the first open of that hour.
    const t = new Date(kline.openTime + 60_000); // minute close time
    if (kline.isFinal && t.getMinutes()===0) {
      // Fetch the new last 1h kline to get updated last hour dir and open price
      Binance.fetchKlines(currentSymbol, "1h", 3).then(b1h=>{
        model.loadHistory1h(b1h);
        const last = b1h[b1h.length-1];
        model.setHourOpen(last.open);
        els.hourOpen.textContent = `Hour open: ${fmt(last.open, pricePrecision)}`;
        els.prior.textContent = model.priorUp.toFixed(2);
        els.atr.textContent = fmt(model.atr || 0, 4);
        els.lastHourDir.textContent = model.lastClosedHourDir>0 ? "UP" : "DOWN";
      }).catch(console.error);
    }
  });
}

function stop() {
  els.startBtn.disabled = false;
  els.stopBtn.disabled = true;
  if (closeWS) { closeWS(); closeWS = null; }
}

window.addEventListener('online', ()=> els.netStatus.textContent="online");
window.addEventListener('offline', ()=> els.netStatus.textContent="offline");
els.netStatus.textContent = navigator.onLine ? "online" : "offline";

els.startBtn.addEventListener('click', start);
els.stopBtn.addEventListener('click', stop);

// PWA service worker
if ("serviceWorker" in navigator) {
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('sw.js').catch(console.warn);
  });
}
