/**
 * Kingswood Cove — CRE Investment Platform
 * app.js  —  All application logic
 */

const AUTO_NAVIGATE_DELAY_MS = 1200;

/* ═══════════════════════════════════════════════════════════
   STATE
═══════════════════════════════════════════════════════════ */
const state = {
  // Live slider values
  purchasePrice:  30000000,
  capRateInput:   7.45,   // used to derive implied NOI when slider moves
  ltv:            65,
  interestRate:   6.25,
  occupancy:      93.2,
  noiGrowth:      2.5,

  // Fixed property data (from OM)
  gpr:            4802688,
  totalOpEx:      2156747,
  amortYears:     30,
  holdYears:      5,
  exitCapSpread:  0.30,   // exit cap = going-in cap + 0.30%

  // Scenario storage
  scenarios:        [],
  scenarioCounter:  0,
  apiKey:           '',
};

/* ═══════════════════════════════════════════════════════════
   CORE FINANCIAL CALCULATIONS
═══════════════════════════════════════════════════════════ */

/**
 * Standard mortgage monthly payment (P&I)
 * @param {number} principal
 * @param {number} annualRatePct  – e.g. 6.25 (not 0.0625)
 * @param {number} years
 * @returns {number} monthly payment
 */
function calcMonthlyPayment(principal, annualRatePct, years) {
  const r = annualRatePct / 100 / 12;
  const n = years * 12;
  if (r === 0) return principal / n;
  return principal * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
}

/**
 * Remaining loan balance after elapsed years
 */
function calcLoanBalance(principal, annualRatePct, totalYears, elapsedYears) {
  const r  = annualRatePct / 100 / 12;
  const n  = totalYears   * 12;
  const p  = elapsedYears * 12;
  if (r === 0) return principal * (1 - p / n);
  const pmt = principal * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
  return principal * Math.pow(1 + r, p) - pmt * (Math.pow(1 + r, p) - 1) / r;
}

/**
 * IRR via Newton-Raphson on cash-flow array
 * cashFlows[0] = negative initial equity outflow
 */
function calcIRR(cashFlows, guess = 0.10) {
  let rate = guess;
  for (let iter = 0; iter < 200; iter++) {
    let npv  = 0;
    let dnpv = 0;
    for (let t = 0; t < cashFlows.length; t++) {
      const factor = Math.pow(1 + rate, t);
      npv  += cashFlows[t] / factor;
      if (t > 0) dnpv -= t * cashFlows[t] / (factor * (1 + rate));
    }
    if (Math.abs(dnpv) < 1e-12) break;
    const next = rate - npv / dnpv;
    if (Math.abs(next - rate) < 1e-9) { rate = next; break; }
    rate = next;
  }
  return rate * 100;
}

/**
 * Derive all computed values from current state
 */
function getComputedValues() {
  const {
    purchasePrice, ltv, interestRate, occupancy, noiGrowth,
    gpr, totalOpEx, amortYears, holdYears, exitCapSpread,
  } = state;

  const egi          = gpr * (occupancy / 100);
  const noi          = egi - totalOpEx;
  const loanAmount   = purchasePrice * (ltv / 100);
  const equity       = purchasePrice - loanAmount;
  const monthlyPmt   = calcMonthlyPayment(loanAmount, interestRate, amortYears);
  const annualDS     = monthlyPmt * 12;
  const dscr         = annualDS > 0 ? noi / annualDS : 0;
  const goingInCap   = purchasePrice > 0 ? (noi / purchasePrice) * 100 : 0;
  const exitCap      = goingInCap + exitCapSpread;
  const freeCF       = noi - annualDS;
  const coc          = equity > 0 ? (freeCF / equity) * 100 : 0;
  const debtYield    = loanAmount > 0 ? (noi / loanAmount) * 100 : 0;
  const debtConst    = loanAmount > 0 ? (annualDS / loanAmount) * 100 : 0;
  const annualInterest = loanAmount * (interestRate / 100);
  const icr          = annualInterest > 0 ? noi / annualInterest : 0;
  const breakEvenOcc = gpr > 0 ? ((annualDS + totalOpEx) / gpr) * 100 : 0;

  // Year-5 exit
  const exitNOI   = noi  * Math.pow(1 + noiGrowth / 100, holdYears);
  const exitValue = exitCap > 0 ? (exitNOI / (exitCap / 100)) : 0;

  // Loan balance at exit
  const loanBalance = calcLoanBalance(loanAmount, interestRate, amortYears, holdYears);
  const netProceeds = exitValue - loanBalance;

  // IRR cash flows
  const cashFlows = [-equity];
  for (let y = 1; y < holdYears; y++) {
    const yearNOI = noi * Math.pow(1 + noiGrowth / 100, y);
    cashFlows.push(yearNOI - annualDS);
  }
  const yr5NOI = noi * Math.pow(1 + noiGrowth / 100, holdYears);
  cashFlows.push(yr5NOI - annualDS + netProceeds);

  const irr  = equity > 0 ? calcIRR(cashFlows) : 0;
  const moic = equity > 0 ? ((exitValue - loanBalance) + freeCF * holdYears) / equity : 0;

  return {
    egi, noi, loanAmount, equity, monthlyPmt, annualDS,
    dscr, goingInCap, exitCap, freeCF, coc, debtYield,
    debtConst, icr, breakEvenOcc, exitNOI, exitValue,
    loanBalance, netProceeds, irr, moic,
  };
}

/* ═══════════════════════════════════════════════════════════
   UI UPDATES
═══════════════════════════════════════════════════════════ */

