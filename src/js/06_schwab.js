// ═══════════════════════════════════════════════════════════════════
// CURRENCY / FILTER
// ═══════════════════════════════════════════════════════════════════
function setCurrency(c) {
  currency = c;
  document.querySelectorAll('.currency-btn').forEach((b,i) => b.classList.toggle('active', (i===0&&c==='USD')||(i===1&&c==='INR')));
  rerender();
}

function setFilter(f, el) {
  activateFilter(f);
  rerender();
}


// ═══════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════
let pendingLots       = null;   // equity awards CSV parsed, waiting for XLS
let pendingXlsRates   = null;   // XLS parsed, waiting for CSV
let pendingRetailTrades = null; // retail CSV parsed, waiting for XLS
let schwabMode        = null;   // 'awards' | 'retail'
let schwabRDataReady  = false;
let schwabRRealized   = [];
let schwabROpen       = {};
let schwabRIntradayPnl = [];
let schwabRTaxRegime  = 'new';


// ═══════════════════════════════════════════════════════════════════
// FILE UPLOAD HANDLERS
// ═══════════════════════════════════════════════════════════════════
async function handleCsvUpload(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const text = await file.text();

  // Auto-detect: retail brokerage CSV starts with "Transactions  for account..."
  const firstLine = text.split('\n')[0] || '';
  if (firstLine.toLowerCase().includes('transactions') && firstLine.toLowerCase().includes('for account')) {
    // ── Retail brokerage CSV ───────────────────────────────────────
    const trades = parseSchawbRetailCSV(text);
    if (!trades.length) {
      alert('No Buy/Sell trades found in the CSV.\n\nMake sure you exported from: Accounts → History → select date range → Export.\n\nIf this is an Equity Awards CSV, the file may be in an unexpected format.');
      return;
    }
    document.getElementById('csvCard').classList.add('ready');
    document.getElementById('csvBtnLabel').textContent = '✓ ' + file.name + ' (' + trades.length + ' trade' + (trades.length !== 1 ? 's' : '') + ')';
    if (pendingXlsRates) {
      initWithBothRetail(trades, pendingXlsRates);
    } else {
      pendingRetailTrades = trades;
    }
  } else {
    // ── Equity Awards Center CSV ───────────────────────────────────
    const lots = parseSchawbCSV(text);
    if (!lots.length) { alert('No lots found in CSV. Check file format.'); return; }
    document.getElementById('csvCard').classList.add('ready');
    document.getElementById('csvBtnLabel').textContent = '✓ ' + file.name;
    if (pendingXlsRates) {
      initWithBoth(lots, pendingXlsRates);
    } else {
      pendingLots = lots;
    }
  }
}

async function handleXlsUpload(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const rates = parseRBIXls(await file.text());
  if (!Object.keys(rates).length) { alert('No rates found in the XLS. Make sure you downloaded the correct RBI Reference Rate file.'); return; }

  // Mark XLS card ready
  document.getElementById('xlsCard').classList.add('ready');
  document.getElementById('xlsBtnLabel').textContent = '✓ ' + file.name;

  if (pendingLots) {
    initWithBoth(pendingLots, rates);
  } else if (pendingRetailTrades) {
    initWithBothRetail(pendingRetailTrades, rates);
  } else {
    pendingXlsRates = rates;
  }
}


// ═══════════════════════════════════════════════════════════════════
// RBI XLS PARSER
// ═══════════════════════════════════════════════════════════════════
// Parse the RBI HTML-as-XLS: DD/MM/YYYY → rate
function parseRBIXls(text) {
  const doc = new DOMParser().parseFromString(text, 'text/html');
  const rates = {};
  doc.querySelectorAll('tr').forEach(row => {
    const cells = [...row.querySelectorAll('td')];
    if (cells.length < 2) return;
    const parts = cells[0].textContent.trim().split('/');
    if (parts.length !== 3) return;
    const iso = `${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`;
    const rate = parseFloat(cells[1].textContent.replace(/,/g,''));
    if (!isNaN(rate) && rate > 30 && rate < 200) rates[iso] = rate;
  });
  return rates;
}

// Find the nearest available RBI rate on or before a given date (for holidays/weekends)
function nearestRBIRate(isoDate, xlsRates) {
  if (xlsRates[isoDate]) return { rate: xlsRates[isoDate], exact: true };
  // Look back up to 4 calendar days (covers long weekends + holidays)
  const d = new Date(isoDate + 'T00:00:00');
  for (let i = 1; i <= 4; i++) {
    d.setDate(d.getDate() - 1);
    const key = d.toISOString().split('T')[0];
    if (xlsRates[key]) return { rate: xlsRates[key], exact: false, usedDate: key };
  }
  return null;
}


// ═══════════════════════════════════════════════════════════════════
// EQUITY AWARDS INIT (RSU / ESPP)
// ═══════════════════════════════════════════════════════════════════
function initWithBoth(lots, xlsRates) {
  schwabMode = 'awards';
  allLots = lots;
  ratesMap = {};

  const lotDates = [...new Set(lots.map(l => l.dateAcquired))];
  lotDates.forEach(date => {
    const found = nearestRBIRate(date, xlsRates);
    if (found) {
      ratesMap[date] = { rate: found.rate, source: 'rbi' };
    }
  });

  // Today's rate: use most recent available from XLS
  const todayFound = nearestRBIRate(TODAY, xlsRates);
  if (todayFound) {
    document.getElementById('todayINR').value = todayFound.rate.toFixed(2);
    // Also sync IndMoney USD→INR rate if it hasn't been manually changed
    const imUsdRateEl = document.getElementById('imUsdRate');
    if (imUsdRateEl && parseFloat(imUsdRateEl.value) === 84.5) {
      imUsdRateEl.value = todayFound.rate.toFixed(2);
    }
    ratesMap[TODAY] = { rate: todayFound.rate, source: 'rbi' };
  }

  pendingLots = null;
  pendingXlsRates = null;
  showMainUI();
  activateFilter('all');
  renderRateTable();
  rerender();
  updateAnalyzeAllBtn();
}


// ═══════════════════════════════════════════════════════════════════
// RETAIL BROKERAGE INIT (Buy/Sell transactions)
// ═══════════════════════════════════════════════════════════════════
function initWithBothRetail(trades, xlsRates) {
  schwabMode = 'retail';
  ratesMap = {};

  // Build ratesMap for all trade dates
  const tradeDates = [...new Set(trades.map(t => t.date))];
  tradeDates.forEach(date => {
    const found = nearestRBIRate(date, xlsRates);
    if (found) ratesMap[date] = { rate: found.rate, source: 'rbi' };
  });

  // Today's rate
  const todayFound = nearestRBIRate(TODAY, xlsRates);
  if (todayFound) {
    document.getElementById('todayINR').value = todayFound.rate.toFixed(2);
    const imUsdRateEl = document.getElementById('imUsdRate');
    if (imUsdRateEl && parseFloat(imUsdRateEl.value) === 84.5) {
      imUsdRateEl.value = todayFound.rate.toFixed(2);
    }
    ratesMap[TODAY] = { rate: todayFound.rate, source: 'rbi' };
  }

  const fallbackRate = parseFloat(document.getElementById('todayINR').value) || 84.5;

  // Convert each trade's USD price → INR using that trade's date RBI rate.
  // This gives correct INR gain when FIFO matches buys and sells:
  //   gain per unit (INR) = sell_price_USD × sell_date_rate − buy_price_USD × buy_date_rate
  const tradesINR = trades.map(t => ({
    ...t,
    price: t.price * (ratesMap[t.date]?.rate || fallbackRate),
  }));

  // Run FIFO pipeline (same as Zerodha/Groww)
  const { intradayPnl, deliveryTrades } = extractIntraday(tradesINR);
  schwabRIntradayPnl = intradayPnl;

  const { realized, open } = runFIFO(deliveryTrades);

  // US equity: LTCG threshold = 730 days (24 months), not 365
  schwabRRealized = realized.map(r => ({
    ...r,
    category: r.holdDays > 730 ? 'LTCG' : 'STCG',
  }));
  schwabROpen = open;
  schwabRDataReady = true;

  pendingRetailTrades = null;
  pendingXlsRates = null;

  showSchwabRetailUI();
  rerenderSchwabRetail();
  updateAnalyzeAllBtn();
}


// ═══════════════════════════════════════════════════════════════════
// SHOW / HIDE RESULT SECTIONS
// ═══════════════════════════════════════════════════════════════════
function showMainUI() {
  document.getElementById('settingsPanel').style.display    = 'block';
  document.getElementById('catSummarySection').style.display = 'block';
  document.getElementById('summarySection').style.display   = 'block';
  document.getElementById('disclaimerSection').style.display = 'block';
  document.getElementById('currencyToggle').style.display   = '';
  document.getElementById('schwabRSection').style.display   = 'none';
}

function showSchwabRetailUI() {
  document.getElementById('settingsPanel').style.display    = 'none';
  document.getElementById('catSummarySection').style.display = 'none';
  document.getElementById('summarySection').style.display   = 'none';
  document.getElementById('disclaimerSection').style.display = 'none';
  document.getElementById('currencyToggle').style.display   = 'none';
  document.getElementById('schwabRSection').style.display   = 'block';
}

function saveTodayINR() {}

// ── Manual rate override ───────────────────────────────────────────
function overrideRate(date, val) {
  const rate = parseFloat(val);
  if (!isNaN(rate) && rate > 0) {
    ratesMap[date] = { rate, source: 'manual' };
    rerender();
  }
}


// ═══════════════════════════════════════════════════════════════════
// RESET
// ═══════════════════════════════════════════════════════════════════
function resetUpload() {
  pendingLots = null;
  pendingXlsRates = null;
  pendingRetailTrades = null;
  schwabMode = null;
  schwabRDataReady = false;
  schwabRRealized = []; schwabROpen = {}; schwabRIntradayPnl = [];
  allLots = [];
  ratesMap = {};
  document.getElementById('csvCard').classList.remove('ready');
  document.getElementById('xlsCard').classList.remove('ready');
  document.getElementById('csvBtnLabel').textContent = 'Choose File';
  document.getElementById('xlsBtnLabel').textContent = 'Choose File';
  document.getElementById('settingsPanel').style.display    = 'none';
  document.getElementById('catSummarySection').style.display = 'none';
  document.getElementById('summarySection').style.display   = 'none';
  document.getElementById('disclaimerSection').style.display = 'none';
  document.getElementById('currencyToggle').style.display   = 'none';
  document.getElementById('schwabRSection').style.display   = 'none';
  activateFilter('all');
  document.getElementById('lotsWrap').innerHTML = '';
  document.getElementById('pra_schwab').style.display = 'none';
  checkAndMaybeGoBack();
}