function updateCalculations() {
  const cv = getComputedValues();

  /* ── Slider display labels ── */
  setText('sv-price',     '$' + (state.purchasePrice / 1e6).toFixed(1) + 'M');
  setText('sv-caprate',   state.capRateInput.toFixed(2) + '%');
  setText('sv-ltv',       state.ltv.toFixed(1) + '%');
  setText('sv-rate',      state.interestRate.toFixed(2) + '%');
  setText('sv-occ',       state.occupancy.toFixed(1) + '%');
  setText('sv-noigrowth', state.noiGrowth.toFixed(1) + '%');

  /* ── Calc output cards ── */
  // DSCR
  const dscrEl  = document.getElementById('co-dscr');
  const dscrInd = document.getElementById('co-dscr-ind');
  if (dscrEl) {
    dscrEl.textContent = cv.dscr.toFixed(2) + 'x';
    if (cv.dscr >= 1.35)       { dscrEl.style.color = '#16a34a'; dscrInd.textContent = '✅ Pass (≥1.25x)'; }
    else if (cv.dscr >= 1.20)  { dscrEl.style.color = '#d97706'; dscrInd.textContent = '⚠️ Marginal (1.20-1.25x)'; }
    else if (cv.dscr >= 1.0)   { dscrEl.style.color = '#dc2626'; dscrInd.textContent = '❌ Below Threshold'; }
    else                       { dscrEl.style.color = '#7c3aed'; dscrInd.textContent = '🔴 Cash Flow Negative'; }
  }

  // Cap Rate
  setText('co-caprate',     cv.goingInCap.toFixed(2) + '%');
  setText('co-caprate-ind', 'NOI ÷ Purchase Price');

  // Exit Value
  setText('co-exitval',     '$' + (cv.exitValue / 1e6).toFixed(1) + 'M');
  setText('co-exitval-ind', 'at ' + cv.exitCap.toFixed(2) + '% exit cap');

  // CoC
  const cocEl  = document.getElementById('co-coc');
  const cocInd = document.getElementById('co-coc-ind');
  if (cocEl) {
    cocEl.textContent = cv.coc.toFixed(1) + '%';
    if      (cv.coc >= 7)  { cocEl.style.color = '#16a34a'; cocInd.textContent = '✅ Strong cash flow'; }
    else if (cv.coc >= 5)  { cocEl.style.color = '#2563eb'; cocInd.textContent = 'After debt service'; }
    else if (cv.coc >= 3)  { cocEl.style.color = '#d97706'; cocInd.textContent = '⚠️ Thin margins'; }
    else                   { cocEl.style.color = '#dc2626'; cocInd.textContent = '❌ Negative cash flow'; }
  }

  /* ── Sidebar KPIs ── */
  setText('sk-dscr',      cv.dscr.toFixed(2)     + 'x');
  setText('sk-noi',       '$' + Math.round(cv.noi).toLocaleString());
  setText('sk-irr',       cv.irr.toFixed(1)       + '%');
  setText('sk-moic',      cv.moic.toFixed(2)      + 'x');
  setText('sk-coc',       cv.coc.toFixed(1)       + '%');
  setText('sk-em',        cv.moic.toFixed(2)      + 'x');
  setText('sk-goingcap',  cv.goingInCap.toFixed(2) + '%');
  setText('sk-exitcap',   cv.exitCap.toFixed(2)   + '%');
  setText('sk-ltv',       state.ltv.toFixed(1)    + '%');
  setText('sk-debtyield', cv.debtYield.toFixed(1) + '%');

  /* ── Pulse animation ── */
  document.querySelectorAll('.calc-output-card').forEach(el => {
    el.classList.add('pulse');
    setTimeout(() => el.classList.remove('pulse'), 400);
  });

  /* ── Rebuild sensitivity table ── */
  buildSensitivityTable(cv);
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

/* ── Sensitivity Table ── */
function buildSensitivityTable(cv) {
  const table = document.getElementById('sensitivity-table');
  if (!table) return;

  const capRates   = [7.00, 7.25, 7.50, 7.75, 8.00, 8.25, 8.50];
  const growths    = [0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0];

  let html = '<thead><tr><th>NOI Gr▸<br>Cap▾</th>';
  growths.forEach(g => { html += `<th>${g.toFixed(1)}%</th>`; });
  html += '</tr></thead><tbody>';

  capRates.forEach(cr => {
    html += `<tr><th>${cr.toFixed(2)}%</th>`;
    growths.forEach(g => {
      const exitN = cv.noi * Math.pow(1 + g / 100, 5);
      const val   = exitN / (cr / 100);
      const valM  = (val / 1e6).toFixed(1);
      const cls   = val >= 36e6 ? 'val-high' : (val >= 32e6 ? 'val-mid' : 'val-low');
      html += `<td class="${cls}">$${valM}M</td>`;
    });
    html += '</tr>';
  });

  html += '</tbody>';
  table.innerHTML = html;
}

/* ═══════════════════════════════════════════════════════════
   PAGE NAVIGATION
═══════════════════════════════════════════════════════════ */

function navigateTo(target) {
  if (target === 'upload') {
    document.getElementById('view-upload').classList.add('active');
    document.getElementById('view-app').classList.remove('active');
    return;
  }
  // Show app view, hide upload view
  document.getElementById('view-upload').classList.remove('active');
  document.getElementById('view-app').classList.add('active');

  // Switch pages within app
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach(n => n.classList.remove('active'));

  const page = document.getElementById('page-' + target);
  if (page) page.classList.add('active');

  const navBtn = document.querySelector('.nav-link[data-page="' + target + '"]');
  if (navBtn) navBtn.classList.add('active');
}

function initNavigation() {
  document.querySelectorAll('.nav-link').forEach(btn => {
    btn.addEventListener('click', () => {
      navigateTo(btn.dataset.page);
    });
  });
}

function updateSidebarFileIndicator(fileName) {
  const sfi = document.getElementById('sidebar-file-indicator');
  const sfn = document.getElementById('sidebar-file-name');
  if (sfi) sfi.style.display = 'flex';
  if (sfn) sfn.textContent = fileName;
}

/* ═══════════════════════════════════════════════════════════
   SLIDERS
═══════════════════════════════════════════════════════════ */

function initSliders() {
  const cfg = [
    { id: 'sl-price',     key: 'purchasePrice', parse: parseFloat },
    { id: 'sl-caprate',   key: 'capRateInput',  parse: parseFloat },
    { id: 'sl-ltv',       key: 'ltv',           parse: parseFloat },
    { id: 'sl-rate',      key: 'interestRate',  parse: parseFloat },
    { id: 'sl-occ',       key: 'occupancy',     parse: parseFloat },
    { id: 'sl-noigrowth', key: 'noiGrowth',     parse: parseFloat },
  ];
  cfg.forEach(({ id, key, parse }) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', e => {
      state[key] = parse(e.target.value);
      // Sync purchase price editable KPI input if slider moves
      if (key === 'purchasePrice') {
        const inp = document.getElementById('sk-price-input');
        if (inp) inp.value = state.purchasePrice;
      }
      updateCalculations();
    });
  });

  // Editable purchase price in sidebar
  const priceInp = document.getElementById('sk-price-input');
  if (priceInp) {
    priceInp.addEventListener('change', e => {
      const val = parseFloat(e.target.value);
      if (!isNaN(val) && val > 0) {
        state.purchasePrice = val;
        const slider = document.getElementById('sl-price');
        if (slider) slider.value = Math.max(25000000, Math.min(45000000, val));
        updateCalculations();
      }
    });
  }
}

/* ═══════════════════════════════════════════════════════════
   SCENARIOS
═══════════════════════════════════════════════════════════ */

function saveScenario() {
  const cv = getComputedValues();
  state.scenarioCounter++;
  state.scenarios.push({
    name:       'Scenario ' + state.scenarioCounter,
    price:      state.purchasePrice,
    capRate:    cv.goingInCap,
    ltv:        state.ltv,
    rate:       state.interestRate,
    occ:        state.occupancy,
    noiGrowth:  state.noiGrowth,
    dscr:       cv.dscr,
    coc:        cv.coc,
    exitValue:  cv.exitValue,
    irr:        cv.irr,
  });
  renderScenarioTable();
}

function clearScenarios() {
  // Keep only the Base Case
  state.scenarios = state.scenarios.filter(s => s.name === 'Base Case');
  renderScenarioTable();
}

function renderScenarioTable() {
  const tbody = document.getElementById('scenario-tbody');
  if (!tbody) return;

  let html = '';
  state.scenarios.forEach(s => {
    const isBase = s.name === 'Base Case';
    const dscrColor = s.dscr >= 1.25 ? '#16a34a' : '#dc2626';
    const cocColor  = s.coc  >= 5    ? '#16a34a' : '#d97706';
    html += `<tr class="${isBase ? 'base-row' : ''}">
      <td>${s.name}</td>
      <td>$${(s.price / 1e6).toFixed(1)}M</td>
      <td>${s.capRate.toFixed(2)}%</td>
      <td>${s.ltv.toFixed(0)}%</td>
      <td>${s.rate.toFixed(2)}%</td>
      <td>${s.occ.toFixed(1)}%</td>
      <td>${s.noiGrowth.toFixed(1)}%</td>
      <td style="color:${dscrColor};font-weight:700">${s.dscr.toFixed(2)}x</td>
      <td style="color:${cocColor};font-weight:700">${s.coc.toFixed(1)}%</td>
      <td>$${(s.exitValue / 1e6).toFixed(1)}M</td>
    </tr>`;
  });
  tbody.innerHTML = html || '<tr><td colspan="10" style="text-align:center;color:#94a3b8;padding:20px">No scenarios saved yet. Adjust sliders and click Save Scenario.</td></tr>';
}