// ═══════════════════════════════════════════════════════════════════
// RETAIL BROKERAGE — PARSER
// Format: Row1 = "Transactions  for account ...", Row2 = blank,
//         Row3 = "Date","Action","Symbol","Description","Quantity","Price","Fees & Comm","Amount"
//         Last row = "Transactions Total,..."
// ═══════════════════════════════════════════════════════════════════
function parseSchawbRetailCSV(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // Find the header row (contains Date, Action, Symbol columns)
  const hdrIdx = lines.findIndex(l => {
    const lower = l.toLowerCase();
    return lower.includes('action') && lower.includes('symbol') &&
           (lower.startsWith('"date"') || lower.startsWith('date,'));
  });
  if (hdrIdx < 0) return [];

  const hdr     = parseCsvLine(lines[hdrIdx]).map(h => h.trim().toLowerCase());
  const iDate   = hdr.indexOf('date');
  const iAction = hdr.indexOf('action');
  const iSym    = hdr.indexOf('symbol');
  const iQty    = hdr.indexOf('quantity');
  const iPrice  = hdr.indexOf('price');
  if (iDate < 0 || iAction < 0 || iSym < 0 || iQty < 0 || iPrice < 0) return [];

  // Actions to treat as buys or sells
  const BUY_ACTIONS  = ['buy', 'buy to open', 'buy to close', 'reinvest shares'];
  const SELL_ACTIONS = ['sell', 'sell to open', 'sell to close'];

  const seen   = new Set();
  const trades = [];

  for (let i = hdrIdx + 1; i < lines.length; i++) {
    const row    = parseCsvLine(lines[i]);
    const action = (row[iAction] || '').trim().toLowerCase();
    if (!action || action.startsWith('transactions total')) break;

    const isBuy  = BUY_ACTIONS.some(a  => action === a);
    const isSell = SELL_ACTIONS.some(a => action === a);
    if (!isBuy && !isSell) continue;

    const sym = (row[iSym] || '').trim();
    if (!sym || sym === '--' || sym.toLowerCase() === 'symbol') continue;

    // Date may carry an "as of" suffix: "12/16/2020 as of 12/15/2020"
    const rawDate = (row[iDate] || '').split(' as of ')[0].trim();
    const dateISO = mmddToISO(rawDate);
    if (!dateISO) continue;

    const qty   = Math.abs(parseFloat((row[iQty]   || '0').replace(/[$,\s]/g, '')) || 0);
    const price = Math.abs(parseFloat((row[iPrice] || '0').replace(/[$,\s]/g, '')) || 0);
    if (qty <= 0 || price <= 0) continue;

    const dedupKey = `${sym}|${dateISO}|${isBuy ? 'buy' : 'sell'}|${qty}|${price}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    trades.push({
      symbol:   sym,
      isin:     '',
      date:     dateISO,
      type:     isBuy ? 'buy' : 'sell',
      qty,
      price,   // USD — will be converted to INR in initWithBothRetail
      fileType: 'eq',
      dedupKey,
    });
  }

  return trades;
}


// ═══════════════════════════════════════════════════════════════════
// RETAIL BROKERAGE — RENDER
// ═══════════════════════════════════════════════════════════════════
function setSRRegime(r) {
  schwabRTaxRegime = r;
  document.getElementById('schwabRRegimeNew').classList.toggle('active', r === 'new');
  document.getElementById('schwabRRegimeOld').classList.toggle('active', r === 'old');
  rerenderSchwabRetail();
}

function rerenderSchwabRetail() {
  if (!schwabRDataReady) return;

  const ltcgRate = (parseFloat(document.getElementById('schwabRLtcgRate').value) || 12.5) / 100;
  const stcgRate = (parseFloat(document.getElementById('schwabRStcgRate').value) || 30)   / 100;
  const EXEMPT   = 125000; // ₹1,25,000 LTCG exemption

  // ── Tax calculation ──────────────────────────────────────────────
  let totalSTCG = 0, totalLTCG = 0;
  schwabRRealized.forEach(r => {
    if (r.gain > 0) {
      if (r.category === 'LTCG') totalLTCG += r.gain;
      else                       totalSTCG  += r.gain;
    }
  });

  const ltcgTaxable = Math.max(totalLTCG - EXEMPT, 0);
  const stcgTax     = Math.max(totalSTCG, 0) * stcgRate;
  const ltcgTax     = ltcgTaxable * ltcgRate;

  const otherL          = parseFloat(document.getElementById('schwabROtherIncome').value) || 0;
  const otherINR        = otherL * 100000;
  const slabs           = schwabRTaxRegime === 'new' ? NEW_SLABS : OLD_SLABS;
  const intradayTotal   = schwabRIntradayPnl.reduce((s, t) => s + t.pnl, 0);
  const intradayTax     = slabTax(otherINR + Math.max(intradayTotal, 0), slabs) - slabTax(otherINR, slabs);
  const totalTax        = stcgTax + ltcgTax + intradayTax;

  // ── Consolidated summary ─────────────────────────────────────────
  document.getElementById('schwabRConsolidated').innerHTML = `
    <div class="z-consolidated-grid">
      <div class="z-con-item">
        <div class="z-con-label">STCG (≤ 24 months)</div>
        <div class="z-con-val">${fINR(totalSTCG, true)}</div>
        <div class="z-con-sub">Tax: ${fINR(stcgTax, true)} @ ${(stcgRate * 100).toFixed(1)}%</div>
      </div>
      <div class="z-con-item">
        <div class="z-con-label">LTCG (&gt; 24 months)</div>
        <div class="z-con-val">${fINR(totalLTCG, true)}</div>
        <div class="z-con-sub">Taxable: ${fINR(ltcgTaxable, true)} (₹1.25L exempt)</div>
      </div>
      ${intradayTotal !== 0 ? `
      <div class="z-con-item">
        <div class="z-con-label">Intraday P&L</div>
        <div class="z-con-val ${intradayTotal >= 0 ? 'pos' : 'neg'}">${fINR(intradayTotal, true)}</div>
        <div class="z-con-sub">Speculative business income</div>
      </div>` : ''}
      <div class="z-con-item highlight">
        <div class="z-con-label">Total Tax Estimate</div>
        <div class="z-con-val">${fINR(totalTax, true)}</div>
        <div class="z-con-sub">LTCG ${(ltcgRate * 100).toFixed(1)}% + STCG slab</div>
      </div>
    </div>`;

  // ── Realized gains ────────────────────────────────────────────────
  const bySymbol = {};
  schwabRRealized.forEach(r => {
    if (!bySymbol[r.symbol]) bySymbol[r.symbol] = [];
    bySymbol[r.symbol].push(r);
  });
  const symCount  = Object.keys(bySymbol).length;
  document.getElementById('schwabRRealMeta').textContent =
    `${schwabRRealized.length} transaction${schwabRRealized.length !== 1 ? 's' : ''} · ${symCount} symbol${symCount !== 1 ? 's' : ''}`;
  document.getElementById('schwabRRealCards').innerHTML =
    Object.entries(bySymbol).map(([sym, trades]) => buildRealizedCard(sym, trades, ltcgRate, stcgRate, EXEMPT)).join('');
  document.getElementById('schwabRRealSection').style.display = schwabRRealized.length ? '' : 'none';

  // ── Open positions ────────────────────────────────────────────────
  const openEntries = Object.entries(schwabROpen);
  const openShares  = openEntries.reduce((s, [, lots]) => s + lots.reduce((a, b) => a + b.qty, 0), 0);
  document.getElementById('schwabROpenMeta').textContent =
    `${openEntries.length} symbol${openEntries.length !== 1 ? 's' : ''} · ${openShares.toLocaleString()} shares`;
  document.getElementById('schwabROpenCards').innerHTML =
    openEntries.map(([sym, lots]) => buildOpenCard(sym, lots, false, { ltcgDays: 730, ltcgRateId: 'schwabRLtcgRate', stcgRateId: 'schwabRStcgRate' })).join('');
  document.getElementById('schwabROpenSection').style.display = openEntries.length ? '' : 'none';

  // ── Intraday ──────────────────────────────────────────────────────
  if (schwabRIntradayPnl.length) {
    const marginal = intradayTotal > 0 ? intradayTax / intradayTotal : getMarginalRate(otherINR + 1, slabs);
    document.getElementById('schwabRIntradayMeta').textContent = `${schwabRIntradayPnl.length} day${schwabRIntradayPnl.length !== 1 ? 's' : ''} · ${fINR(intradayTotal, true)}`;
    document.getElementById('schwabRIntradayContent').innerHTML = buildIntradaySection(schwabRIntradayPnl, marginal);
    document.getElementById('schwabRIntradaySection').style.display = '';
  }
}


// ═══════════════════════════════════════════════════════════════════
// EQUITY AWARDS — FILTER / RATE TABLE
// ═══════════════════════════════════════════════════════════════════
function activateFilter(f) {
  activeFilter = f;
  document.querySelectorAll('.chip').forEach(c => {
    const isAll  = c.textContent.trim() === 'All Lots';
    const isThis = (f === 'all' && isAll) || c.textContent.trim() === f;
    c.classList.toggle('active', isThis);
  });
}

function renderRateTable() {
  const tbody = document.getElementById('rateTableBody');
  const uniqueDates = [...new Set(allLots.map(l => l.dateAcquired))].sort();
  const hasEst = uniqueDates.some(d => (ratesMap[d]?.source || 'est') === 'est');
  document.getElementById('missingRatesBanner').style.display = hasEst ? '' : 'none';

  tbody.innerHTML = uniqueDates.map(date => {
    const info = ratesMap[date] || {};
    const src = info.source || 'est';
    const isEst = src === 'est';
    const isLocked = src === 'rbi';
    const rowStyle = isEst ? 'background:#fff8e1;' : '';
    const manualCell = isLocked
      ? `<span style="font-size:12px;color:#888">— locked (RBI)</span>`
      : `<input type="number" value="${info.rate?.toFixed(2)||''}" step="0.01"
          style="${isEst ? 'border:2px solid #f57c00;background:#fff3e0;font-weight:600;' : ''}width:110px;"
          onchange="overrideRate('${date}',this.value)"
          placeholder="${isEst ? '⚠ Enter rate' : 'Override'}">`;
    return `<tr style="${rowStyle}">
      <td>${fDate(date)}</td>
      <td>${info.rate ? '₹' + info.rate.toFixed(4) : '<span style="color:#c62828">—</span>'}</td>
      <td><span class="source-tag ${src}">${src.toUpperCase()}</span></td>
      <td>${manualCell}</td>
    </tr>`;
  }).join('');
}


// ═══════════════════════════════════════════════════════════════════
// EQUITY AWARDS — CSV PARSER
// Handles both "EMPLOYEE STOCK PURCHASE PLAN SHARES" (ESPP) and
// "EQUITY AWARD SHARES" (RSU) sections from the Schwab Equity
// Award Center export. Works for any company (not just Nvidia).
// ═══════════════════════════════════════════════════════════════════
function parseSchawbCSV(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const lots = [];

  const esppIdx  = lines.findIndex(l => l.includes('EMPLOYEE STOCK PURCHASE PLAN SHARES'));
  const eqIdx    = lines.findIndex(l => l.includes('EQUITY AWARD SHARES'));

  // ── ESPP lots ─────────────────────────────────────────────────────
  if (esppIdx >= 0) {
    const end = eqIdx > 0 ? eqIdx : lines.length;
    let i = esppIdx + 2;
    while (i < end) {
      const parts = parseCsvLine(lines[i]);
      // Accept any symbol (not just NVDA)
      if (parts.length >= 8 && isMMDDYYYY(parts[0]) && parts[1] && parts[1].toUpperCase() !== 'SYMBOL') {
        const dateAcquired  = mmddToISO(parts[0]);
        const purchasePrice = numOf(parts[4]);
        const sharesAvail   = intOf(parts[7]);
        const sharesTotal   = intOf(parts[6]);

        let detail = [];
        let step   = 2;
        const rawNext = i + 1 < end ? lines[i + 1] : '';
        if (rawNext.includes('Plan Id')) {
          detail = i + 2 < end ? parseCsvLine(lines[i + 2]) : [];
          step   = 3;
        } else {
          detail = parseCsvLine(rawNext);
        }

        // Use Purchase FMV (index 6) as cost basis (discount already taxed as perquisite)
        let purchaseFMV = purchasePrice;
        if (detail.length >= 7) {
          const fmv = numOf(detail[6]);
          if (fmv > 0) purchaseFMV = fmv;
        }

        if (sharesAvail > 0 && dateAcquired) {
          lots.push(mkLot('ESPP', parts[1], dateAcquired, purchaseFMV, purchasePrice, sharesAvail, sharesTotal));
        }
        i += step;
      } else { i++; }
    }
  }

  // ── RSU lots from EQUITY AWARD SHARES ─────────────────────────────
  if (eqIdx >= 0) {
    const hdrIdx = lines.findIndex((l, idx) => idx > eqIdx && l.startsWith('Award Date,Symbol,Award ID'));
    if (hdrIdx >= 0) {
      for (let i = hdrIdx + 1; i < lines.length; i++) {
        const p = parseCsvLine(lines[i]);
        if (p.length < 11) continue;
        const sym      = p[1];
        const dateAcq  = mmddToISO(p[7]);
        const acqPrice = numOf(p[8]);
        const shares   = intOf(p[9]);
        const avail    = intOf(p[10]);
        if (!dateAcq || avail <= 0 || !sym || sym === 'Symbol') continue;
        lots.push(mkLot('RSU', sym, dateAcq, acqPrice, acqPrice, avail, shares));
      }
    }
  }

  return lots;
}

function mkLot(type, symbol, dateAcquired, acquisitionPrice, purchasePrice, sharesHeld, sharesTotal) {
  return {
    type, symbol, dateAcquired, acquisitionPrice, purchasePrice, sharesHeld, sharesTotal,
    taxCategory: monthsDiff(dateAcquired, TODAY) > 24 ? 'LTCG' : 'STCG',
    holdingMonths: monthsDiff(dateAcquired, TODAY),
  };
}


// ═══════════════════════════════════════════════════════════════════
// RSU / ESPP CATEGORY SUMMARY
// ═══════════════════════════════════════════════════════════════════
function renderCatSummary(currentPrice, todayINR, ltcgRate, stcgRate) {
  const categories = ['RSU', 'ESPP'];
  const grid = document.getElementById('catSummaryGrid');

  grid.innerHTML = categories.map(cat => {
    const lots = allLots.filter(l => l.type === cat);
    if (!lots.length) return '';

    let shares = 0, costUSD = 0, costINR = 0, valueUSD = 0, valueINR = 0, taxEst = 0;
    lots.forEach(lot => {
      const pRate   = ratesMap[lot.dateAcquired]?.rate || todayINR;
      const taxRate = lot.taxCategory === 'LTCG' ? ltcgRate : stcgRate;
      shares   += lot.sharesHeld;
      costUSD  += lot.acquisitionPrice * lot.sharesHeld;
      costINR  += lot.acquisitionPrice * lot.sharesHeld * pRate;
      valueUSD += currentPrice * lot.sharesHeld;
      valueINR += currentPrice * lot.sharesHeld * todayINR;
      const gainBase = currency === 'INR'
        ? Math.max(currentPrice * lot.sharesHeld * todayINR - lot.acquisitionPrice * lot.sharesHeld * pRate, 0)
        : Math.max((currentPrice - lot.acquisitionPrice) * lot.sharesHeld, 0);
      taxEst += gainBase * taxRate;
    });

    const gainUSD    = valueUSD - costUSD;
    const gainINR    = valueINR - costINR;
    const gainPctUSD = costUSD > 0 ? gainUSD / costUSD * 100 : 0;
    const gainPctINR = costINR > 0 ? gainINR / costINR * 100 : 0;
    const gPos       = gainUSD >= 0;

    const showINR = currency === 'INR';

    return `<div class="cat-card">
      <div class="cat-card-header">
        <div class="cat-icon ${cat.toLowerCase()}">${cat}</div>
        <div class="cat-title">${cat === 'RSU' ? 'Restricted Stock Units' : 'Employee Stock Purchase Plan'}</div>
        <div class="cat-shares">${shares} shares · ${lots.length} lots</div>
      </div>
      <div class="cat-rows">
        <div class="cat-row">
          <div class="cr-label">Total Invested</div>
          <div class="cr-val">${showINR ? fINR(costINR,true) : fUSD(costUSD,true)}</div>
          <div class="cr-sub">${showINR ? fUSD(costUSD,true)+' × avg buy rate' : fINR(costINR,true)+' at buy rates'}</div>
        </div>
        <div class="cat-row">
          <div class="cr-label">Current Value</div>
          <div class="cr-val">${showINR ? fINR(valueINR,true) : fUSD(valueUSD,true)}</div>
          <div class="cr-sub">${showINR ? fUSD(valueUSD,true)+' × ₹'+todayINR.toFixed(2) : fINR(valueINR,true)+' at ₹'+todayINR.toFixed(2)}</div>
        </div>
        <div class="cat-row gain-row">
          <div>
            <div class="cr-label">Total Gain</div>
            <div class="cr-val ${gPos?'pos':'neg'}">${signStr(showINR?gainINR:gainUSD)}${showINR?fINR(Math.abs(gainINR),true):fUSD(Math.abs(gainUSD),true)} (${(showINR?gainPctINR:gainPctUSD).toFixed(1)}%)</div>
          </div>
          <div style="text-align:right">
            <div class="cr-label">Est. Tax</div>
            <div class="cr-val" style="color:#e65100">${showINR?fINR(taxEst,true):fUSD(taxEst,true)}</div>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');
}


// ═══════════════════════════════════════════════════════════════════
// EQUITY AWARDS — RENDER
// ═══════════════════════════════════════════════════════════════════
function rerender() {
  if (!allLots.length) return;

  const currentPrice = parseFloat(document.getElementById('currentPrice').value) || 0;
  const todayINR     = parseFloat(document.getElementById('todayINR').value) || 84.5;
  const ltcgRate     = parseFloat(document.getElementById('ltcgRate').value) / 100;
  const stcgRate     = computeSTCGRate();  // dynamic from slab

  // Filter
  let filtered = allLots;
  if (activeFilter === 'RSU')  filtered = allLots.filter(l => l.type === 'RSU');
  if (activeFilter === 'ESPP') filtered = allLots.filter(l => l.type === 'ESPP');
  if (activeFilter === 'LTCG') filtered = allLots.filter(l => l.taxCategory === 'LTCG');
  if (activeFilter === 'STCG') filtered = allLots.filter(l => l.taxCategory === 'STCG');
  filtered = [...filtered].sort((a,b) => new Date(b.dateAcquired)-new Date(a.dateAcquired));

  // ── Summary ──────────────────────────────────────────────────────
  let totVal=0, totGain=0, totTax=0, totShares=0, totValINR=0, totGainINR=0, totCostINR=0;
  allLots.forEach(lot => {
    const taxRate = lot.taxCategory === 'LTCG' ? ltcgRate : stcgRate;
    const pRate   = ratesMap[lot.dateAcquired]?.rate || todayINR;
    const val     = currentPrice * lot.sharesHeld;
    const gain    = (currentPrice - lot.acquisitionPrice) * lot.sharesHeld;
    const costINR_ = lot.acquisitionPrice * lot.sharesHeld * pRate;
    const valINR_  = currentPrice * lot.sharesHeld * todayINR;
    const gainINR_ = valINR_ - costINR_;
    const taxBase  = currency === 'INR' ? Math.max(gainINR_, 0) : Math.max(gain, 0);
    totVal    += val;
    totGain   += gain;
    totShares += lot.sharesHeld;
    totValINR += valINR_;
    totGainINR+= gainINR_;
    totCostINR+= costINR_;
    totTax    += taxBase * taxRate;
  });

  const totGainPctINR = totCostINR > 0 ? totGainINR / totCostINR * 100 : 0;
  const totGainPctUSD = (totVal - totGain) > 0 ? totGain / (totVal - totGain) * 100 : 0;

  const sg = document.getElementById('summaryGrid');
  if (currency === 'USD') {
    sg.innerHTML = `
      <div class="sum-card"><div class="slabel">Total Shares</div><div class="sval">${totShares.toLocaleString()}</div><div class="ssub">${allLots.length} lots</div></div>
      <div class="sum-card"><div class="slabel">Portfolio Value</div><div class="sval">${fUSD(totVal,true)}</div><div class="ssub">@ $${currentPrice.toFixed(2)}/sh</div></div>
      <div class="sum-card ${totGain>=0?'green':'red'}"><div class="slabel">Total USD Gain</div><div class="sval">${signStr(totGain)}${fUSD(totGain,true)}</div><div class="ssub">${totGainPctUSD.toFixed(1)}% return</div></div>
      <div class="sum-card orange"><div class="slabel">Est. Tax Liability</div><div class="sval">${fUSD(totTax,true)}</div><div class="ssub">LTCG ${(ltcgRate*100).toFixed(1)}% / STCG slab</div></div>`;
  } else {
    sg.innerHTML = `
      <div class="sum-card"><div class="slabel">Total Shares</div><div class="sval">${totShares.toLocaleString()}</div><div class="ssub">₹${todayINR.toFixed(2)}/$ today</div></div>
      <div class="sum-card"><div class="slabel">Portfolio Value (₹)</div><div class="sval">${fINR(totValINR,true)}</div><div class="ssub">shares × $${currentPrice.toFixed(2)} × ₹${todayINR.toFixed(2)}</div></div>
      <div class="sum-card ${totGainINR>=0?'green':'red'}"><div class="slabel">Total INR Gain</div><div class="sval">${signStr(totGainINR)}${fINR(totGainINR,true)}</div><div class="ssub">${totGainPctINR.toFixed(1)}% on ₹ cost basis</div></div>
      <div class="sum-card orange"><div class="slabel">Est. Tax (₹)</div><div class="sval">${fINR(totTax,true)}</div><div class="ssub">LTCG ${(ltcgRate*100).toFixed(1)}% / STCG slab</div></div>`;
  }

  document.getElementById('sectionLabel').textContent =
    `${filtered.length} lot${filtered.length!==1?'s':''} · ${activeFilter==='all'?'All Holdings':activeFilter}`;

  renderCatSummary(currentPrice, todayINR, ltcgRate, stcgRate);

  const wrap = document.getElementById('lotsWrap');
  if (!filtered.length) { wrap.innerHTML = '<div class="empty-state"><h3>No lots match the filter</h3></div>'; return; }

  wrap.innerHTML = filtered.map(lot => { try {
    const taxRate  = lot.taxCategory === 'LTCG' ? ltcgRate : stcgRate;
    const pRate    = ratesMap[lot.dateAcquired]?.rate || todayINR;
    const src      = ratesMap[lot.dateAcquired]?.source || 'est';
    const val      = currentPrice * lot.sharesHeld;
    const gainUSD  = (currentPrice - lot.acquisitionPrice) * lot.sharesHeld;
    const gainPct  = lot.acquisitionPrice > 0 ? gainUSD / (lot.acquisitionPrice * lot.sharesHeld) * 100 : 0;

    const costINR       = lot.acquisitionPrice * lot.sharesHeld * pRate;
    const valINR        = val * todayINR;
    const gainINR       = valINR - costINR;
    const gainINR_stock = gainUSD * todayINR;
    const gainINR_forex = lot.acquisitionPrice * lot.sharesHeld * (todayINR - pRate);
    const fxChangePct   = pRate > 0 ? (todayINR - pRate) / pRate * 100 : 0;

    const taxBase = currency === 'INR' ? Math.max(gainINR, 0) : Math.max(gainUSD, 0);
    const taxAmt  = taxBase * taxRate;

    const isSTCG = lot.taxCategory === 'STCG';
    const ltcgConvert = isSTCG ? ltcgDate(lot.dateAcquired) : null;
    const daysLeft    = isSTCG ? daysUntil(ltcgConvert) : 0;
    const taxAtLTCG   = taxBase * ltcgRate;
    const taxSaving   = taxAmt - taxAtLTCG;

    const isLocked = src === 'rbi';
    const rateDisplay = isLocked
      ? `<span style="font-size:15px;font-weight:700">₹${pRate.toFixed(2)}</span>`
      : `<input type="number" step="0.01" value="${pRate.toFixed(2)}"
          style="width:80px;font-size:14px;font-weight:700;border:1px solid ${src==='est'?'#f57c00':'#ddd'};border-radius:5px;padding:2px 5px;color:${src==='est'?'#e65100':'inherit'};background:${src==='est'?'#fff8f0':'#fff'}"
          onchange="overrideRate('${lot.dateAcquired}',this.value)"
          title="Edit to correct the USD/INR rate for this date">`;
    const fxRow = `
      <div class="fx-row">
        <div class="fx-item">
          <div class="fx-label">USD/INR at Purchase</div>
          <div class="fx-val" style="display:flex;align-items:center;gap:4px">
            ${rateDisplay}
            <span class="fx-src ${src}">${src.toUpperCase()}</span>
          </div>
        </div>
        <div class="fx-arrow">→</div>
        <div class="fx-item">
          <div class="fx-label">USD/INR Today</div>
          <div class="fx-val">₹${todayINR.toFixed(2)}</div>
        </div>
        <div class="fx-item">
          <div class="fx-label">Forex Gain (₹)</div>
          <div class="fx-val ${gainINR_forex>=0?'pos':'neg'}">${signStr(gainINR_forex)}${fINR(Math.abs(gainINR_forex),true)} (${signStr(fxChangePct)}${Math.abs(fxChangePct).toFixed(1)}%)</div>
        </div>
        <div class="fx-item">
          <div class="fx-label">Stock Gain (₹)</div>
          <div class="fx-val ${gainINR_stock>=0?'pos':'neg'}">${signStr(gainINR_stock)}${fINR(Math.abs(gainINR_stock),true)}</div>
        </div>
      </div>`;

    const ltcgBanner = isSTCG && daysLeft > 0 ? `
      <div class="ltcg-banner">
        <div class="ltcg-banner-top">
          <span class="clock">⏳</span>
          <span>Converts to LTCG on <strong>${fDate(ltcgConvert)}</strong></span>
          <span class="days-badge">${daysLeft} day${daysLeft!==1?'s':''} away</span>
        </div>
        <div class="ltcg-tax-compare">
          <div class="tc-box">
            <div class="tc-label">STCG Tax Now</div>
            <div class="tc-val stcg-col">${currency==='INR'?fINR(taxAmt,true):fUSD(taxAmt,true)}</div>
            <div style="font-size:10px;color:#aaa">${(taxRate*100).toFixed(0)}% slab</div>
          </div>
          <div class="tc-arrow">→</div>
          <div class="tc-box">
            <div class="tc-label">LTCG Tax After</div>
            <div class="tc-val ltcg-col">${currency==='INR'?fINR(taxAtLTCG,true):fUSD(taxAtLTCG,true)}</div>
            <div style="font-size:10px;color:#aaa">${(ltcgRate*100).toFixed(1)}%</div>
          </div>
          <div class="tc-saving">
            <div class="tc-label">Tax Saved by Waiting</div>
            <div class="tc-val">${currency==='INR'?fINR(taxSaving,true):fUSD(taxSaving,true)}</div>
          </div>
        </div>
      </div>` : (isSTCG && daysLeft <= 0 ? `
      <div class="ltcg-banner" style="background:#e8f5e9;border-color:#c8e6c9">
        <div class="ltcg-banner-top">
          <span>✅ This lot <strong>qualifies for LTCG</strong> today — consider selling to get ${(ltcgRate*100).toFixed(1)}% rate</span>
        </div>
      </div>` : '');

    const gPos      = gainUSD >= 0;
    const gINRPos   = gainINR >= 0;
    const gainPctINR = costINR > 0 ? gainINR / costINR * 100 : 0;
    const vestPriceINR    = lot.acquisitionPrice * pRate;
    const currentPriceINR = currentPrice * todayINR;

    if (currency === 'USD') {
      return `<div class="lot-card">
        <div class="lot-top">
          <div class="lot-top-left">
            <span class="lot-date">${fDate(lot.dateAcquired)}</span>
            <span class="badge ${lot.taxCategory.toLowerCase()}">${lot.taxCategory} · ${fHolding(lot.holdingMonths)}</span>
            <span class="badge ${lot.type.toLowerCase()}">${lot.type}</span>
          </div>
          <div class="schwab-pill"><div class="schwab-dot">CS</div><div class="schwab-name">CHARLES<br>SCHWAB</div></div>
        </div>
        <div class="lot-grid">
          <div><div class="lf-label">Shares</div><div class="lf-val">${lot.sharesHeld}</div></div>
          <div><div class="lf-label">Vest Price</div><div class="lf-val">$${lot.acquisitionPrice.toFixed(2)}</div><div class="lf-sub">₹${vestPriceINR.toFixed(0)} at buy rate</div></div>
          <div><div class="lf-label">Current Price</div><div class="lf-val">$${currentPrice.toFixed(2)}</div><div class="lf-sub">₹${currentPriceINR.toFixed(0)} at today rate</div></div>
          <div><div class="lf-label">Value</div><div class="lf-val">${fUSD(val,true)}</div><div class="lf-sub">${fINR(valINR,true)}</div></div>
        </div>
        <div class="lot-footer">
          <div class="gain-line ${gPos?'pos':'neg'}">${signStr(gainUSD)}${fUSD(Math.abs(gainUSD))} (${signStr(gainPct)}${Math.abs(gainPct).toFixed(1)}%)</div>
          <div class="tax-line">Tax: ${fUSD(taxAmt)} <span style="color:#aaa;font-size:11px">(${(taxRate*100).toFixed(1)}%)</span></div>
        </div>
        ${fxRow}
        ${ltcgBanner}
      </div>`;
    } else {
      return `<div class="lot-card">
        <div class="lot-top">
          <div class="lot-top-left">
            <span class="lot-date">${fDate(lot.dateAcquired)}</span>
            <span class="badge ${lot.taxCategory.toLowerCase()}">${lot.taxCategory} · ${fHolding(lot.holdingMonths)}</span>
            <span class="badge ${lot.type.toLowerCase()}">${lot.type}</span>
          </div>
          <div class="schwab-pill"><div class="schwab-dot">CS</div><div class="schwab-name">CHARLES<br>SCHWAB</div></div>
        </div>
        <div class="lot-grid">
          <div><div class="lf-label">Shares</div><div class="lf-val">${lot.sharesHeld}</div></div>
          <div>
            <div class="lf-label">Vest Price (₹)</div>
            <div class="lf-val">${fINR(vestPriceINR,true)}</div>
            <div class="lf-sub">$${lot.acquisitionPrice.toFixed(2)} × ₹${pRate.toFixed(2)}</div>
          </div>
          <div>
            <div class="lf-label">Current Price (₹)</div>
            <div class="lf-val">${fINR(currentPriceINR,true)}</div>
            <div class="lf-sub">$${currentPrice.toFixed(2)} × ₹${todayINR.toFixed(2)}</div>
          </div>
          <div>
            <div class="lf-label">Total Value (₹)</div>
            <div class="lf-val">${fINR(valINR,true)}</div>
            <div class="lf-sub">${lot.sharesHeld} × ₹${currentPriceINR.toFixed(0)}</div>
          </div>
        </div>
        <div class="lot-footer">
          <div class="gain-line ${gINRPos?'pos':'neg'}">${signStr(gainINR)}${fINR(Math.abs(gainINR),true)} (${signStr(gainPctINR)}${Math.abs(gainPctINR).toFixed(1)}%)</div>
          <div class="tax-line">Tax: ${fINR(taxAmt)} <span style="color:#aaa;font-size:11px">(${(taxRate*100).toFixed(1)}%)</span></div>
        </div>
        ${fxRow}
        ${ltcgBanner}
      </div>`;
    }
  } catch(e) { console.error('Lot render error', lot, e); return ''; } }).join('');
}

window.addEventListener('DOMContentLoaded', () => {
  renderPlatformCards();
  updateUploads();
});