function exportCSV() {
  if (state.scenarios.length === 0) {
    alert('No scenarios to export. Save at least one scenario first.');
    return;
  }
  const headers = ['Scenario', 'Price', 'Cap Rate', 'LTV', 'Rate', 'Occupancy', 'NOI Growth', 'DSCR', 'CoC Return', 'Exit Value'];
  const rows = state.scenarios.map(s => [
    s.name,
    '$' + (s.price / 1e6).toFixed(1) + 'M',
    s.capRate.toFixed(2) + '%',
    s.ltv.toFixed(0) + '%',
    s.rate.toFixed(2) + '%',
    s.occ.toFixed(1) + '%',
    s.noiGrowth.toFixed(1) + '%',
    s.dscr.toFixed(2) + 'x',
    s.coc.toFixed(1) + '%',
    '$' + (s.exitValue / 1e6).toFixed(1) + 'M',
  ]);

  const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href     = url;
  link.download = 'kingswood_cove_scenarios.csv';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/* ═══════════════════════════════════════════════════════════
   IC MEMO GENERATION
═══════════════════════════════════════════════════════════ */

function generateICMemo() {
  const cv    = getComputedValues();
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const html = `
<div class="ic-memo">
  <div class="ic-memo-header-block">
    <div class="ic-memo-headline">INVESTMENT COMMITTEE MEMORANDUM</div>
    <div class="ic-memo-sub">Kingswood Cove Apartments — Acquisition &amp; Value-Add Business Plan</div>
    <div class="ic-memo-date">Prepared: ${today} &nbsp;|&nbsp; Analyst: CRE Investment Team</div>
    <div class="ic-memo-confidential">Confidential — For Internal Use Only</div>
  </div>

  <h2>I. Executive Summary</h2>
  <p>We recommend the acquisition of Kingswood Cove Apartments, a 312-unit multifamily community located in Round Rock, TX, within the Austin-Round Rock MSA. The property presents a compelling value-add opportunity driven by an in-progress renovation program (87 of 312 units complete), a favorable debt structure, and strong submarket fundamentals including 3.2% population growth and 5.1% trailing rent growth.</p>
  <p>The deal is being acquired at a <strong>7.45% going-in cap rate</strong> on in-place NOI of $2,233,512, with a purchase price of <strong>$30,000,000 ($96,154/unit)</strong>. The projected 5-year IRR of <strong>14.8%</strong> and MOIC of <strong>1.73x</strong> meet or exceed fund return thresholds. DSCR of 1.50x provides meaningful debt service coverage buffer above the 1.25x minimum.</p>

  <h2>II. Property Overview</h2>
  <table class="memo-table">
    <thead><tr><th>Parameter</th><th>Detail</th></tr></thead>
    <tbody>
      <tr><td>Property Name</td><td>Kingswood Cove Apartments</td></tr>
      <tr><td>Location</td><td>Round Rock, TX (Austin-Round Rock MSA)</td></tr>
      <tr><td>Units</td><td>312 units</td></tr>
      <tr><td>Year Built / Renovated</td><td>1987 / 2019</td></tr>
      <tr><td>Unit Mix</td><td>120 × 1BR/1BA @ $1,050 | 148 × 2BR/2BA @ $1,395 | 44 × 3BR/2BA @ $1,685</td></tr>
      <tr><td>Physical Occupancy</td><td>93.2% (291 occupied / 312 total)</td></tr>
      <tr><td>Economic Occupancy</td><td>91.4%</td></tr>
      <tr><td>Avg In-Place Rent</td><td>$1,284/unit/month</td></tr>
      <tr><td>Avg Market Rent</td><td>$1,340/unit/month</td></tr>
      <tr><td>Loss-to-Lease</td><td>$56/unit/month (4.4%)</td></tr>
    </tbody>
  </table>

  <h2>III. Financial Summary</h2>
  <table class="memo-table">
    <thead><tr><th>Metric</th><th>Value</th></tr></thead>
    <tbody>
      <tr><td>Purchase Price</td><td>$30,000,000</td></tr>
      <tr><td>Price per Unit</td><td>$96,154</td></tr>
      <tr><td>Gross Potential Rent (GPR)</td><td>$4,802,688 / year</td></tr>
      <tr><td>Vacancy &amp; Credit Loss</td><td>$412,429 (8.6%)</td></tr>
      <tr><td>Effective Gross Income (EGI)</td><td>$4,390,259 / year</td></tr>
      <tr><td>Total Operating Expenses</td><td>$2,156,747 / year</td></tr>
      <tr><td>Net Operating Income (NOI)</td><td>$2,233,512 / year</td></tr>
      <tr><td>Operating Expense Ratio (OER)</td><td>49.1%</td></tr>
      <tr><td>NOI Margin</td><td>50.9%</td></tr>
    </tbody>
  </table>

  <h2>IV. Debt Structure</h2>
  <table class="memo-table">
    <thead><tr><th>Parameter</th><th>Detail</th></tr></thead>
    <tbody>
      <tr><td>Loan Amount</td><td>$19,500,000</td></tr>
      <tr><td>LTV</td><td>65.0%</td></tr>
      <tr><td>LTC (incl. $500K capex)</td><td>63.8%</td></tr>
      <tr><td>Interest Rate</td><td>6.25% Fixed</td></tr>
      <tr><td>Amortization</td><td>30 Years (no IO period)</td></tr>
      <tr><td>Annual Debt Service</td><td>$1,489,200</td></tr>
      <tr><td>Monthly Payment</td><td>$124,100</td></tr>
      <tr><td>DSCR</td><td>1.50x</td></tr>
      <tr><td>ICR (Interest Coverage Ratio)</td><td>1.98x</td></tr>
      <tr><td>Debt Constant</td><td>7.64%</td></tr>
      <tr><td>Debt Yield</td><td>11.5%</td></tr>
      <tr><td>Break-Even Occupancy</td><td>72.3% (safety margin: 20.9 pts)</td></tr>
      <tr><td>Free Cash Flow after DS</td><td>$744,312 / year</td></tr>
    </tbody>
  </table>

  <h2>V. Return Profile</h2>
  <table class="memo-table">
    <thead><tr><th>Return Metric</th><th>Projected</th><th>Target Hurdle</th><th>Assessment</th></tr></thead>
    <tbody>
      <tr><td>5-Year IRR</td><td>14.8%</td><td>≥ 13.0%</td><td>✅ Exceeds</td></tr>
      <tr><td>MOIC / Equity Multiple</td><td>1.73x</td><td>≥ 1.50x</td><td>✅ Exceeds</td></tr>
      <tr><td>Cash-on-Cash Return (Yr 1)</td><td>6.2%</td><td>≥ 5.0%</td><td>✅ Exceeds</td></tr>
      <tr><td>Going-in Cap Rate</td><td>7.45%</td><td>≥ 6.50%</td><td>✅ Exceeds</td></tr>
      <tr><td>Exit Cap Rate (Yr 5)</td><td>7.75%</td><td>—</td><td>+30 bps haircut applied</td></tr>
      <tr><td>Exit Value (Yr 5)</td><td>$35,200,000</td><td>—</td><td>$112,821/unit</td></tr>
      <tr><td>Gross Sale Profit</td><td>$5,200,000</td><td>—</td><td>17.3% appreciation</td></tr>
      <tr><td>Net Proceeds at Exit</td><td>~$8.1M</td><td>—</td><td>After loan payoff</td></tr>
    </tbody>
  </table>

  <h2>VI. Value-Add Thesis — Renovation Program</h2>
  <p>The property has an active renovation program with 87 of 312 units (27.9%) completed as of acquisition date. Renovated units are achieving a <strong>$121/month rent premium</strong> at an average cost of <strong>$6,200/unit</strong>, yielding a <strong>23.4% ROI</strong> with a 51-month payback period.</p>
  <p>Completing renovations on the remaining <strong>225 units</strong> would generate an additional <strong>$327,060/year</strong> in gross income (225 × $121 × 12). At the going-in cap rate of 7.45%, this income uplift creates approximately <strong>$4.2M in additional value</strong> — representing a significant component of the total return profile.</p>
  <table class="memo-table">
    <thead><tr><th>Renovation KPI</th><th>Value</th></tr></thead>
    <tbody>
      <tr><td>Units Renovated to Date</td><td>87 of 312 (27.9%)</td></tr>
      <tr><td>Average Renovation Cost</td><td>$6,200 / unit</td></tr>
      <tr><td>Average Rent Premium Achieved</td><td>$121 / month</td></tr>
      <tr><td>Renovation ROI</td><td>23.4%</td></tr>
      <tr><td>Payback Period</td><td>51.2 months</td></tr>
      <tr><td>Remaining Units (Opportunity)</td><td>225 units</td></tr>
      <tr><td>Total Remaining Capex Required</td><td>$1,395,000 (225 × $6,200)</td></tr>
      <tr><td>Incremental Annual NOI Uplift</td><td>$327,060</td></tr>
      <tr><td>Value Creation at Exit (7.75% cap)</td><td>$4,220,129</td></tr>
    </tbody>
  </table>

  <h2>VII. Market &amp; Submarket Analysis</h2>
  <p>Kingswood Cove is located in the Round Rock/Pflugerville submarket of the Austin-Round Rock MSA, one of the strongest growth markets in the United States. The submarket benefits from major employer anchors including Dell Technologies (HQ), Apple (campus expansion), Amazon (logistics), and Tesla (Gigafactory Austin).</p>
  <table class="memo-table">
    <thead><tr><th>Market Indicator</th><th>Value</th><th>Trend</th></tr></thead>
    <tbody>
      <tr><td>MSA Population Growth (YoY)</td><td>3.2%</td><td>📈 Strong</td></tr>
      <tr><td>MSA Job Growth (YoY)</td><td>2.8%</td><td>📈 Strong</td></tr>
      <tr><td>Unemployment Rate</td><td>3.4%</td><td>✅ Below national avg</td></tr>
      <tr><td>Submarket Rent Growth (T12)</td><td>+5.1%</td><td>📈 Above national avg</td></tr>
      <tr><td>Submarket Vacancy Rate</td><td>7.8%</td><td>Stable</td></tr>
      <tr><td>New Supply (12-month pipeline)</td><td>1,847 units</td><td>⚠️ Monitor</td></tr>
      <tr><td>12-Month Absorption</td><td>2,140 units</td><td>✅ Exceeds supply</td></tr>
      <tr><td>Net Absorption vs. Supply</td><td>+293 units</td><td>✅ Demand-driven</td></tr>
    </tbody>
  </table>
  <h3>Competitive Set</h3>
  <table class="memo-table">
    <thead><tr><th>Property</th><th>Year Built</th><th>Occupancy</th><th>Avg Rent</th><th>Vs. KC Rent</th></tr></thead>
    <tbody>
      <tr><td>Willow Creek</td><td>1994</td><td>94%</td><td>$1,310</td><td>+$26</td></tr>
      <tr><td>The Reserve at Round Rock</td><td>2001</td><td>91%</td><td>$1,360</td><td>+$76</td></tr>
      <tr><td>Stonegate Commons</td><td>1989</td><td>96%</td><td>$1,285</td><td>+$1</td></tr>
      <tr><td>Creekside Village</td><td>2008</td><td>89%</td><td>$1,420</td><td>+$136</td></tr>
      <tr><td><strong>★ Kingswood Cove</strong></td><td><strong>1987/2019</strong></td><td><strong>93.2%</strong></td><td><strong>$1,284</strong></td><td>—</td></tr>
    </tbody>
  </table>

  <h2>VIII. Risk Assessment</h2>
  <div class="risk-grid">
    <div class="risk-item risk-high">
      <div class="risk-label high">🔴 High Risk — Due Diligence</div>
      <div class="risk-desc">Rent roll not provided; unit-level income verification pending. T12 Q4 2023 data missing — NOI projection basis partially unverified.</div>
    </div>
    <div class="risk-item risk-medium">
      <div class="risk-label medium">🟡 Medium — Physical Condition</div>
      <div class="risk-desc">PCA pending completion. Deferred maintenance estimated at $1.2M unverified. 1987-vintage property carries elevated capex risk.</div>
    </div>
    <div class="risk-item risk-medium">
      <div class="risk-label medium">🟡 Medium — Renovation Execution</div>
      <div class="risk-desc">Value-add thesis dependent on completing 225 remaining units. Contractor pricing, timeline, and premium achievement not confirmed.</div>
    </div>
    <div class="risk-item risk-medium">
      <div class="risk-label medium">🟡 Medium — Interest Rate Risk</div>
      <div class="risk-desc">Fixed rate financing mitigates refinance risk for hold period. Exit financing environment at Year 5 is a key assumption.</div>
    </div>
    <div class="risk-item risk-low">
      <div class="risk-label low">🟢 Low — Environmental</div>
      <div class="risk-desc">Phase I environmental clear — no recognized environmental conditions (RECs). Flood Zone X (minimal risk). Seismic N/A.</div>
    </div>
    <div class="risk-item risk-low">
      <div class="risk-label low">🟢 Low — Market Risk</div>
      <div class="risk-desc">Austin MSA fundamentals remain strong: absorption exceeds supply, population and job growth above national average, diversified employer base.</div>
    </div>
  </div>

  <h2>IX. ESG Considerations</h2>
  <p>Water usage of 4.2 gallons/unit/day and electricity of 8.1 kWh/unit/day represent opportunities for efficiency improvements. No solar panels or EV charging stations are currently installed — both represent potential value-add and ESG enhancement opportunities that could support premium positioning. Annual capital reserves of $88,000 ($282/unit) are adequate but may need to be increased following PCA completion given 1987 vintage.</p>

  <h2>X. Conditions &amp; Recommendations</h2>
  <div class="rec-box">
    <div class="rec-title">✅ IC Recommendation: PROCEED — Subject to Conditions</div>
    <ul class="rec-items">
      <li>Obtain complete unit-level rent roll prior to hard earnest money going non-refundable (May 1)</li>
      <li>Complete Property Condition Assessment (PCA) and review findings; increase reserves if deferred maintenance exceeds $1.5M</li>
      <li>Request T12 for full calendar year 2023; validate NOI within 5% of OM projections</li>
      <li>Confirm utility metering structure; re-run model if master-metered with material impact</li>
      <li>Obtain 3 contractor bids for remaining 225-unit renovation scope; validate $6,200/unit cost estimate</li>
      <li>Lock financing rate on or before commitment letter (May 10) given rate environment</li>
      <li>Negotiate seller credit for verified deferred maintenance items identified in PCA</li>
    </ul>
  </div>

  <div class="verdict-box">
    <div class="verdict-label">Investment Committee Recommendation</div>
    <div class="verdict-value">CONDITIONAL PROCEED ✅</div>
    <div class="verdict-sub">14.8% IRR | 1.73x MOIC | 1.50x DSCR | $30.0M @ 7.45% Cap | Subject to 7 conditions above</div>
  </div>
</div>`;

  document.getElementById('ic-memo-content').innerHTML = html;
  document.getElementById('ic-memo-modal').classList.add('show');
}

function closeICMemo() {
  document.getElementById('ic-memo-modal').classList.remove('show');
}

// Close modal on overlay click
document.getElementById('ic-memo-modal').addEventListener('click', function (e) {
  if (e.target === this) closeICMemo();
});

/* ═══════════════════════════════════════════════════════════
   ASK DOCUMENT / CHAT
═══════════════════════════════════════════════════════════ */

function saveApiKey() {
  const keyInput = document.getElementById('anthropic-key');
  if (!keyInput) return;
  const key = keyInput.value.trim();
  state.apiKey = key;
  if (key) {
    addChatMessage('assistant', 'API key saved. I\'ll use Claude AI for responses. Ask me anything about Kingswood Cove!');
  } else {
    addChatMessage('assistant', 'API key cleared. I\'ll use pre-built OM responses.');
  }
}

/** Pre-built HTML responses — keyed by short topic key, never by user input */
const PREBUILT_HTML = {
  noi: `<strong>Net Operating Income (NOI) — Kingswood Cove</strong>
The current NOI for Kingswood Cove is <strong>$2,233,512 per year</strong>, calculated as follows:

• Gross Potential Rent (GPR): $4,802,688/year (312 units × avg $1,284 × 12 months)
• Less Vacancy &amp; Credit Loss: ($412,429) — 8.6% of GPR reflecting 93.2% physical / 91.4% economic occupancy
• = Effective Gross Income (EGI): $4,390,259
• Less Total Operating Expenses: ($2,156,747) — OER of 49.1%
• = <strong>Net Operating Income: $2,233,512</strong>

This translates to a NOI margin of <strong>50.9%</strong> and supports the going-in cap rate of <strong>7.45%</strong> at the $30M purchase price. Key expense drivers are Payroll ($612K, 28.4%), Property Tax ($445K, 20.6%), and R&M ($287K, 13.3%).`,

  occ: `<strong>Occupancy Overview — Kingswood Cove</strong>

• <strong>Physical Occupancy: 93.2%</strong> — 291 of 312 units occupied
• <strong>Economic Occupancy: 91.4%</strong> — reflects concessions and non-paying units
• Vacancy &amp; Credit Loss: 8.6% of GPR ($412,429/year)
• Concessions: $18,000/year

<strong>Competitive Context:</strong>
Kingswood Cove's 93.2% occupancy compares favorably to the submarket. The comp set ranges from 89% (Creekside Village) to 96% (Stonegate Commons), with a weighted average of ~92.6%. The property is performing at or above submarket occupancy while carrying a rent discount to market ($1,284 vs $1,340 market average).

<strong>Lease Expiration Risk:</strong> Peak expiration months are May (13%), June (11.6%), and September (11%), creating moderate rollover concentration risk in Q2 that should be monitored.`,

  reno: `<strong>Renovation Value-Add Thesis — Kingswood Cove</strong>

Kingswood Cove has an active renovation program with compelling economics:

<strong>Completed Work (87 units):</strong>
• Avg renovation cost: $6,200/unit
• Avg rent premium achieved: $121/month
• ROI: 23.4% | Payback: 51.2 months

<strong>Remaining Opportunity (225 units = 72.1% of portfolio):</strong>
• Total capex required: ~$1,395,000 (225 × $6,200)
• Incremental annual income: $327,060 (225 × $121 × 12)
• Value creation at exit: ~$4.2M (at 7.75% cap rate)

<strong>Unit Mix Opportunity:</strong>
All unit types show a gap vs. market rents — 1BR ($1,050 vs $1,095 market), 2BR ($1,395 vs $1,450), 3BR ($1,685 vs $1,740). Renovation premiums of $121/month are being achieved on top of base market rents, indicating strong demand for upgraded finishes.

<strong>Important:</strong> Contractor bids for the remaining 225 units have not been confirmed. Recommend obtaining 3 current bids before hard earnest money to validate $6,200/unit estimate given recent labor/materials inflation.`,

  risk: `<strong>Key Risk Factors — Kingswood Cove</strong>

<strong>🔴 HIGH — Due Diligence Gaps:</strong>
1. Rent roll not provided — cannot verify individual unit rents or lease expirations. Critical for income validation.
2. T12 Q4 2023 missing — NOI projection basis is partially unverified. Full year needed to confirm seasonal patterns.

<strong>🟡 MEDIUM — Physical/Operational:</strong>
3. PCA pending — $1.2M deferred maintenance estimate is unverified. 1987-vintage property carries elevated capex tail risk.
4. Renovation execution — value-add thesis dependent on completing 225 units at budgeted costs and achieving premium.
5. Utility metering — if master-metered, could represent significant hidden expense exposure impacting NOI.

<strong>🟡 MEDIUM — Market/Financial:</strong>
6. Interest rate risk — fixed rate mitigates current period risk but exit refinancing in Year 5 is uncertain.
7. Supply pipeline — 1,847 new units entering submarket over next 12 months. Monitor absorption trends.

<strong>🟢 LOW — Mitigated Risks:</strong>
8. Environmental: Phase I clear, Flood Zone X, no seismic risk.
9. Occupancy: 93.2% physical occ with 20.9-point buffer above break-even (72.3%).
10. DSCR: 1.50x provides meaningful cushion above 1.25x lender minimum.`,

  debt: `<strong>Debt Structure Summary — Kingswood Cove</strong>

<strong>Loan Parameters:</strong>
• Loan Amount: $19,500,000
• LTV: 65.0% (on $30M purchase price)
• LTC: 63.8% (including $500K capex budget)
• Interest Rate: 6.25% Fixed
• Amortization: 30 years (no interest-only period)
• Monthly Payment: $124,100
• Annual Debt Service: $1,489,200

<strong>Coverage Ratios:</strong>
• DSCR: 1.50x — strong coverage, 25 bps above typical 1.25x minimum
• ICR (Interest Coverage): 1.98x — NOI covers interest-only payment ~2x
• Debt Yield: 11.5% — NOI/Loan Amount, above typical 9-10% lender floor
• Debt Constant: 7.64% — annual debt service as % of loan

<strong>Cash Flow After Debt Service:</strong>
• Free Cash Flow: $744,312/year ($2,386/unit/year)
• Year 1 CoC: 6.2% on $10.5M equity investment

<strong>Break-Even Analysis:</strong>
Break-even occupancy of 72.3% provides a 20.9-point safety margin above current 93.2% physical occupancy, suggesting strong downside protection even in a significant market downturn scenario.`,

  exit: `<strong>Exit Strategy — Kingswood Cove (5-Year Hold)</strong>

<strong>Base Case Exit (Year 5):</strong>
• Exit Cap Rate: 7.75% (going-in cap + 30 bps haircut for asset age)
• Exit NOI (Yr 5): ~$2,513,000 (at 2.5% annual NOI growth)
• Exit Value: $35,200,000
• Exit Value/Unit: $112,821 (+17.4% from acquisition)

<strong>Return Summary:</strong>
• Gross Appreciation: $5,200,000 (17.3%)
• Net Proceeds (after $~27.1M loan payoff): ~$8.1M
• 5-Year IRR: 14.8%
• MOIC: 1.73x

<strong>Key Exit Assumptions:</strong>
1. NOI grows at 2.5% annually driven by rent growth and renovation completions
2. Full renovation program executed (remaining 225 units), adding $327K+ to NOI
3. Cap rate expansion of 30 bps to 7.75% accounts for asset aging
4. Loan payoff from sale proceeds; no prepayment penalty assumed

<strong>Sensitivity:</strong> At 8.50% exit cap with 0% NOI growth, exit value = ~$26.3M. At 7.00% exit cap with 3% growth, exit value = ~$43.7M. The base case sits in the middle of the probability-weighted range.`,

  comps: `<strong>Market Comp Analysis — Kingswood Cove</strong>

<strong>Competitive Set Summary:</strong>

| Property | Occupancy | Avg Rent | Year Built | vs. KC |
|---|---|---|---|---|
| Willow Creek | 94% | $1,310 | 1994 | +$26/mo |
| The Reserve at RR | 91% | $1,360 | 2001 | +$76/mo |
| Stonegate Commons | 96% | $1,285 | 1989 | +$1/mo |
| Creekside Village | 89% | $1,420 | 2008 | +$136/mo |
| <strong>★ Kingswood Cove</strong> | <strong>93.2%</strong> | <strong>$1,284</strong> | <strong>1987</strong> | — |

<strong>Key Observations:</strong>
1. Kingswood Cove is priced at the low end of the comp set despite competitive occupancy (93.2% vs. 92% avg comp). This represents a value-add opportunity — post-renovation, rents can likely achieve $1,340+ (market average).
2. The $56/month loss-to-lease gap vs. market average ($1,284 vs $1,340) suggests meaningful organic rent growth potential independent of renovation program.
3. Stonegate Commons (1989 vintage, 96% occ, $1,285 avg) is the most comparable asset — suggests current rent levels have modest organic uplift potential of $1-2/month without renovation.
4. Creekside Village's premium ($1,420) reflects newer construction (2008) — renovation program can help Kingswood Cove close part of this gap.`,

  data: `<strong>Data Gaps &amp; Missing Information — Kingswood Cove</strong>

<strong>🔴 CRITICAL (Required before hard earnest money):</strong>
1. <strong>Unit-Level Rent Roll</strong> — Individual unit rents, lease dates, tenant names, concessions. Cannot verify NOI without this.
2. <strong>T12 Full Year 2023</strong> — Q4 2023 financials missing. Need full trailing 12 months to confirm expense seasonality and NOI run rate.

<strong>🟡 IMPORTANT (Required before closing):</strong>
3. <strong>PCA Report</strong> — $1.2M deferred maintenance estimate is unverified. PCA ordered but not complete.
4. <strong>Renovation Contractor Bids</strong> — No bids provided for remaining 225 units. $6,200/unit average needs current pricing validation.
5. <strong>Utility Metering Structure</strong> — Master-metered vs. sub-metered not confirmed. Could materially impact EGI.
6. <strong>Loan Documents</strong> — Full credit agreement, prepayment terms, and covenant package not yet reviewed.

<strong>🟢 AVAILABLE (Data confirmed):</strong>
✅ Phase I Environmental (complete — clear)
✅ Title search (complete — no issues)
✅ Zoning confirmation (R-5 Multifamily)
✅ Site visit and physical inspection (basic)
✅ Occupancy history and comp set rents
✅ Expense breakdown and budget summary
✅ Insurance commitments

<strong>Data Completeness Score: 62% (31 of 50 key fields populated)</strong>`,

  default: `<strong>Kingswood Cove — OM Assistant</strong>
I don't have a specific pre-built response for that exact question, but here's a summary from the OM:

Kingswood Cove is a <strong>312-unit multifamily</strong> property in Round Rock, TX (Austin MSA), acquired in 2024 at <strong>$30M ($96,154/unit)</strong>. Key metrics: NOI $2,233,512 | Cap Rate 7.45% | DSCR 1.50x | 93.2% occupancy | 5-yr IRR 14.8% | MOIC 1.73x.

Try one of the quick questions above, or ask specifically about: <em>NOI, occupancy rates, renovation opportunity, risk factors, debt terms, exit strategy, market comps,</em> or <em>missing data</em>.`,
};

async function askDocument(question) {
  if (!question || !question.trim()) return;

  const input = document.getElementById('chat-input');
  if (input) input.value = '';

  // Add user message (always plain text — no HTML rendering)
  addChatMessage('user', question.trim());

  // Add loading indicator
  const loadingId = addLoadingMessage();

  // Small delay for UX
  await new Promise(r => setTimeout(r, 600));

  removeMessage(loadingId);

  // Try Anthropic API first
  if (state.apiKey && state.apiKey.startsWith('sk-ant')) {
    const apiText = await callAnthropicAPI(question);
    if (apiText) {
      addChatMessage('assistant', apiText); // plain text
      scrollChat();
      return;
    }
  }

  // Fall back to pre-built responses — identified by key, never user-derived HTML
  const responseKey = matchPrebuiltKey(question);
  renderPrebuiltResponse(responseKey);
  scrollChat();
}

/**
 * Maps a user question to a pre-built response key.
 * Returns a key string — never HTML, never user content.
 */
function matchPrebuiltKey(question) {
  const q = question.toLowerCase().trim();
  if (q.includes('noi') || q.includes('income'))                           return 'noi';
  if (q.includes('occup') || q.includes('vacancy'))                        return 'occ';
  if (q.includes('reno') || q.includes('value-add') || q.includes('renovation')) return 'reno';
  if (q.includes('risk'))                                                   return 'risk';
  if (q.includes('debt') || q.includes('loan') || q.includes('dscr'))      return 'debt';
  if (q.includes('exit') || q.includes('irr') || q.includes('return'))     return 'exit';
  if (q.includes('comp') || q.includes('market'))                          return 'comps';
  if (q.includes('missing') || q.includes('data') || q.includes('gap'))    return 'data';
  return 'default';
}

/** Renders a pre-built HTML response using only its constant key. No user data flows here. */
function renderPrebuiltResponse(key) {
  const msgs = document.getElementById('chat-messages');
  if (!msgs) return;

  const htmlContent = PREBUILT_HTML[key] || PREBUILT_HTML['default'];

  const avatar = document.createElement('div');
  avatar.className = 'chat-avatar';
  avatar.textContent = '🤖';

  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';
  // Safe: htmlContent is always a compile-time constant from PREBUILT_HTML — no user input flows here
  bubble.innerHTML = htmlContent;

  const div = document.createElement('div');
  div.className = 'chat-msg assistant';
  div.id = 'msg-' + (++msgId);
  div.appendChild(avatar);
  div.appendChild(bubble);
  msgs.appendChild(div);
}

function scrollChat() {
  const msgs = document.getElementById('chat-messages');
  if (msgs) msgs.scrollTop = msgs.scrollHeight;
}

async function callAnthropicAPI(question) {
  try {
    const context = `You are analyzing the Offering Memorandum for Kingswood Cove Apartments, a 312-unit multifamily property in Round Rock, TX (Austin MSA). Key facts: Purchase Price $30M, NOI $2,233,512, Cap Rate 7.45%, DSCR 1.50x, LTV 65%, Interest Rate 6.25% fixed 30yr am, Physical Occupancy 93.2%, Avg In-Place Rent $1,284, Market Rent $1,340, 5-yr IRR 14.8%, MOIC 1.73x, Exit Value $35.2M at 7.75% cap. Unit mix: 1BR/1BA 120 units $1,050, 2BR/2BA 148 units $1,395, 3BR/2BA 44 units $1,685. Year built 1987, renovated 2019. Renovation program: 87 of 312 units renovated, $6,200/unit cost, $121/mo premium, 23.4% ROI. Expense breakdown: Payroll $612K, Tax $445K, R&M $287K, Insurance $198K, Utilities $184K, Admin $156K, Mgmt $131K, Reserves $88K, Marketing $55K. Market: Austin-Round Rock MSA, Pop growth 3.2%, Job growth 2.8%, Unemployment 3.4%, Rent growth 5.1%, Vacancy 7.8%, Supply 1847 units, Absorption 2140 units. Comps: Willow Creek (94%, $1,310), Reserve at RR (91%, $1,360), Stonegate Commons (96%, $1,285), Creekside Village (89%, $1,420). Data gaps: No rent roll, T12 Q4 missing, PCA pending.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':         'application/json',
        'x-api-key':            state.apiKey,
        'anthropic-version':    '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model:       'claude-3-5-sonnet-20241022',
        max_tokens:  1024,
        system:      context,
        messages: [{ role: 'user', content: question }],
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || 'API error ' + response.status);
    }

    const data = await response.json();
    return data?.content?.[0]?.text || '';
  } catch (err) {
    console.warn('Anthropic API error:', err.message);
    return ''; // Fall through to pre-built responses
  }
}

/** Escape HTML special chars to prevent XSS from user-supplied text */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#39;');
}

let msgId = 0;
/**
 * @param {string} role     'user' | 'assistant'
 * @param {string} content  message text/HTML
 * @param {boolean} isHtml  true only for pre-built trusted HTML responses
 */
function addChatMessage(role, content, isHtml = false) {
  const id  = 'msg-' + (++msgId);
  const msgs = document.getElementById('chat-messages');
  if (!msgs) return id;

  const avatar  = document.createElement('div');
  avatar.className = 'chat-avatar';
  avatar.textContent = role === 'user' ? '👤' : '🤖';

  const bubble  = document.createElement('div');
  bubble.className = 'chat-bubble';
  // Only render HTML for pre-built trusted assistant responses; everything else is escaped text
  if (isHtml && role === 'assistant') {
    bubble.innerHTML = content;
  } else {
    bubble.textContent = content;
  }

  const div = document.createElement('div');
  div.className = 'chat-msg ' + role; // role is always 'user' or 'assistant' — no escaping needed
  div.id = id;
  div.appendChild(avatar);
  div.appendChild(bubble);

  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  return id;
}

function addLoadingMessage() {
  const id   = 'msg-' + (++msgId);
  const msgs = document.getElementById('chat-messages');
  if (!msgs) return id;

  const div = document.createElement('div');
  div.className = 'chat-msg assistant';
  div.id = id;
  div.innerHTML = `
    <div class="chat-avatar">🤖</div>
    <div class="chat-bubble chat-loading">
      <div class="chat-loading-dot"></div>
      <div class="chat-loading-dot"></div>
      <div class="chat-loading-dot"></div>
    </div>
  `;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  return id;
}

function removeMessage(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

/* ═══════════════════════════════════════════════════════════
   DOCUMENT UPLOAD & CRE DATA EXTRACTION ENGINE
═══════════════════════════════════════════════════════════ */

function setUploadStatus(msg, pct) {
  const statusEl = document.getElementById('upload-status');
  const fillEl   = document.getElementById('upload-status-fill');
  const msgEl    = document.getElementById('upload-msg');
  if (statusEl) statusEl.style.display = 'block';
  if (fillEl)   fillEl.style.width = pct + '%';
  if (msgEl)    msgEl.textContent = msg;
}

function handleDrop(event) {
  event.preventDefault();
  document.getElementById('upload-drop').classList.remove('drag-over');
  const file = event.dataTransfer.files[0];
  if (file) processFile(file);
}

function handleFileSelect(event) {
  const file = event.target.files[0];
  if (file) processFile(file);
  // Reset input so same file can be re-uploaded
  event.target.value = '';
}

function processFile(file) {
  const nameEl = document.getElementById('upload-file-name');
  const iconEl = document.getElementById('upload-file-icon');
  const fieldsEl = document.getElementById('upload-fields');
  if (nameEl) nameEl.textContent = file.name;
  if (fieldsEl) fieldsEl.innerHTML = '';
  const ext = file.name.split('.').pop().toLowerCase();
  const icons = { pdf: '📕', xlsx: '📗', xls: '📗', csv: '📊', txt: '📄', text: '📄' };
  if (iconEl) iconEl.textContent = icons[ext] || '📄';
  setUploadStatus('Reading file…', 10);

  if (ext === 'pdf') {
    // Use object URL so pdf.js can stream large files without loading all into memory
    parsePDF(file);
  } else if (ext === 'xlsx' || ext === 'xls') {
    const reader = new FileReader();
    reader.onerror = () => setUploadStatus('⚠ Could not read file.', 0);
    reader.onload = e => {
      setUploadStatus('Parsing spreadsheet…', 40);
      try { parseExcel(e.target.result); }
      catch (err) { setUploadStatus('⚠ Error: ' + err.message, 0); }
    };
    reader.readAsArrayBuffer(file);
  } else {
    const reader = new FileReader();
    reader.onerror = () => setUploadStatus('⚠ Could not read file.', 0);
    reader.onload = e => {
      setUploadStatus('Extracting CRE fields…', 70);
      try {
        const extracted = extractCREData(e.target.result);
        applyExtractedData(extracted);
        setUploadStatus('✅ Done — ' + extracted.extractedFields.length + ' fields extracted.', 100);
        showExtractedTags(extracted.extractedFields);

        updateSidebarFileIndicator(file.name);
        setTimeout(() => navigateTo('dashboard'), AUTO_NAVIGATE_DELAY_MS);
      } catch (err) { setUploadStatus('⚠ Error: ' + err.message, 0); }
    };
    reader.readAsText(file);
  }
}

function parsePDF(file) {
  if (typeof pdfjsLib === 'undefined') {
    setUploadStatus('⚠ PDF.js not loaded. Try CSV/TXT.', 0);
    return;
  }
  // Set worker source
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  // Use object URL to stream file — avoids loading entire large PDF into memory
  const objectUrl = URL.createObjectURL(file);
  const loadingTask = pdfjsLib.getDocument({
    url: objectUrl,
    disableRange: false,
    rangeChunkSize: 65536,
    disableStream: false,
  });

  loadingTask.promise.then(pdf => {
    const total = pdf.numPages;
    const texts = [];
    let done = 0;

    function getNextPage(n) {
      pdf.getPage(n).then(page => {
        return page.getTextContent();
      }).then(tc => {
        texts.push(tc.items.map(i => i.str).join(' '));
        done++;
        setUploadStatus('Parsing PDF page ' + done + '/' + total + '…', 20 + (done / total * 55));
        if (done < total) {
          getNextPage(n + 1);
        } else {
          URL.revokeObjectURL(objectUrl);
          const fullText = texts.join('\n');
          setUploadStatus('Extracting CRE fields…', 80);
          try {
            const extracted = extractCREData(fullText);
            applyExtractedData(extracted);
            setUploadStatus('✅ Done — ' + extracted.extractedFields.length + ' fields from ' + total + '-page PDF.', 100);
            showExtractedTags(extracted.extractedFields);

            updateSidebarFileIndicator(file.name);
            setTimeout(() => navigateTo('dashboard'), AUTO_NAVIGATE_DELAY_MS);
          } catch (err) { setUploadStatus('⚠ Extraction error: ' + err.message, 0); }
        }
      }).catch(err => {
        URL.revokeObjectURL(objectUrl);
        setUploadStatus('⚠ PDF page error: ' + err.message, 0);
      });
    }
    getNextPage(1);
  }).catch(err => {
    URL.revokeObjectURL(objectUrl);
    setUploadStatus('⚠ PDF error: ' + err.message, 0);
  });
}

function parseExcel(arrayBuffer) {
  if (typeof XLSX === 'undefined') {
    setUploadStatus('⚠ SheetJS not loaded. Try CSV/TXT.', 0);
    return;
  }
  const wb = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });
  const allText = [];
  wb.SheetNames.forEach(name => {
    allText.push('=== Sheet: ' + name + ' ===\n' + XLSX.utils.sheet_to_csv(wb.Sheets[name]));
  });
  const fullText = allText.join('\n\n');
  setUploadStatus('Extracting from spreadsheet…', 60);
  const extracted = extractCREData(fullText);

  // Additional structured extraction from cell key-value pairs
  wb.SheetNames.forEach(name => {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1 });
    rows.forEach(row => {
      if (!Array.isArray(row)) return;
      const k = (row[0] || '').toString().toLowerCase().trim();
      const v = row[1] != null ? row[1] : row[2];
      if (!k || v == null) return;
      const n = typeof v === 'number' ? v : parseFloat((v + '').replace(/[$,%]/g, ''));
      if (isNaN(n)) return;
      if (k.includes('purchase price') || k.includes('asking price')) extracted.purchasePrice = extracted.purchasePrice || n;
      if (k === 'noi' || k.includes('net operating income')) extracted.noi = extracted.noi || n;
      if (k.includes('cap rate')) { const p = n > 1 ? n : n * 100; if (p > 1 && p < 20) extracted.capRateGoing = extracted.capRateGoing || p; }
      if (k.includes('units') || k === '# of units') { if (n > 0 && n < 50000) extracted.units = extracted.units || Math.round(n); }
      if (k.includes('occupancy')) { const p2 = n > 1 ? n : n * 100; if (p2 > 30 && p2 <= 100) extracted.physicalOccupancy = extracted.physicalOccupancy || p2; }
      if (k.includes('interest rate')) { const r = n > 1 ? n : n * 100; if (r > 0.5 && r < 30) extracted.interestRate = extracted.interestRate || r; }
      if (k.includes('loan amount') || k.includes('mortgage')) { if (n > 10000) extracted.loanAmount = extracted.loanAmount || n; }
    });
  });

  applyExtractedData(extracted);
  setUploadStatus('✅ Done — ' + extracted.extractedFields.length + ' fields from spreadsheet.', 100);
  showExtractedTags(extracted.extractedFields);

  updateSidebarFileIndicator(document.getElementById('upload-file-name')?.textContent || 'Spreadsheet');
  setTimeout(() => navigateTo('dashboard'), AUTO_NAVIGATE_DELAY_MS);
}

function extractCREData(text) {
  const result = {
    purchasePrice: null, noi: null, capRateGoing: null,
    physicalOccupancy: null, interestRate: null, loanAmount: null,
    gpr: null, totalOpEx: null, units: null,
    extractedFields: [],
  };

  function parseNum(str) {
    return parseFloat(str.replace(/[$,\s]/g, ''));
  }

  // Purchase price
  const priceM = text.match(/(?:purchase\s+price|asking\s+price|sale\s+price)[^\d]*\$?([\d,]+(?:\.\d+)?\s*(?:million|M)?)/i);
  if (priceM) {
    let v = parseNum(priceM[1]);
    if (/million|M/i.test(priceM[1])) v *= 1e6;
    if (v > 100000) { result.purchasePrice = v; result.extractedFields.push('Purchase Price'); }
  }

  // NOI
  const noiM = text.match(/(?:net\s+operating\s+income|NOI)[^\d]*\$?([\d,]+(?:\.\d+)?)/i);
  if (noiM) {
    const v = parseNum(noiM[1]);
    if (v > 1000 && v < 1e9) { result.noi = v; result.extractedFields.push('NOI'); }
  }

  // Cap rate
  const capM = text.match(/(?:cap(?:italization)?\s+rate|going[- ]in\s+cap)[^\d]*(\d{1,2}(?:\.\d+)?)\s*%/i);
  if (capM) {
    const v = parseFloat(capM[1]);
    if (v > 1 && v < 20) { result.capRateGoing = v; result.extractedFields.push('Cap Rate'); }
  }

  // Occupancy
  const occM = text.match(/(?:physical\s+occupancy|occupancy(?:\s+rate)?)[^\d]*(\d{2,3}(?:\.\d+)?)\s*%/i);
  if (occM) {
    const v = parseFloat(occM[1]);
    if (v > 30 && v <= 100) { result.physicalOccupancy = v; result.extractedFields.push('Occupancy'); }
  }

  // Interest rate
  const rateM = text.match(/(?:interest\s+rate|coupon)[^\d]*(\d{1,2}(?:\.\d+)?)\s*%/i);
  if (rateM) {
    const v = parseFloat(rateM[1]);
    if (v > 0.5 && v < 30) { result.interestRate = v; result.extractedFields.push('Interest Rate'); }
  }

  // GPR
  const gprM = text.match(/(?:gross\s+potential\s+rent(?:al)?(?:\s+income)?|GPR)[^\d]*\$?([\d,]+(?:\.\d+)?)/i);
  if (gprM) {
    const v = parseNum(gprM[1]);
    if (v > 1000 && v < 1e9) { result.gpr = v; result.extractedFields.push('GPR'); }
  }

  // Total expenses
  const opexM = text.match(/(?:total\s+(?:operating\s+)?expenses?|op(?:erating)?\s+expenses?)[^\d]*\$?([\d,]+(?:\.\d+)?)/i);
  if (opexM) {
    const v = parseNum(opexM[1]);
    if (v > 1000 && v < 1e9) { result.totalOpEx = v; result.extractedFields.push('Operating Expenses'); }
  }

  // Units
  const unitsM = text.match(/(\d{2,4})\s*(?:unit|apartment|residential)\s*(?:s|community)?/i);
  if (unitsM) {
    const v = parseInt(unitsM[1]);
    if (v > 4 && v < 50000) { result.units = v; result.extractedFields.push('Units'); }
  }

  return result;
}

function applyExtractedData(extracted) {
  if (extracted.purchasePrice && extracted.purchasePrice > 0) {
    state.purchasePrice = extracted.purchasePrice;
    const slider = document.getElementById('sl-price');
    if (slider) slider.value = Math.max(+slider.min, Math.min(+slider.max, extracted.purchasePrice));
    const inp = document.getElementById('sk-price-input');
    if (inp) inp.value = extracted.purchasePrice;
  }
  if (extracted.capRateGoing && extracted.capRateGoing > 0) {
    state.capRateInput = extracted.capRateGoing;
    const slider = document.getElementById('sl-caprate');
    if (slider) slider.value = Math.max(+slider.min, Math.min(+slider.max, extracted.capRateGoing));
  }
  if (extracted.physicalOccupancy && extracted.physicalOccupancy > 0) {
    state.occupancy = extracted.physicalOccupancy;
    const slider = document.getElementById('sl-occ');
    if (slider) slider.value = Math.max(+slider.min, Math.min(+slider.max, extracted.physicalOccupancy));
  }
  if (extracted.interestRate && extracted.interestRate > 0) {
    state.interestRate = extracted.interestRate;
    const slider = document.getElementById('sl-rate');
    if (slider) slider.value = Math.max(+slider.min, Math.min(+slider.max, extracted.interestRate));
  }
  if (extracted.gpr && extracted.gpr > 0)       state.gpr       = extracted.gpr;
  if (extracted.totalOpEx && extracted.totalOpEx > 0) state.totalOpEx = extracted.totalOpEx;
  if (Object.values(extracted).some(v => v !== null && !Array.isArray(v))) {
    updateCalculations();
  }
}

function showExtractedTags(fields) {
  const container = document.getElementById('upload-fields');
  if (!container) return;
  container.innerHTML = fields.map(f => `<span class="upload-field-tag">${f}</span>`).join('');
}

/* ═══════════════════════════════════════════════════════════
   INITIALISATION
═══════════════════════════════════════════════════════════ */

function initBaseScenario() {
  const cv = getComputedValues();
  state.scenarios.push({
    name:      'Base Case',
    price:     30000000,
    capRate:   cv.goingInCap,
    ltv:       65,
    rate:      6.25,
    occ:       93.2,
    noiGrowth: 2.5,
    dscr:      cv.dscr,
    coc:       cv.coc,
    exitValue: cv.exitValue,
    irr:       cv.irr,
  });
  renderScenarioTable();
}

document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initSliders();
  initBaseScenario();
  updateCalculations();
  buildSensitivityTable(getComputedValues());
});
