// ══════════════════════════════════════════════════
// CONFIG — Set your Anthropic API key here
// ══════════════════════════════════════════════════
var ANTHROPIC_API_KEY = ''; // e.g. 'sk-ant-...'

// ══════════════════════════════════════════════════
// DEAL DATA — single source of truth (populated by upload)
// ══════════════════════════════════════════════════
var dealData = {
  propertyName:null, location:null, units:null, yearBuilt:null,
  assetClass:null, strategy:null, purchasePrice:null,
  gpr:null, vacancyPct:null, otherIncome:null,
  egi:null, totalExpenses:null, noi:null,
  capRateGoing:null, capRateExit:null, noiGrowth:null,
  ltv:null, loanAmount:null, interestRate:null,
  amortization:null, loanTerm:null, ioPeriod:0, holdPeriod:null,
  physicalOccupancy:null, economicOccupancy:null,
  leasedPct:null, avgDaysToLease:null, renewalRate:null,
  avgEffectiveRent:null, avgMarketRent:null, tradeout:null,
  unitMix:[], expenses:{}, renovation:{}, market:{}, esg:{},
  extractedFields:[], missing:[]
};

var OM_CONTEXT = '';

// ══════════════════════════════════════════════════
// UTILITIES
// ══════════════════════════════════════════════════
function fmt$(n) {
  if (n==null||isNaN(n)) return '—';
  var a=Math.abs(n), s=n<0?'-':'';
  if (a>=1e9) return s+'$'+(a/1e9).toFixed(2)+'B';
  if (a>=1e6) return s+'$'+(a/1e6).toFixed(1)+'M';
  if (a>=1e3) return s+'$'+(a/1e3).toFixed(0)+'K';
  return s+'$'+a.toFixed(0);
}
function fmtN(n,d){return(n==null||isNaN(n))?'—':n.toFixed(d==null?0:d);}
function fmtPct(n,d){return(n==null||isNaN(n))?'—':n.toFixed(d==null?1:d)+'%';}
function commas(n){if(!n&&n!==0)return'—';return'$'+Math.round(n).toLocaleString();}

// kpiCard with optional id applied to the value element
function kpiCard(label,val,badge,cls,id){
  var bc=cls==='good'?'green':cls==='caution'?'yellow':'blue';
  var idAttr=id?' id="'+id+'"':'';
  return '<div class="kpi-card '+(cls||'info')+'"><div class="kpi-label">'+label+'</div>'+
    '<div class="kpi-value"'+idAttr+'>'+val+'</div>'+
    '<div class="kpi-badge badge-'+bc+'">'+badge+'</div></div>';
}
function statRow(label,val,color){
  return '<div class="stat-row"><span class="stat-label">'+label+'</span>'+
    '<span class="stat-val"'+(color?' style="color:var(--'+color+')"':'')+'>'+val+'</span></div>';
}
function panelBox(title,content){
  return '<div class="panel-box"><div class="section-title">'+title+'</div>'+content+'</div>';
}
function tableWrap(title,tableHtml){
  return '<div class="table-wrap"><div class="section-title" style="padding:12px 16px 8px;margin-bottom:0;border-bottom:1px solid var(--border)">'+title+'</div>'+tableHtml+'</div>';
}

// ══════════════════════════════════════════════════
// MOTION ONE ANIMATIONS
// ══════════════════════════════════════════════════
function flashUpdate(id) {
  var el=document.getElementById(id);
  if(!el) return;
  // Primary: Motion One (if loaded)
  if(typeof Motion!=='undefined'&&Motion.animate){
    Motion.animate(el,{opacity:[0.25,1],scale:[0.94,1]},{duration:0.28,easing:'ease-out'});
    return;
  }
  // Fallback: CSS keyframe class toggle
  el.classList.remove('kpi-flash');
  void el.offsetWidth; // force reflow
  el.classList.add('kpi-flash');
}

function animateTabIn(panelEl) {
  if(!panelEl) return;
  if(typeof Motion!=='undefined'&&Motion.animate){
    Motion.animate(panelEl,{opacity:[0,1],y:[10,0]},{duration:0.22,easing:'ease-out'});
  }
}

// ══════════════════════════════════════════════════
// FINANCE MATH
// ══════════════════════════════════════════════════
function calcPMT(annualRate, nper, pv) {
  var r = annualRate / 12;
  if (r === 0) return pv / nper;
  return pv * r * Math.pow(1+r,nper) / (Math.pow(1+r,nper)-1);
}

function calcIRR(cashflows) {
  var guess = 0.12;
  for (var i=0; i<300; i++) {
    var npv=0, dnpv=0;
    for (var t=0; t<cashflows.length; t++) {
      var d=Math.pow(1+guess,t);
      npv+=cashflows[t]/d;
      if(t>0) dnpv-=t*cashflows[t]/Math.pow(1+guess,t+1);
    }
    if (Math.abs(dnpv)<1e-14) break;
    var next=guess-npv/dnpv;
    if(next<-0.999) next=-0.5;
    if(next>50) next=2;
    if(Math.abs(next-guess)<1e-10) return next;
    guess=next;
  }
  return guess;
}

function calcNPV(rate, cashflows) {
  return cashflows.reduce(function(s,cf,t){return s+cf/Math.pow(1+rate,t);},0);
}

function buildLoanSchedule(loanAmt, annualRate, amortYears, holdYears) {
  var rows=[], bal=loanAmt;
  var pmt=calcPMT(annualRate, amortYears*12, loanAmt);
  for (var yr=1; yr<=holdYears; yr++) {
    var begBal=bal, annInt=0, annPrin=0;
    for (var m=0; m<12; m++) {
      var intPmt=bal*(annualRate/12);
      var prinPmt=pmt-intPmt;
      annInt+=intPmt; annPrin+=prinPmt; bal-=prinPmt;
    }
    rows.push({year:yr, begBal:begBal, interest:annInt, principal:annPrin, endBal:bal});
  }
  return rows;
}

// ══════════════════════════════════════════════════
// TAB RENDERING HELPERS
// ══════════════════════════════════════════════════
function setTab(id,html){
  var el=document.getElementById(id);
  if(el) el.innerHTML=html;
}

function emptyState(title){
  return '<div class="page-title">'+title+'</div>'+
    '<div style="text-align:center;padding:60px 20px;color:var(--muted)">'+
    '<div style="font-size:48px;margin-bottom:16px">📂</div>'+
    '<div style="font-size:17px;font-weight:600;color:var(--text);margin-bottom:8px">No document loaded</div>'+
    '<div>Upload an Offering Memorandum, T12, or Rent Roll to populate this section.</div></div>';
}

// ══════════════════════════════════════════════════
// TAB 1 — Dashboard (Overview)
// ══════════════════════════════════════════════════
function renderDashboard(d) {
  var h='<div class="page-title">Deal Dashboard</div>'+
    '<div class="page-sub">At-a-Glance Summary · '+(d.propertyName||'No property loaded')+'</div>';
  if(!d.purchasePrice&&!d.noi){
    h+='<div style="text-align:center;padding:60px 20px;color:var(--muted)">'+
      '<div style="font-size:48px;margin-bottom:16px">🏠</div>'+
      '<div style="font-size:17px;font-weight:600;color:var(--text);margin-bottom:8px">Upload a document to begin</div>'+
      '<div>Drop an OM, T12, or Rent Roll in the sidebar to auto-populate all 11 analysis modules.</div></div>';
    return h;
  }
  var loanAmt=d.loanAmount||(d.purchasePrice?(d.purchasePrice*(d.ltv||65)/100):0);
  var equity=d.purchasePrice?d.purchasePrice-loanAmt:0;
  var rate=d.interestRate||6.25;
  var amort=d.amortization||30;
  var hold=d.holdPeriod||5;
  var nog=d.noiGrowth!=null?d.noiGrowth:2;
  var annDS=loanAmt?calcPMT(rate/100,amort*12,loanAmt)*12:0;
  var dscr=d.noi&&annDS?d.noi/annDS:0;
  var capG=d.capRateGoing||(d.noi&&d.purchasePrice?d.noi/d.purchasePrice*100:0);
  var capE=d.capRateExit||(capG?capG+0.7:0);
  var irr=null, moic=null;
  if(d.noi&&annDS&&equity&&capE){
    var sched0=buildLoanSchedule(loanAmt,rate/100,amort,hold);
    var loanBal0=sched0[hold-1].endBal;
    var noiExit0=d.noi*Math.pow(1+nog/100,hold);
    var exitVal0=noiExit0/(capE/100);
    var cumCF0=0;
    var cfs0=[-equity];
    for(var yr0=1;yr0<=hold;yr0++){
      var nY0=d.noi*Math.pow(1+nog/100,yr0);
      var ncfY0=nY0-annDS; cumCF0+=ncfY0;
      cfs0.push(yr0===hold?ncfY0+(exitVal0-loanBal0):ncfY0);
    }
    irr=calcIRR(cfs0)*100;
    moic=(cumCF0+(exitVal0-loanBal0))/equity;
  }
  h+='<div class="kpi-grid">';
  if(d.purchasePrice) h+=kpiCard('Purchase Price',fmt$(d.purchasePrice),(d.units?commas(d.purchasePrice/d.units)+'/unit':'—'),'info','dash-price');
  if(d.noi) h+=kpiCard('NOI',fmt$(d.noi),capG?fmtPct(capG,2)+' cap rate':'Going-in','good','dash-noi');
  if(dscr) h+=kpiCard('DSCR',fmtN(dscr,2)+'×','Min 1.20×',dscr>=1.25?'good':'caution','dash-dscr');
  if(irr!=null) h+=kpiCard('IRR',fmtPct(irr,1),'Levered',irr>=15?'good':'caution','dash-irr');
  if(moic!=null) h+=kpiCard('MOIC',fmtN(moic,2)+'×','Target ≥1.7×',moic>=1.7?'good':'caution','dash-moic');
  if(d.physicalOccupancy) h+=kpiCard('Occupancy',fmtPct(d.physicalOccupancy,0),'Physical',d.physicalOccupancy>=90?'good':'caution','dash-occ');
  if(equity) h+=kpiCard('Equity Required',fmt$(equity),fmtPct(100-(d.ltv||65),0)+' of purchase','info','dash-equity');
  if(d.units) h+=kpiCard('Units',d.units+'',d.assetClass||d.strategy||'Multifamily','info','dash-units');
  h+='</div>';
  h+='<div class="three-col">';
  h+=panelBox('Property Info',
    (d.propertyName?statRow('Name',d.propertyName):'')+
    (d.location?statRow('Location',d.location):'')+
    (d.assetClass?statRow('Asset Class',d.assetClass):'')+
    (d.strategy?statRow('Strategy',d.strategy):'')+
    (d.yearBuilt?statRow('Year Built',d.yearBuilt+''):'')+
    (d.units?statRow('Units',d.units+''):'')
  );
  h+=panelBox('Financial Snapshot',
    (d.purchasePrice?statRow('Purchase Price',commas(d.purchasePrice)):'')+
    (d.noi?statRow('NOI',commas(d.noi)):'')+
    (loanAmt?statRow('Loan Amount',commas(loanAmt)):'')+
    (equity?statRow('Equity Required',commas(equity)):'')+
    (annDS?statRow('Annual Debt Svc',commas(annDS)):'')+
    (dscr?statRow('DSCR',fmtN(dscr,2)+'×',dscr>=1.25?'green':'red'):'')
  );
  h+=panelBox('Data Completeness',
    (d.extractedFields&&d.extractedFields.length?
      '<div class="checklist">'+d.extractedFields.map(function(f){
        return '<div class="check-item"><div class="ck ck-done">✓</div>'+f+'</div>';
      }).join('')+
      (d.missing&&d.missing.length?d.missing.map(function(f){
        return '<div class="check-item"><div class="ck ck-pend">✗</div>'+f+'</div>';
      }).join(''):'')+'</div>':
      '<div style="color:var(--muted);font-size:13px;padding:4px 0">No data loaded — upload a document to begin.</div>'
    )
  );
  h+='</div>';
  return h;
}

// ══════════════════════════════════════════════════
// TAB 2 — Investment Returns
// ══════════════════════════════════════════════════
function renderReturns(d) {
  if (!d.purchasePrice||!d.noi) return emptyState('Investment Returns');
  var loanAmt=d.loanAmount||(d.purchasePrice*(d.ltv||65)/100);
  var equity=d.purchasePrice-loanAmt;
  var ltv=loanAmt/d.purchasePrice*100;
  var rate=d.interestRate||6.25;
  var amort=d.amortization||30;
  var hold=d.holdPeriod||5;
  var nog=d.noiGrowth!=null?d.noiGrowth:2;
  var exitCap=d.capRateExit||((d.capRateGoing||d.noi/d.purchasePrice*100)+0.7);
  var annDS=calcPMT(rate/100,amort*12,loanAmt)*12;
  var dscr=d.noi/annDS;
  var ncf1=d.noi-annDS;
  var coc1=ncf1/equity*100;
  var sched=buildLoanSchedule(loanAmt,rate/100,amort,hold);
  var loanBal=sched[hold-1].endBal;
  var noiExit=d.noi*Math.pow(1+nog/100,hold);
  var exitVal=noiExit/(exitCap/100);
  var cfs=[-equity];
  var cumCF=0;
  for(var yr=1;yr<=hold;yr++){
    var noiYr=d.noi*Math.pow(1+nog/100,yr);
    var ncfYr=noiYr-annDS;
    cumCF+=ncfYr;
    cfs.push(yr===hold?ncfYr+(exitVal-loanBal):ncfYr);
  }
  var irr=calcIRR(cfs)*100;
  var moic=(cumCF+(exitVal-loanBal))/equity;
  var capGoing=d.capRateGoing||(d.noi/d.purchasePrice*100);
  var debtYield=d.noi/loanAmt*100;
  var h='<div class="page-title">Investment Returns</div>'+
    '<div class="page-sub">'+(d.propertyName||'Property')+' · '+commas(d.purchasePrice)+' Purchase · '+hold+'-Yr Hold</div>';
  h+='<div class="kpi-grid">';
  h+=kpiCard('IRR (Levered)',fmtPct(irr,1),irr>=15?'▲ Above 15% hurdle':'▼ Below 15% hurdle',irr>=15?'good':'caution','ret-irr');
  h+=kpiCard('MOIC',fmtN(moic,2)+'×',moic>=1.7?'Target ≥ 1.7×':'Below 1.7× target',moic>=1.7?'good':'caution','ret-moic');
  h+=kpiCard('CoC Y1',fmtPct(coc1,1),coc1>=5?'Above 5% min':'Below 5% min',coc1>=5?'good':'caution','ret-coc');
  h+=kpiCard('DSCR',fmtN(dscr,2)+'×',dscr>=1.25?'Above 1.20× min':'Below lender min',dscr>=1.25?'good':'caution','ret-dscr');
  h+=kpiCard('LTV',fmtPct(ltv,0),ltv<=70?'Within ≤70% policy':'Exceeds 70%',ltv<=70?'caution':'','ret-ltv');
  h+=kpiCard('Debt Yield',fmtPct(debtYield,1),debtYield>=7.5?'Above 7.5% min':'Below 7.5% min',debtYield>=7.5?'good':'caution','ret-debtYield');
  h+=kpiCard('Equity Required',fmt$(equity),fmtPct(100-ltv,0)+' of purchase','info','ret-equity');
  h+=kpiCard('Going-in Cap',fmtPct(capGoing,2),'NOI / Purchase price','caution','ret-capGoing');
  h+='</div>';
  var cfRows='';
  for(var y=1;y<=hold;y++){
    var nY=d.noi*Math.pow(1+nog/100,y);
    var ncfY=nY-annDS;
    cfRows+='<tr><td>Y'+y+'</td><td>'+commas(nY)+'</td><td>'+commas(annDS)+'</td><td>'+commas(ncfY)+'</td><td>'+fmtPct(ncfY/equity*100,1)+'</td></tr>';
  }
  h+='<div class="two-col">';
  h+=panelBox('Return Summary',
    statRow('Purchase Price',commas(d.purchasePrice))+
    statRow('Loan ('+fmtPct(ltv,0)+'% LTV)',commas(loanAmt))+
    statRow('Equity Invested',commas(equity))+
    statRow('Exit Value (Yr'+hold+', '+fmtPct(exitCap,1)+'%)',commas(exitVal))+
    statRow('Loan Payoff',commas(loanBal))+
    statRow('Net Equity at Exit',commas(exitVal-loanBal),'green')+
    statRow(hold+'yr Cash Flows',commas(cumCF))+
    statRow('Total Profit',commas(cumCF+(exitVal-loanBal)-equity),'green')+
    statRow('MOIC',fmtN(moic,2)+'×','green')+
    statRow('IRR',fmtPct(irr,1),'green')
  );
  h+=tableWrap('Annual Cash-on-Cash Projection',
    '<table class="data-table"><thead><tr><th>Year</th><th>NOI</th><th>Debt Service</th><th>NCF</th><th>CoC</th></tr></thead>'+
    '<tbody id="returns-cf-tbody">'+cfRows+'</tbody></table>'
  );
  h+='</div>';
  return h;
}

// ══════════════════════════════════════════════════
// TAB 3 — Operating Performance
// ══════════════════════════════════════════════════
function renderOperating(d) {
  if (!d.noi&&!d.gpr) return emptyState('Operating Performance');
  var noi=d.noi||0;
  var egi=d.egi||(d.gpr?(d.gpr*(1-(d.vacancyPct||8)/100)+(d.otherIncome||0)):noi/0.45);
  var gpr=d.gpr||(egi*1.1);
  var totExp=d.totalExpenses||(egi-noi);
  var oer=egi>0?(totExp/egi)*100:0;
  var noim=egi>0?(noi/egi)*100:0;
  var units=d.units||1;
  var vacLoss=gpr-(egi-(d.otherIncome||0));
  var exp=d.expenses||{};
  var expRows='';
  [['Property Taxes',exp.taxes],['Insurance',exp.insurance],
   ['Mgmt Fee',exp.management],['Maintenance',exp.maintenance],
   ['Utilities',exp.utilities],['Payroll/Admin',exp.payroll],
   ['CapEx Reserves',exp.reserves],['Other',exp.other]].forEach(function(r){
    if(r[1]) expRows+='<tr><td>'+r[0]+'</td><td>'+commas(r[1])+'</td><td>'+commas(r[1]/units)+'/unit</td><td>'+fmtPct(r[1]/egi*100,1)+'</td></tr>';
  });
  if(!expRows) expRows='<tr><td colspan="4" style="color:var(--muted);text-align:center">No expense detail extracted</td></tr>';
  expRows+='<tr><td><strong>Total</strong></td><td><strong>'+commas(totExp)+'</strong></td><td><strong>'+commas(totExp/units)+'/unit</strong></td><td><strong>'+fmtPct(oer,1)+'</strong></td></tr>';
  var h='<div class="page-title">Operating Performance</div>'+
    '<div class="page-sub">T12 Trailing · '+(d.propertyName||'Property')+' · '+(units||'?')+' Units</div>';
  h+='<div class="kpi-grid">';
  h+=kpiCard('NOI',fmt$(noi),commas(noi/units)+'/unit/yr','good','op-noi');
  h+=kpiCard('EGI',fmt$(egi),commas(egi/units)+'/unit/yr','info','op-egi');
  h+=kpiCard('OER',fmtPct(oer,1),'Benchmark 45–55%',oer<=55?'caution':'','op-oer');
  h+=kpiCard('NOI Margin',fmtPct(noim,1),noim>=40?'Target ≥ 40%':'Below 40%',noim>=40?'good':'caution','op-noim');
  h+=kpiCard('GPR',fmt$(gpr),commas(gpr/units)+'/unit','info','op-gpr');
  h+=kpiCard('Vacancy Loss',fmt$(vacLoss),fmtPct(vacLoss/gpr*100,1)+' of GPR','caution','op-vacLoss');
  h+=kpiCard('Total Expenses',fmt$(totExp),commas(totExp/units)+'/unit','info','op-totExp');
  h+=kpiCard('Exp/Unit/Mo',commas(totExp/units/12),(totExp/units/12)<=800?'Healthy':'High',(totExp/units/12)<=800?'good':'caution','op-expUnit');
  h+='</div>';
  h+='<div class="two-col">';
  h+=tableWrap('Expense Breakdown',
    '<table class="data-table"><thead><tr><th>Category</th><th>Annual</th><th>Per Unit</th><th>% EGI</th></tr></thead>'+
    '<tbody>'+expRows+'</tbody></table>'
  );
  h+=panelBox('Income Bridge',
    statRow('Gross Potential Rent',commas(gpr))+
    statRow('Less: Vacancy ('+fmtPct(d.vacancyPct||8,0)+'%)','− '+commas(vacLoss),'red')+
    statRow('Add: Other Income','+ '+commas(d.otherIncome||0),'green')+
    statRow('= EGI',commas(egi))+
    statRow('Less: Total Expenses','− '+commas(totExp),'red')+
    statRow('= NOI',commas(noi),'green')
  );
  h+='</div>';
  return h;
}

// ══════════════════════════════════════════════════
// TAB 4 — Leasing & Occupancy
// ══════════════════════════════════════════════════
function renderLeasing(d) {
  if (!d.physicalOccupancy&&!d.avgEffectiveRent&&!d.unitMix.length) return emptyState('Leasing & Occupancy');
  var occ=d.physicalOccupancy||92;
  var units=d.units||1;
  var h='<div class="page-title">Leasing &amp; Occupancy</div>'+
    '<div class="page-sub">Current Snapshot · '+(d.propertyName||'Property')+' · '+units+' Units</div>';
  h+='<div class="kpi-grid">';
  h+=kpiCard('Physical Occ.',fmtPct(occ,0),Math.round(occ/100*units)+'/'+units+' units',occ>=90?'good':'caution','ls-physOcc');
  if(d.economicOccupancy) h+=kpiCard('Economic Occ.',fmtPct(d.economicOccupancy,0),'Concession adj.',d.economicOccupancy>=88?'good':'caution','ls-ecoOcc');
  if(d.leasedPct) h+=kpiCard('Leased %',fmtPct(d.leasedPct,0),'Incl. notice',d.leasedPct>=93?'good':'caution','ls-leasedPct');
  if(d.tradeout!=null) h+=kpiCard('Trade-out YoY',(d.tradeout>0?'+':'')+fmtPct(d.tradeout,1),'New vs expiring',d.tradeout>=0?'good':'caution','ls-tradeout');
  if(d.avgDaysToLease) h+=kpiCard('Days to Lease',d.avgDaysToLease+' days','Benchmark ≤15',d.avgDaysToLease<=15?'good':'caution','ls-daysLease');
  if(d.renewalRate) h+=kpiCard('Renewal Rate',fmtPct(d.renewalRate,0),'Target ≥70%',d.renewalRate>=70?'good':'caution','ls-renewalRate');
  if(d.avgEffectiveRent) h+=kpiCard('Avg Effective Rent',commas(d.avgEffectiveRent),'/unit/mo','info','ls-avgRent');
  if(d.avgMarketRent) h+=kpiCard('Avg Market Rent',commas(d.avgMarketRent),
    fmtPct(Math.abs((d.avgEffectiveRent-d.avgMarketRent)/d.avgMarketRent*100),1)+(d.avgEffectiveRent<d.avgMarketRent?' below market':' above market'),'info','ls-marketRent');
  h+='</div>';
  if(d.unitMix&&d.unitMix.length){
    var totU=d.unitMix.reduce(function(s,u){return s+u.units;},0);
    var totR=d.unitMix.reduce(function(s,u){return s+u.units*u.rent;},0);
    var rows=d.unitMix.map(function(u){
      return '<tr><td>'+u.type+'</td><td>'+u.units+'</td><td>'+fmtPct(u.units/totU*100,1)+'</td>'+
        '<td>'+(u.sf?u.sf:'—')+'</td><td>'+commas(u.rent)+'</td>'+
        '<td>'+(u.sf?'$'+(u.rent/u.sf).toFixed(2):'—')+'</td>'+
        '<td>'+commas(u.units*u.rent)+'</td><td>'+commas(u.units*u.rent*12)+'</td>'+
        '<td>'+(u.occ?fmtPct(u.occ,0):'—')+'</td></tr>';
    });
    rows.push('<tr><td><strong>Total/Avg</strong></td><td><strong>'+totU+'</strong></td><td><strong>100%</strong></td>'+
      '<td>—</td><td><strong>'+commas(totR/totU)+'</strong></td><td>—</td>'+
      '<td><strong>'+commas(totR)+'</strong></td><td><strong>'+commas(totR*12)+'</strong></td><td>—</td></tr>');
    h+=tableWrap('Unit Mix & Rent Roll Summary',
      '<table class="data-table"><thead><tr><th>Type</th><th>Units</th><th>%</th><th>SF</th><th>Avg Rent</th><th>Rent/SF</th><th>Mo Revenue</th><th>Ann Revenue</th><th>Occ</th></tr></thead>'+
      '<tbody>'+rows.join('')+'</tbody></table>'
    );
  }
  return h;
}

// ══════════════════════════════════════════════════
// TAB 5 — Unit Economics
// ══════════════════════════════════════════════════
function renderUnits(d) {
  var rv=d.renovation||{};
  if(!rv.costPerUnit) return emptyState('Unit Economics');
  var units=d.units||200;
  var renovated=rv.unitsRenovated||0;
  var unreno=units-renovated;
  var incNOI=unreno*(rv.rentPremium||0)*12;
  var exitCap=d.capRateExit||6.2;
  var valueAdd=incNOI/(exitCap/100);
  var totalCapex=unreno*(rv.costPerUnit||0);
  var renoROI=rv.costPerUnit>0?((rv.rentPremium||0)*12/rv.costPerUnit)*100:0;
  var payback=rv.rentPremium>0?rv.costPerUnit/rv.rentPremium:0;
  var h='<div class="page-title">Unit Economics</div>'+
    '<div class="page-sub">Value-Add Renovation Program · '+(d.propertyName||'Property')+'</div>';
  h+='<div class="kpi-grid">';
  h+=kpiCard('Reno ROI',fmtPct(renoROI,0),renoROI>=25?'Above 25% hurdle':'Below 25%',renoROI>=25?'good':'caution','ue-renoRoi');
  h+=kpiCard('Rent Premium',commas(rv.rentPremium)+'/mo','Post-renovation','good','ue-rentPremium');
  h+=kpiCard('Payback Period',fmtN(payback,0)+' months','Target ≤24 mo',payback<=24?'good':'caution','ue-payback');
  h+=kpiCard('Cost / Unit',commas(rv.costPerUnit),'Interior scope','info','ue-costUnit');
  h+=kpiCard('Units Renovated',renovated+' units',fmtPct(renovated/units*100,0)+'% complete','caution','ue-unitsReno');
  h+=kpiCard('Unreno Upside',fmt$(incNOI)+'/yr',unreno+' units × '+commas(rv.rentPremium),'good','ue-unrenoUpside');
  h+=kpiCard('Total CapEx Reqd',fmt$(totalCapex),unreno+' remaining units','info','ue-capexReqd');
  h+=kpiCard('Value Created',fmt$(valueAdd),'at '+fmtPct(exitCap,1)+' exit cap','good','ue-valueCreated');
  h+='</div>';
  h+='<div class="two-col">';
  h+=panelBox('Renovation Program',
    statRow('Cost per Unit',commas(rv.costPerUnit))+
    statRow('Monthly Rent Premium',commas(rv.rentPremium)+'/unit')+
    statRow('Annual Premium',commas((rv.rentPremium||0)*12)+'/unit')+
    statRow('Unlevered Yield on Cost',fmtPct(renoROI,1),'green')+
    statRow('Payback Period',fmtN(payback,0)+' months')
  );
  h+=panelBox('Value-Add Upside Model',
    statRow('Unrenovated Units',unreno)+
    statRow('CapEx Required',commas(totalCapex))+
    statRow('Incremental NOI (stabilized)','+'+commas(incNOI)+'/yr','green')+
    statRow('Value Created ('+fmtPct(exitCap,1)+'% exit cap)','+'+commas(valueAdd),'green')+
    statRow('Net Value-Add','+'+commas(valueAdd-totalCapex),'green')+
    statRow('Return on CapEx',totalCapex>0?fmtPct((valueAdd-totalCapex)/totalCapex*100,0):'—','green')
  );
  h+='</div>';
  return h;
}

// ══════════════════════════════════════════════════
// TAB 6 — Credit & Debt Service
// ══════════════════════════════════════════════════
function renderCredit(d) {
  if (!d.noi||!d.loanAmount) return emptyState('Credit & Debt Service');
  var loanAmt=d.loanAmount;
  var rate=d.interestRate||6.25;
  var amort=d.amortization||30;
  var hold=d.holdPeriod||5;
  var annDS=calcPMT(rate/100,amort*12,loanAmt)*12;
  var dscr=d.noi/annDS;
  var icr=d.noi/(loanAmt*(rate/100));
  var debtConst=annDS/loanAmt*100;
  var debtYield=d.noi/loanAmt*100;
  var ltv=d.ltv||(d.purchasePrice?loanAmt/d.purchasePrice*100:65);
  var gpr=d.gpr||(d.noi/0.45);
  var beoOcc=gpr>0?(annDS/gpr)*100:0;
  var sched=buildLoanSchedule(loanAmt,rate/100,amort,hold);
  var h='<div class="page-title">Credit &amp; Debt Service</div>'+
    '<div class="page-sub">Loan Analysis · '+commas(loanAmt)+' · '+fmtPct(rate,2)+' · '+amort+'-Yr AM</div>';
  h+='<div class="kpi-grid">';
  h+=kpiCard('DSCR',fmtN(dscr,2)+'×','Min lender 1.20×',dscr>=1.25?'good':dscr>=1.10?'caution':'','debt-dscr');
  h+=kpiCard('Interest Coverage',fmtN(icr,2)+'×','NOI / Interest',icr>=1.3?'good':'caution','debt-icr');
  h+=kpiCard('Debt Constant',fmtPct(debtConst,2),'Ann DS / Loan','info','debt-const');
  h+=kpiCard('Break-Even Occ.',fmtPct(beoOcc,0),fmtPct(100-beoOcc,0)+'% cushion',beoOcc<80?'good':'caution','debt-beo');
  h+=kpiCard('Annual Debt Svc',commas(annDS),'P&I combined','info','debt-annDs');
  h+=kpiCard('Monthly P&I',commas(annDS/12),'Fixed rate','info','debt-monthlyPi');
  h+=kpiCard('Debt Yield',fmtPct(debtYield,1),'NOI / Loan',debtYield>=7.5?'good':'caution','debt-yield');
  h+='</div>';
  var schedRows=sched.map(function(r){
    return '<tr><td>Y'+r.year+'</td><td>'+commas(r.begBal)+'</td><td>'+commas(r.interest)+'</td>'+
      '<td>'+commas(r.principal)+'</td><td>'+commas(r.endBal)+'</td></tr>';
  }).join('');
  h+='<div class="two-col">';
  h+=panelBox('Loan Terms',
    statRow('Loan Amount',commas(loanAmt))+
    statRow('Interest Rate',fmtPct(rate,2)+' Fixed')+
    statRow('Amortization',amort+' Years')+
    statRow('Loan Term',(d.loanTerm||10)+' Years')+
    statRow('IO Period',(d.ioPeriod||0)+' months')+
    statRow('LTV',fmtPct(ltv,0))+
    statRow('Annual Debt Service',commas(annDS))
  );
  h+=tableWrap('Loan Balance Schedule',
    '<table class="data-table"><thead><tr><th>Year</th><th>Beg. Balance</th><th>Interest</th><th>Principal</th><th>End Balance</th></tr></thead>'+
    '<tbody id="debt-amort-tbody">'+schedRows+'</tbody></table>'
  );
  h+='</div>';
  return h;
}

// ══════════════════════════════════════════════════
// TAB 7 — Valuation & Exit
// ══════════════════════════════════════════════════
function renderValuation(d) {
  if (!d.noi||!d.purchasePrice) return emptyState('Valuation & Exit');
  var capG=d.capRateGoing||(d.noi/d.purchasePrice*100);
  var capE=d.capRateExit||(capG+0.7);
  var hold=d.holdPeriod||5;
  var nog=d.noiGrowth!=null?d.noiGrowth:2;
  var loanAmt=d.loanAmount||(d.purchasePrice*(d.ltv||65)/100);
  var rate=d.interestRate||6.25;
  var amort=d.amortization||30;
  var equity=d.purchasePrice-loanAmt;
  var sched=buildLoanSchedule(loanAmt,rate/100,amort,hold);
  var loanBal=sched[hold-1].endBal;
  var annDS=calcPMT(rate/100,amort*12,loanAmt)*12;
  var noiExit=d.noi*Math.pow(1+nog/100,hold);
  var exitVal=noiExit/(capE/100);
  var cfs=[-equity]; var cumCF=0;
  for(var yr=1;yr<=hold;yr++){
    var nY=d.noi*Math.pow(1+nog/100,yr);
    var ncfY=nY-annDS; cumCF+=ncfY;
    cfs.push(yr===hold?ncfY+(exitVal-loanBal):ncfY);
  }
  var irr=calcIRR(cfs)*100;
  var moic=(cumCF+(exitVal-loanBal))/equity;
  var sensRows='';
  [capG-0.5,capG,capG+0.5,capE,capE+0.5,capE+1.0].forEach(function(cr){
    if(cr<=0) return;
    var row='<tr><td style="font-weight:700">'+cr.toFixed(1)+'%</td>';
    [0,1,2,3,4].forEach(function(g){
      var n5=d.noi*Math.pow(1+g/100,hold);
      var v=n5/(cr/100);
      var cls=v>d.purchasePrice?'sens-hi':v<d.purchasePrice*0.8?'sens-lo':'';
      row+='<td class="'+cls+'">$'+(v/1e6).toFixed(1)+'M</td>';
    });
    row+='</tr>'; sensRows+=row;
  });
  var h='<div class="page-title">Valuation &amp; Exit</div>'+
    '<div class="page-sub">Cap Rate Analysis &amp; Sensitivity · '+(d.propertyName||'Property')+'</div>';
  h+='<div class="kpi-grid">';
  h+=kpiCard('Going-in Cap',fmtPct(capG,2),'NOI / Purchase price','caution','val-goingCap');
  h+=kpiCard('Exit Cap',fmtPct(capE,2),'+'+fmtPct(capE-capG,1)+'% expansion','caution','val-exitCap');
  h+=kpiCard('Current Value',fmt$(d.noi/(capG/100)),'NOI / '+fmtPct(capG,1),'info','val-currentVal');
  h+=kpiCard('Exit Value',fmt$(exitVal),'Yr'+hold+' NOI / '+fmtPct(capE,1),'caution','val-exitVal');
  h+=kpiCard('Value/Unit',commas(d.purchasePrice/(d.units||1)),'Purchase / units','info','val-valUnit');
  h+=kpiCard('Exit Value/Unit',commas(exitVal/(d.units||1)),'Exit / units','info','val-exitUnit');
  h+=kpiCard('Equity at Exit',fmt$(exitVal-loanBal),'After loan payoff','good','val-equityExit');
  h+=kpiCard('IRR',fmtPct(irr,1),'Levered '+hold+'-year',irr>=15?'good':'caution','val-irr');
  h+='</div>';
  h+=tableWrap('Exit Value Sensitivity (Yr'+hold+' NOI × Cap Rate)',
    '<table class="data-table sens-table"><thead><tr><th>Cap Rate ↓ / NOI Grw →</th><th>0%</th><th>1%</th><th>2%</th><th>3%</th><th>4%</th></tr></thead>'+
    '<tbody>'+sensRows+'</tbody></table>'
  );
  h+='<div class="two-col">';
  h+=panelBox('Return Summary at Exit',
    statRow('Equity Invested',commas(equity))+
    statRow(hold+'yr Cash Flows',commas(cumCF))+
    statRow('Exit Value (Yr'+hold+')',commas(exitVal))+
    statRow('Loan Payoff',commas(loanBal))+
    statRow('Net Equity at Exit',commas(exitVal-loanBal),'green')+
    statRow('Total Profit',commas(cumCF+(exitVal-loanBal)-equity),'green')+
    statRow('MOIC',fmtN(moic,2)+'×','green')+
    statRow('IRR',fmtPct(irr,1),'green')
  );
  h+=panelBox('Cap Rate Analysis',
    statRow('Going-in Cap',fmtPct(capG,2))+
    statRow('Exit Cap (underwritten)',fmtPct(capE,2))+
    statRow('Expansion','+'+fmtPct(capE-capG,2)+'%')+
    statRow('Conservative Exit (cap+0.8%)',fmtPct(capE+0.8,2))+
    statRow('Conservative Exit Value',commas(noiExit/((capE+0.8)/100)))
  );
  h+='</div>';
  return h;
}

// ══════════════════════════════════════════════════
// TAB 8 — Market & Portfolio
// ══════════════════════════════════════════════════
function renderMarket(d) {
  var m=d.market||{};
  if(!m.msa&&!m.rentGrowth&&!d.assetClass) return emptyState('Market & Portfolio');
  var h='<div class="page-title">Market &amp; Portfolio</div>'+
    '<div class="page-sub">'+(m.msa||'Market Data')+' · Competitive Analysis</div>';
  h+='<div class="kpi-grid">';
  if(m.popGrowth!=null) h+=kpiCard('MSA Pop. Growth',fmtPct(m.popGrowth,1)+'/yr','Extracted','good');
  if(m.jobGrowth!=null) h+=kpiCard('Job Growth YoY',fmtPct(m.jobGrowth,1),'Local market','good');
  if(m.rentGrowth!=null) h+=kpiCard('Rent Growth YoY',fmtPct(m.rentGrowth,1),'Submarket','good');
  if(m.marketVacancy!=null) h+=kpiCard('Market Vacancy',fmtPct(m.marketVacancy,1),'vs. national avg',m.marketVacancy<7?'good':'caution');
  if(m.medianHHIncome) h+=kpiCard('Median HH Income',commas(m.medianHHIncome),'Submarket','info');
  if(m.newSupply) h+=kpiCard('New Supply',m.newSupply.toLocaleString()+' units','12-mo pipeline','caution');
  h+='</div>';
  h+=panelBox('Market Context',
    (m.msa?statRow('MSA',m.msa):'')+
    (d.assetClass?statRow('Asset Class',d.assetClass):'')+
    (d.strategy?statRow('Strategy',d.strategy):'')+
    (d.holdPeriod?statRow('Target Hold',d.holdPeriod+' Years'):'')+
    (m.rentGrowth!=null?statRow('Rent Growth YoY',fmtPct(m.rentGrowth,1)):'')+
    (m.jobGrowth!=null?statRow('Job Growth YoY',fmtPct(m.jobGrowth,1)):'')+
    (m.marketVacancy!=null?statRow('Market Vacancy',fmtPct(m.marketVacancy,1)):'')+
    (m.newSupply?statRow('Supply Pipeline (12mo)',m.newSupply.toLocaleString()+' units'):'')
  );
  return h;
}

// ══════════════════════════════════════════════════
// TAB 9 — ESG & Risk
// ══════════════════════════════════════════════════
function renderESG(d) {
  var esg=d.esg||{};
  if(!Object.keys(esg).length&&!d.yearBuilt&&!d.units) return emptyState('ESG & Risk');
  var units=d.units||1;
  var h='<div class="page-title">ESG &amp; Risk</div>'+
    '<div class="page-sub">Physical Due Diligence · Risk Factors · '+(d.propertyName||'Property')+'</div>';
  h+='<div class="kpi-grid">';
  if(esg.reserveBalance) h+=kpiCard('Reserve Balance',commas(esg.reserveBalance),commas(esg.reserveBalance/units)+'/unit',esg.reserveBalance/units>=1000?'good':'caution');
  if(esg.roofCondition) h+=kpiCard('Roof Condition',esg.roofCondition,'Physical assessment',esg.roofCondition==='Good'?'good':'caution');
  if(d.yearBuilt) h+=kpiCard('Year Built',d.yearBuilt,(new Date().getFullYear()-d.yearBuilt)+' yrs old','info');
  if(esg.immediateRepairs) h+=kpiCard('Immediate Repairs',commas(esg.immediateRepairs),'Estimated CapEx','caution');
  h+='</div>';
  if(d.missing&&d.missing.length){
    h+='<div class="panel-box" style="border-left:3px solid var(--red);margin-bottom:16px">'+
      '<div class="section-title" style="color:var(--red)">⚠ Data Gap Alerts</div>'+
      '<div class="checklist">'+d.missing.map(function(m){
        return '<div class="check-item"><div class="ck ck-pend">✗</div>'+m+'</div>';
      }).join('')+'</div></div>';
  }
  h+=panelBox('Physical Due Diligence',
    (d.yearBuilt?statRow('Year Built',d.yearBuilt+' ('+(new Date().getFullYear()-d.yearBuilt)+' yrs)'):'')+
    (esg.roofCondition?statRow('Roof',esg.roofCondition):'')+
    (esg.hvacCondition?statRow('HVAC',esg.hvacCondition):'')+
    (esg.plumbing?statRow('Plumbing',esg.plumbing):'')+
    (esg.electrical?statRow('Electrical',esg.electrical):'')+
    (esg.parkingSpaces?statRow('Parking',esg.parkingSpaces+' spaces ('+fmtN(esg.parkingSpaces/units,1)+'×)'):'')+
    (esg.immediateRepairs?statRow('Immediate Repairs',commas(esg.immediateRepairs),'yellow'):'')
  );
  return h;
}

// ══════════════════════════════════════════════════
// TAB 10 — Due Diligence Tracker
// ══════════════════════════════════════════════════
function renderDiligence(d) {
  var esg=d.esg||{};
  var h='<div class="page-title">Due Diligence Tracker</div>'+
    '<div class="page-sub">Pre-Closing Checklist · '+(d.propertyName||'Subject Property')+'</div>';

  var ddCategories=[
    {
      title:'📋 Financial Review',
      items:[
        {label:'T12 Operating Statement',       done:!!d.noi},
        {label:'Trailing 3-Year P&L',           done:false},
        {label:'Current Rent Roll',             done:!!(d.unitMix&&d.unitMix.length)},
        {label:'Budget vs Actual Analysis',     done:false},
        {label:'CapEx / Renovation History',    done:!!(d.renovation&&d.renovation.costPerUnit)},
        {label:'Bank Statements (3 months)',    done:false}
      ]
    },
    {
      title:'🏛️ Legal & Title',
      items:[
        {label:'Title Search & Commitment',         done:false},
        {label:'Survey & Legal Description',        done:false},
        {label:'Zoning Confirmation',               done:false},
        {label:'Existing Liens / Encumbrances',     done:false},
        {label:'Purchase & Sale Agreement Review',  done:!!d.purchasePrice},
        {label:'Tenant Lease Agreements',           done:!!(d.unitMix&&d.unitMix.length)}
      ]
    },
    {
      title:'🔧 Physical Inspection',
      items:[
        {label:'Property Condition Report (PCR)', done:!!esg.roofCondition},
        {label:'Roof & Structural Assessment',    done:!!esg.roofCondition},
        {label:'HVAC Inspection',                 done:!!esg.hvacCondition},
        {label:'Plumbing & Electrical Review',    done:!!(esg.plumbing||esg.electrical)},
        {label:'Environmental Phase I ESA',       done:false},
        {label:'ADA Compliance Review',           done:false}
      ]
    },
    {
      title:'📊 Market Research',
      items:[
        {label:'Comparable Sales Analysis',         done:false},
        {label:'Rent Comparables Survey',           done:!!d.avgMarketRent},
        {label:'Market Vacancy & Absorption',       done:!!(d.market&&d.market.marketVacancy!=null)},
        {label:'Supply Pipeline Analysis',          done:!!(d.market&&d.market.newSupply)},
        {label:'Submarket Rent Growth Trends',      done:!!(d.market&&d.market.rentGrowth!=null)},
        {label:'Demographic & Employment Data',     done:!!(d.market&&(d.market.jobGrowth||d.market.popGrowth))}
      ]
    },
    {
      title:'🏦 Financing',
      items:[
        {label:'Lender Term Sheet Received',  done:!!d.interestRate},
        {label:'Loan Application Submitted',  done:false},
        {label:'Appraisal Ordered',           done:false},
        {label:'Debt Coverage Test Passed',   done:!!(d.noi&&d.loanAmount)},
        {label:'Insurance Quotes Obtained',   done:false},
        {label:'Closing Cost Estimate',       done:false}
      ]
    }
  ];

  var totalItems=0, doneItems=0;
  ddCategories.forEach(function(cat){
    cat.items.forEach(function(item){ totalItems++; if(item.done) doneItems++; });
  });
  var pct=Math.round(doneItems/totalItems*100);

  h+='<div class="kpi-grid">';
  h+=kpiCard('DD Progress',pct+'%',doneItems+'/'+totalItems+' items completed',pct>=70?'good':pct>=40?'caution':'','dd-progress');
  h+=kpiCard('Financial',d.noi?'⚠ Partial':'✗ Pending','Review docs',d.noi?'caution':'');
  h+=kpiCard('Legal',d.purchasePrice?'⚠ Partial':'✗ Pending','PSA / Title',d.purchasePrice?'caution':'');
  h+=kpiCard('Physical',esg.roofCondition?'⚠ Partial':'✗ Pending','Inspection rpt',esg.roofCondition?'caution':'');
  h+='</div>';

  h+='<div class="two-col">';
  ddCategories.forEach(function(cat){
    var items=cat.items.map(function(item){
      return '<div class="check-item">'+
        '<div class="ck '+(item.done?'ck-done':'ck-pend')+'">'+(item.done?'✓':'✗')+'</div>'+
        item.label+'</div>';
    }).join('');
    h+='<div class="panel-box"><div class="section-title">'+cat.title+'</div>'+
      '<div class="checklist">'+items+'</div></div>';
  });
  h+='</div>';
  return h;
}

// ══════════════════════════════════════════════════
// TAB 11 — AI Recommendation
// ══════════════════════════════════════════════════
function renderAI(d) {
  var missList=(d.missing&&d.missing.length?d.missing:['No gaps detected — upload a document to analyze']).map(function(m){
    return '<div class="check-item"><div class="ck ck-pend">✗</div>'+m+'</div>';
  }).join('');
  var qaItems=[
    [!!d.purchasePrice,'Purchase price found'],
    [!!d.noi,'NOI extracted'],
    [!!d.physicalOccupancy,'Occupancy data found'],
    [!!(d.unitMix&&d.unitMix.length),'Unit mix extracted'],
    [!!(d.loanAmount&&d.noi),'DSCR calculable']
  ].map(function(qa){
    return '<div class="check-item"><div class="ck '+(qa[0]?'ck-done':'ck-pend')+'">'+(qa[0]?'✓':'✗')+'</div>'+qa[1]+'</div>';
  }).join('');
  var h='<div class="page-title">AI Recommendation</div>'+
    '<div class="page-sub">Document Context · Gap Alerts · QA · IC Memo Generator</div>';
  h+='<div class="three-col">';
  h+='<div class="panel-box" style="border-left:3px solid var(--red)">'+
    '<div class="section-title" style="color:var(--red)">⚠ Data Gap Alerts</div>'+
    '<div class="checklist">'+missList+'</div></div>';
  h+='<div class="panel-box"><div class="section-title">✅ QA Checklist</div>'+
    '<div class="checklist">'+qaItems+'</div></div>';
  h+='<div class="panel-box"><div class="section-title">🤖 Generate IC Memo</div>'+
    '<p style="font-size:13px;color:var(--muted);margin-bottom:14px;line-height:1.5">'+
    (d.propertyName?'Generate a full IC memo for '+d.propertyName+' using extracted document data.':
    'Upload an OM, T12, or Rent Roll first to generate a property-specific IC Memo.')+'</p>'+
    '<button class="btn btn-purple" onclick="generateMemo()" style="width:100%;justify-content:center;font-size:14px;padding:12px">🤖 Generate Full IC Memo</button>'+
    '<div id="memo-output"></div></div>';
  h+='</div>';
  return h;
}

// ══════════════════════════════════════════════════
// TAB 11 — Ask Document (Chat + IC Memo)
// Only rendered once to preserve chat history.
// ══════════════════════════════════════════════════
function renderAsk(d) {
  var h='<div class="page-title">Ask Document</div>'+
    '<div class="page-sub" id="chat-sub">Upload a document to populate AI context, then ask anything about the deal.</div>';
  h+='<div id="api-key-note" class="api-key-note"'+(ANTHROPIC_API_KEY?' style="display:none"':'')+'>'+
    '⚠️ <strong>Demo Mode:</strong> Set <code>ANTHROPIC_API_KEY</code> in app.js for full Claude AI analysis.</div>';
  h+='<div class="quick-btns">'+
    '<button class="quick-btn" onclick="askQuestion(\'What is the DSCR and is it acceptable?\')">What\'s the DSCR?</button>'+
    '<button class="quick-btn" onclick="askQuestion(\'Summarize this deal in 3 bullet points\')">Summarize the deal</button>'+
    '<button class="quick-btn" onclick="askQuestion(\'What are the top 3 risks for this investment?\')">Top risks</button>'+
    '<button class="quick-btn" onclick="askQuestion(\'What is the exit strategy and projected return?\')">Exit strategy</button>'+
    '<button class="quick-btn" onclick="askQuestion(\'How does this property compare to market comps?\')">Compare to comps</button>'+
    '<button class="quick-btn" onclick="askQuestion(\'What data is missing from this document?\')">Missing data?</button>'+
    '</div>';
  h+='<div class="chat-history" id="chat-history"></div>';
  h+='<div class="chat-input-row">'+
    '<input type="text" id="chat-input" placeholder="Ask anything about the uploaded property…" onkeydown="if(event.key===\'Enter\')sendChat()">'+
    '<button class="btn btn-primary" onclick="sendChat()">Send ➤</button>'+
    '</div>';
  h+='<div style="margin-top:28px">'+
    '<div class="section-title">🤖 Investment Committee Memo Generator</div>'+
    '<p style="font-size:13px;color:var(--muted);margin:10px 0 16px;line-height:1.55">'+
    (d.propertyName?'Generate a full IC memo for <strong>'+d.propertyName+'</strong> using extracted document data.':
    'Upload an OM, T12, or Rent Roll first to generate a property-specific IC Memo.')+
    '</p>'+
    '<button class="btn btn-purple" onclick="generateMemo()">🤖 Generate Full IC Memo</button>'+
    '<div id="memo-output"></div>'+
    '</div>';
  return h;
}

// ══════════════════════════════════════════════════
// RENDER ALL TABS (11 pages)
// tab-ask is only initialized once to preserve chat history.
// ══════════════════════════════════════════════════
function renderAllTabs() {
  setTab('tab-dashboard',  renderDashboard(dealData));
  setTab('tab-returns',    renderReturns(dealData));
  setTab('tab-operating',  renderOperating(dealData));
  setTab('tab-leasing',    renderLeasing(dealData));
  setTab('tab-units',      renderUnits(dealData));
  setTab('tab-credit',     renderCredit(dealData));
  setTab('tab-valuation',  renderValuation(dealData));
  setTab('tab-market',     renderMarket(dealData));
  setTab('tab-esg',        renderESG(dealData));
  setTab('tab-diligence',  renderDiligence(dealData));
  // Ask tab: render once; re-rendering wipes chat history
  var askEl=document.getElementById('tab-ask');
  if(askEl&&!askEl.dataset.initialized){
    askEl.innerHTML=renderAsk(dealData);
    askEl.dataset.initialized='1';
    initChatHistory();
  }
}

// ══════════════════════════════════════════════════
// UPDATE CALCULATIONS
// Re-renders all tabs, updates the calc zone, then
// flash-animates all KPI value elements using Motion One.
// ══════════════════════════════════════════════════
var KPI_IDS = [
  // Dashboard
  'dash-price','dash-noi','dash-dscr','dash-irr','dash-moic','dash-occ','dash-equity','dash-units',
  // Returns
  'ret-irr','ret-moic','ret-coc','ret-dscr','ret-ltv','ret-debtYield','ret-equity','ret-capGoing',
  // Operating
  'op-noi','op-egi','op-oer','op-noim','op-gpr','op-vacLoss','op-totExp','op-expUnit',
  // Leasing
  'ls-physOcc','ls-ecoOcc','ls-leasedPct','ls-tradeout','ls-daysLease','ls-renewalRate','ls-avgRent','ls-marketRent',
  // Unit Economics
  'ue-renoRoi','ue-rentPremium','ue-payback','ue-costUnit','ue-unitsReno','ue-unrenoUpside','ue-capexReqd','ue-valueCreated',
  // Debt
  'debt-dscr','debt-icr','debt-const','debt-beo','debt-annDs','debt-monthlyPi','debt-yield',
  // Valuation
  'val-goingCap','val-exitCap','val-currentVal','val-exitVal','val-valUnit','val-exitUnit','val-equityExit','val-irr',
  // Diligence
  'dd-progress'
];

function updateCalculations() {
  renderAllTabs();
  recalc();
  // Animate after DOM updates have been applied
  requestAnimationFrame(function(){
    KPI_IDS.forEach(flashUpdate);
  });
}

// ══════════════════════════════════════════════════
// LANDING PAGE TRANSITIONS
// ══════════════════════════════════════════════════
var _appEntered = false;

function enterApp() {
  if (_appEntered) return;
  _appEntered = true;
  var landing = document.getElementById('upload-landing');
  var app     = document.getElementById('app');
  if (landing) {
    if (typeof Motion !== 'undefined' && Motion.animate) {
      Motion.animate(landing, { opacity: [1, 0] }, { duration: 0.3 }).then(function(){
        landing.style.display = 'none';
      });
    } else {
      landing.style.display = 'none';
    }
  }
  if (app) {
    app.style.display = 'flex';
    if (typeof Motion !== 'undefined' && Motion.animate) {
      Motion.animate(app, { opacity: [0, 1] }, { duration: 0.35 });
    }
  }
}

function showLanding() {
  _appEntered = false;
  var landing = document.getElementById('upload-landing');
  if (landing) landing.style.display = 'flex';
}

// ══════════════════════════════════════════════════
// NAVIGATE TO (with Motion One tab-in animation)
// ══════════════════════════════════════════════════
function navigateTo(id, btn) {
  document.querySelectorAll('.tab-panel').forEach(function(p){p.classList.remove('active');});
  document.querySelectorAll('.tab-btn').forEach(function(b){b.classList.remove('active');});
  var panel=document.getElementById('tab-'+id);
  if(panel){
    panel.classList.add('active');
    animateTabIn(panel);
  }
  if(btn) btn.classList.add('active');
  // Show the Analyst Calc Zone only on the Dashboard tab
  var cz=document.querySelector('.calc-zone');
  if(cz) cz.style.display=(id==='dashboard')?'block':'none';
}

// Backward-compatible alias
function switchTab(id, btn){ navigateTo(id, btn); }

function initChatHistory() {
  var hist = document.getElementById('chat-history');
  if (hist) hist.innerHTML = '<div class="chat-msg">'+
    '<div class="chat-msg-role assistant">Assistant</div>'+
    '<div class="chat-msg-text">Hello! Upload an Offering Memorandum, T12, Rent Roll, or any property document — I will extract the key CRE metrics and populate all 11 analysis modules automatically. Then ask me anything about the deal.</div></div>';
}

// ══════════════════════════════════════════════════
// SIDEBAR UPDATE
// ══════════════════════════════════════════════════
function updateSidebar() {
  var d=dealData;
  var nameEl=document.getElementById('prop-name');
  var subEl=document.getElementById('prop-sub');
  if(nameEl) nameEl.textContent=d.propertyName||'CRE Analysis Platform';
  if(subEl) subEl.textContent=(d.units?d.units+' Units':'')+(d.location?' · '+d.location:'')+(d.assetClass?' · '+d.assetClass:'');
  if(subEl&&!d.propertyName) subEl.textContent='Upload a document to begin';
  var fields=[
    ['Purchase Price',!!d.purchasePrice],
    ['NOI / Cap Rate',!!(d.noi||d.capRateGoing)],
    ['Occupancy',!!d.physicalOccupancy],
    ['Unit Mix',!!(d.unitMix&&d.unitMix.length)],
    ['Loan Terms',!!(d.loanAmount||d.ltv)],
    ['T12 Actuals',!!d.gpr],
    ['Avg Rent',!!d.avgEffectiveRent],
    ['Year Built',!!d.yearBuilt],
    ['Market Data',!!(d.market&&d.market.rentGrowth)]
  ];
  var found=fields.filter(function(f){return f[1];}).length;
  var pct=Math.round(found/fields.length*100);
  var pctEl=document.getElementById('comp-pct');
  var barEl=document.getElementById('comp-bar-fill');
  var fieldsEl=document.getElementById('comp-fields');
  if(pctEl) pctEl.textContent=pct+'%';
  if(barEl) barEl.style.width=pct+'%';
  if(fieldsEl) fieldsEl.innerHTML=fields.map(function(f){
    return '<div class="comp-field"><div class="dot '+(f[1]?'dot-ok':'dot-miss')+'"></div>'+f[0]+'</div>';
  }).join('');
  var chatSub=document.getElementById('chat-sub');
  if(chatSub) chatSub.textContent=d.propertyName?
    'Powered by Anthropic Claude · Context: '+d.propertyName:
    'Upload a document to populate AI context, or use demo mode.';
}

// ══════════════════════════════════════════════════
// SEED SLIDERS FROM dealData
// ══════════════════════════════════════════════════
function seedSliders() {
  var d=dealData;
  function set(id,val){
    var el=document.getElementById(id);
    if(!el||val==null) return;
    if(+el.min>val) el.min=val*0.5;
    if(+el.max<val) el.max=val*1.5;
    el.value=val;
  }
  if(d.purchasePrice) set('sl-price',d.purchasePrice);
  if(d.capRateGoing)  set('sl-cap',d.capRateGoing);
  if(d.capRateExit)   set('sl-exitcap',d.capRateExit);
  if(d.ltv)           set('sl-ltv',d.ltv);
  if(d.interestRate)  set('sl-rate',d.interestRate);
  if(d.physicalOccupancy) set('sl-occ',d.physicalOccupancy);
  if(d.noiGrowth!=null)   set('sl-nog',d.noiGrowth);
  if(d.holdPeriod)    set('sl-hold',d.holdPeriod);
  if(d.amortization)  set('sl-amort',d.amortization);
}

// ══════════════════════════════════════════════════
// OM CONTEXT FOR AI CHAT
// ══════════════════════════════════════════════════
function updateOMContext() {
  var d=dealData;
  var L=[];
  L.push('CRE INVESTMENT ANALYSIS — EXTRACTED DATA');
  L.push('');
  if(d.propertyName) L.push('Property: '+d.propertyName);
  if(d.location) L.push('Location: '+d.location);
  if(d.units) L.push('Units: '+d.units);
  if(d.yearBuilt) L.push('Year Built: '+d.yearBuilt);
  if(d.assetClass) L.push('Asset Class: '+d.assetClass);
  L.push('');
  if(d.purchasePrice) L.push('Purchase Price: '+commas(d.purchasePrice));
  if(d.noi) L.push('NOI: '+commas(d.noi));
  if(d.capRateGoing) L.push('Going-in Cap Rate: '+fmtPct(d.capRateGoing,2));
  if(d.capRateExit) L.push('Exit Cap Rate: '+fmtPct(d.capRateExit,2));
  if(d.gpr) L.push('GPR: '+commas(d.gpr));
  if(d.egi) L.push('EGI: '+commas(d.egi));
  if(d.totalExpenses) L.push('Total Expenses: '+commas(d.totalExpenses));
  L.push('');
  if(d.loanAmount) L.push('Loan Amount: '+commas(d.loanAmount));
  if(d.ltv) L.push('LTV: '+fmtPct(d.ltv,0));
  if(d.interestRate) L.push('Interest Rate: '+fmtPct(d.interestRate,2));
  if(d.amortization) L.push('Amortization: '+d.amortization+' years');
  L.push('');
  if(d.physicalOccupancy) L.push('Physical Occupancy: '+fmtPct(d.physicalOccupancy,1));
  if(d.avgEffectiveRent) L.push('Avg Effective Rent: '+commas(d.avgEffectiveRent)+'/mo');
  if(d.renewalRate) L.push('Renewal Rate: '+fmtPct(d.renewalRate,0));
  if(d.unitMix&&d.unitMix.length){
    L.push('');
    L.push('UNIT MIX:');
    d.unitMix.forEach(function(u){L.push('- '+u.type+': '+u.units+' units @ $'+u.rent+'/mo');});
  }
  if(d.missing&&d.missing.length){
    L.push('');
    L.push('DATA GAPS: '+d.missing.join(', '));
  }
  OM_CONTEXT=L.join('\n');
}

// ══════════════════════════════════════════════════
// CRE DATA EXTRACTION ENGINE
// ══════════════════════════════════════════════════
function extractCREData(text) {
  var t=text;
  var out={extractedFields:[]};

  function tryNum(pats,xfm){
    for(var i=0;i<pats.length;i++){
      var m=t.match(pats[i]);
      if(m){
        var n=parseFloat(m[1].replace(/,/g,''));
        if(!isNaN(n)&&n>0) return xfm?xfm(n,m[0]):n;
      }
    }
    return null;
  }
  function tryPct(pats){
    for(var i=0;i<pats.length;i++){
      var m=t.match(pats[i]);
      if(m){var n=parseFloat(m[1]);if(!isNaN(n)&&n>0&&n<=100) return n;}
    }
    return null;
  }
  function scaleMoney(n,s){
    if(/million|MM|\bM\b/i.test(s)&&n<10000) return n*1e6;
    if(/thousand|\bK\b/i.test(s)&&n<100000) return n*1000;
    if(n<1000&&n>0) return n*1e6;
    return n;
  }

  var nm=t.match(/(?:property|project)\s+name[:\s]+([A-Z][A-Za-z0-9\s\-&']{2,50})/i)||
         t.match(/^([A-Z][A-Za-z0-9\s\-&']{4,50})\s*(?:Apartments?|Flats?|Cove|Ridge|Park|Place|Court|Commons?|Villas?|Towers?|Gardens?|Heights?|Landing|Crossing|Manor)/m);
  if(nm){out.propertyName=nm[1].trim();out.extractedFields.push('Property Name');}

  var lc=t.match(/(?:location|city|market|address)[:\s]+([A-Za-z\s]+,\s*(?:[A-Z]{2}|Texas|Florida|California|Georgia|Colorado|Arizona|Washington|Oregon|Virginia|Illinois|Ohio|Nevada|New York|North Carolina))/i);
  if(lc){out.location=lc[1].trim();out.extractedFields.push('Location');}

  var units=tryNum([/([\d,]+)\s*[-–]\s*unit/i,/([\d,]+)\s+(?:residential\s+)?apartment\s+units?/i,/total\s+units?[:\s]+([\d,]+)/i,/([\d,]+)\s+units?\b/i]);
  if(units&&units>0&&units<50000){out.units=Math.round(units);out.extractedFields.push('Units');}

  var pp=tryNum([/(?:purchase|acquisition|asking|sale|offering)\s+price[:\s]+\$?\s*([\d,.]+)\s*(?:million|MM|M\b)?/i,/\$\s*([\d,.]+)\s*(?:million|M)\s+(?:purchase|sale|asking)/i],scaleMoney);
  if(pp&&pp>100000&&pp<1e10){out.purchasePrice=pp;out.extractedFields.push('Purchase Price');}

  var noi=tryNum([/net\s+operating\s+income[:\s]+\$?\s*([\d,.]+)\s*(?:million|MM|M\b|thousand|K)?/i,/\bNOI[:\s]+\$?\s*([\d,.]+)\s*(?:million|MM|M\b|thousand|K)?/i],scaleMoney);
  if(noi&&noi>1000&&noi<1e9){out.noi=noi;out.extractedFields.push('NOI');}

  var gpr=tryNum([/gross\s+potential\s+rent[:\s]+\$?\s*([\d,.]+)\s*(?:million|MM|M\b|thousand|K)?/i,/\bGPR[:\s]+\$?\s*([\d,.]+)/i],scaleMoney);
  if(gpr&&gpr>10000&&gpr<1e9){out.gpr=gpr;out.extractedFields.push('GPR');}

  var egi=tryNum([/effective\s+gross\s+(?:income|revenue)[:\s]+\$?\s*([\d,.]+)\s*(?:million|MM|M\b|thousand|K)?/i,/\bEGI[:\s]+\$?\s*([\d,.]+)/i],scaleMoney);
  if(egi&&egi>10000&&egi<1e9){out.egi=egi;out.extractedFields.push('EGI');}

  var exp=tryNum([/total\s+(?:operating\s+)?expenses?[:\s]+\$?\s*([\d,.]+)\s*(?:million|MM|M\b|thousand|K)?/i,/total\s+opex[:\s]+\$?\s*([\d,.]+)/i],scaleMoney);
  if(exp&&exp>1000&&exp<1e9){out.totalExpenses=exp;out.extractedFields.push('Total Expenses');}

  var capR=tryPct([/(?:going.in\s+)?cap(?:italization)?\s+rate[:\s]+([\d.]+)\s*%/i,/([\d.]+)\s*%\s+cap(?:italization)?\s+rate/i,/\bcap\s+rate[:\s]+([\d.]+)/i]);
  if(capR&&capR>1&&capR<20){out.capRateGoing=capR;out.extractedFields.push('Cap Rate');}

  var ec=tryPct([/exit\s+cap(?:italization)?\s+rate[:\s]+([\d.]+)\s*%/i,/(?:reversion|terminal|exit)\s+cap[:\s]+([\d.]+)/i]);
  if(ec&&ec>1&&ec<20){out.capRateExit=ec;out.extractedFields.push('Exit Cap');}

  var ltv=tryPct([/(?:loan.to.value|LTV)[:\s]+([\d.]+)\s*%/i,/([\d.]+)\s*%\s+(?:loan.to.value|LTV)/i]);
  if(ltv&&ltv>20&&ltv<100){out.ltv=ltv;out.extractedFields.push('LTV');}

  var ir=tryPct([/interest\s+rate[:\s]+([\d.]+)\s*%/i,/([\d.]+)\s*%\s+(?:fixed|floating|variable)/i,/coupon\s+rate[:\s]+([\d.]+)\s*%/i]);
  if(ir&&ir>0.5&&ir<30){out.interestRate=ir;out.extractedFields.push('Interest Rate');}

  var la=tryNum([/loan\s+amount[:\s]+\$?\s*([\d,.]+)\s*(?:million|MM|M\b|thousand|K)?/i,/(?:total\s+)?(?:debt|mortgage)[:\s]+\$?\s*([\d,.]+)\s*(?:million|MM|M\b)?/i],scaleMoney);
  if(la&&la>10000&&la<1e10){out.loanAmount=la;out.extractedFields.push('Loan Amount');}

  var am=t.match(/(\d+)[- ]?year\s+amort(?:ization)?/i)||t.match(/amort(?:ization)?[:\s]+(\d+)\s*(?:years?|yr)/i);
  if(am){var a=parseInt(am[1]);if(a>=10&&a<=40){out.amortization=a;out.extractedFields.push('Amortization');}}

  var hp=t.match(/(\d+)[- ]?year\s+hold/i)||t.match(/hold\s+period[:\s]+(\d+)\s*(?:years?|yr)/i);
  if(hp){var hv=parseInt(hp[1]);if(hv>=1&&hv<=20){out.holdPeriod=hv;out.extractedFields.push('Hold Period');}}

  var occ=tryPct([/physical\s+occupancy[:\s]+([\d.]+)\s*%/i,/(?:current\s+)?occupancy[:\s]+([\d.]+)\s*%/i,/([\d.]+)\s*%\s+(?:physically?\s+)?occupied/i]);
  if(occ&&occ>30&&occ<=100){out.physicalOccupancy=occ;out.extractedFields.push('Occupancy');}

  var ar=tryNum([/(?:average|avg\.?|blended)\s+(?:effective\s+)?rent[:\s]+\$?\s*([\d,.]+)/i,/avg\.?\s+rent\s+per\s+unit[:\s]+\$?\s*([\d,.]+)/i]);
  if(ar&&ar>100&&ar<50000){out.avgEffectiveRent=ar;out.extractedFields.push('Avg Rent');}

  var yb=t.match(/(?:year\s+built|built\s+in|constructed)[:\s]+(19\d{2}|20\d{2})/i);
  if(yb){out.yearBuilt=parseInt(yb[1]);out.extractedFields.push('Year Built');}

  var ng=tryPct([/(?:NOI|income)\s+growth[:\s]+([\d.]+)\s*%/i,/annual\s+(?:rent|income)\s+growth[:\s]+([\d.]+)\s*%/i]);
  if(ng!=null&&ng>=0&&ng<20){out.noiGrowth=ng;out.extractedFields.push('NOI Growth');}

  var mixRows=[];
  [['Studio|0\\s*BR',  'Studio (0BR)'],
   ['1\\s*BR(?:edroom)?','1 Bedroom'],
   ['2\\s*BR(?:edroom)?','2 Bedroom'],
   ['3\\s*BR(?:edroom)?','3 Bedroom'],
   ['4\\s*BR(?:edroom)?','4 Bedroom']].forEach(function(pair){
    var pat=new RegExp(pair[0]+'[^\\n]*?([\\d,]+)\\s+units?[^\\n]*?\\$\\s*([\\d,]+)','i');
    var m=t.match(pat);
    if(m){
      var u=parseInt(m[1].replace(/,/g,''));
      var r=parseInt(m[2].replace(/,/g,''));
      if(u>0&&u<5000&&r>100&&r<50000) mixRows.push({type:pair[1],units:u,rent:r,sf:null,occ:null});
    }
  });
  if(mixRows.length>=2){out.unitMix=mixRows;out.extractedFields.push('Unit Mix');}

  var mkt={};
  var msaM=t.match(/(?:MSA|metro\s+area|submarket)[:\s]+([A-Za-z\s\-]+(?:MSA|Metro|Area)?)/i);
  if(msaM) mkt.msa=msaM[1].trim().replace(/\s+/g,' ');
  var pg=tryPct([/population\s+growth[:\s]+([\d.]+)\s*%/i]);if(pg) mkt.popGrowth=pg;
  var jg=tryPct([/job\s+growth[:\s]+([\d.]+)\s*%/i]);if(jg) mkt.jobGrowth=jg;
  var rg=tryPct([/rent\s+growth[:\s]+([\d.]+)\s*%/i,/rental\s+rate\s+growth[:\s]+([\d.]+)\s*%/i]);if(rg) mkt.rentGrowth=rg;
  var mv=tryPct([/market\s+vacancy[:\s]+([\d.]+)\s*%/i,/submarket\s+vacancy[:\s]+([\d.]+)\s*%/i]);if(mv) mkt.marketVacancy=mv;
  if(Object.keys(mkt).length) out.market=mkt;

  var expD={};
  [['taxes',/(?:property|real\s+estate)\s+taxes?[:\s]+\$?\s*([\d,]+)/i],
   ['insurance',/insurance[:\s]+\$?\s*([\d,]+)/i],
   ['management',/(?:property\s+)?management\s+(?:fee)?[:\s]+\$?\s*([\d,]+)/i],
   ['maintenance',/(?:maintenance|repairs?)[:\s]+\$?\s*([\d,]+)/i],
   ['utilities',/utilities?[:\s]+\$?\s*([\d,]+)/i],
   ['payroll',/(?:payroll|admin(?:istration)?)[:\s]+\$?\s*([\d,]+)/i],
   ['reserves',/(?:capital\s+)?reserves?[:\s]+\$?\s*([\d,]+)/i]
  ].forEach(function(e){
    var m=t.match(e[1]);
    if(m){var v=parseFloat(m[1].replace(/,/g,''));if(v>100&&v<1e8) expD[e[0]]=v;}
  });
  if(Object.keys(expD).length>=2) out.expenses=expD;

  var rc=tryNum([/(?:average|avg\.?)\s+reno(?:vation)?\s+cost[:\s]+\$?\s*([\d,]+)/i,/reno(?:vation)?\s+cost\s+per\s+unit[:\s]+\$?\s*([\d,]+)/i]);
  var rp=tryNum([/rent\s+premium[:\s]+\$?\s*([\d,]+)/i,/premium\s+post.reno(?:vation)?[:\s]+\$?\s*([\d,]+)/i]);
  var ru=tryNum([/(?:units\s+renovated|renovated\s+units)[:\s]+([\d,]+)/i]);
  if(rc||rp){out.renovation={costPerUnit:rc,rentPremium:rp,unitsRenovated:ru?Math.round(ru):0};out.extractedFields.push('Renovation Data');}

  var miss=[];
  if(!out.noi&&!out.capRateGoing) miss.push('NOI / Cap Rate');
  if(!out.physicalOccupancy) miss.push('Occupancy Data');
  if(!out.unitMix||!out.unitMix.length) miss.push('Unit Mix / Rent Roll');
  if(!out.loanAmount&&!out.ltv) miss.push('Loan Terms');
  if(!out.gpr) miss.push('T12 Actuals / GPR');
  if(!out.yearBuilt) miss.push('Year Built');
  out.missing=miss;

  return out;
}

// ══════════════════════════════════════════════════
// APPLY EXTRACTED DATA TO dealData
// ══════════════════════════════════════════════════
function applyExtractedData(extracted) {
  Object.keys(extracted).forEach(function(k){
    if(extracted[k]!==null&&extracted[k]!==undefined) dealData[k]=extracted[k];
  });
  if(dealData.purchasePrice&&dealData.noi&&!dealData.capRateGoing)
    dealData.capRateGoing=dealData.noi/dealData.purchasePrice*100;
  if(dealData.purchasePrice&&dealData.ltv&&!dealData.loanAmount)
    dealData.loanAmount=dealData.purchasePrice*dealData.ltv/100;
  if(dealData.loanAmount&&dealData.purchasePrice&&!dealData.ltv)
    dealData.ltv=dealData.loanAmount/dealData.purchasePrice*100;
  if(!dealData.capRateExit&&dealData.capRateGoing)
    dealData.capRateExit=dealData.capRateGoing+0.7;
  if(dealData.gpr&&dealData.totalExpenses&&!dealData.noi){
    var eg=dealData.egi||(dealData.gpr*0.9);
    dealData.noi=eg-dealData.totalExpenses;
  }

  updateCalculations();
  updateSidebar();
  seedSliders();
  updateOMContext();
  enterApp(); // transition from landing page to main app

  var fieldsEl=document.getElementById('upload-fields');
  if(fieldsEl){
    var tags=extracted.extractedFields.map(function(f){return '<span class="field-tag field-tag-found">✓ '+f+'</span>';});
    if(extracted.missing) tags=tags.concat(extracted.missing.map(function(f){return '<span class="field-tag field-tag-miss">✗ '+f+'</span>';}));
    fieldsEl.innerHTML=tags.join('');
  }
}

// ══════════════════════════════════════════════════
// FILE UPLOAD HANDLERS
// ══════════════════════════════════════════════════
function setUploadStatus(msg, pct) {
  var s=document.getElementById('upload-status');
  var f=document.getElementById('upload-status-fill');
  var m=document.getElementById('upload-msg');
  if(s) s.style.display='block';
  if(f) f.style.width=(pct||0)+'%';
  if(m) m.textContent=msg||'';
}

function handleDrop(event) {
  event.preventDefault();
  document.getElementById('upload-drop').classList.remove('drag-over');
  var file=event.dataTransfer.files[0];
  if(file) processFile(file);
}

function handleFileSelect(event) {
  var file=event.target.files[0];
  if(file) processFile(file);
}

function processFile(file) {
  var nameEl=document.getElementById('upload-file-name');
  var iconEl=document.getElementById('upload-file-icon');
  if(nameEl) nameEl.textContent=file.name;
  var ext=file.name.split('.').pop().toLowerCase();
  var icons={pdf:'📕',xlsx:'📗',xls:'📗',csv:'📊',txt:'📄',text:'📄'};
  if(iconEl) iconEl.textContent=icons[ext]||'📄';
  setUploadStatus('Reading file…',10);

  var reader=new FileReader();
  reader.onerror=function(){setUploadStatus('⚠ Could not read file.',0);};
  reader.onload=function(e){
    setUploadStatus('Parsing…',40);
    try {
      if(ext==='pdf') {
        parsePDF(e.target.result);
      } else if(ext==='xlsx'||ext==='xls') {
        parseExcel(e.target.result);
      } else {
        setUploadStatus('Extracting CRE fields…',70);
        var extracted=extractCREData(e.target.result);
        setUploadStatus('Applying to dashboard…',90);
        applyExtractedData(extracted);
        setUploadStatus('✅ Done — '+extracted.extractedFields.length+' fields extracted.',100);
      }
    } catch(err) {
      setUploadStatus('⚠ Error: '+err.message,0);
    }
  };
  if(ext==='pdf'||ext==='xlsx'||ext==='xls') reader.readAsArrayBuffer(file);
  else reader.readAsText(file);
}

function parsePDF(arrayBuffer) {
  if(typeof pdfjsLib==='undefined'){
    setUploadStatus('⚠ PDF.js not loaded. Try CSV/TXT.',0); return;
  }
  pdfjsLib.GlobalWorkerOptions.workerSrc=
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  pdfjsLib.getDocument({data:arrayBuffer}).promise.then(function(pdf){
    var total=pdf.numPages, texts=[], done=0;
    function getPage(n){
      pdf.getPage(n).then(function(page){
        page.getTextContent().then(function(tc){
          texts.push(tc.items.map(function(i){return i.str;}).join(' '));
          done++;
          setUploadStatus('Parsing PDF page '+done+'/'+total+'…',20+(done/total*50));
          if(done<total) getPage(n+1);
          else {
            var fullText=texts.join('\n');
            setUploadStatus('Extracting CRE fields…',75);
            var extracted=extractCREData(fullText);
            setUploadStatus('Applying to dashboard…',90);
            applyExtractedData(extracted);
            setUploadStatus('✅ Done — '+extracted.extractedFields.length+' fields from '+total+'-page PDF.',100);
          }
        });
      });
    }
    getPage(1);
  }).catch(function(err){setUploadStatus('⚠ PDF error: '+err.message,0);});
}

function parseExcel(arrayBuffer) {
  if(typeof XLSX==='undefined'){
    setUploadStatus('⚠ SheetJS not loaded. Try CSV/TXT.',0); return;
  }
  var wb=XLSX.read(new Uint8Array(arrayBuffer),{type:'array'});
  var allText=[];
  wb.SheetNames.forEach(function(name){
    allText.push('=== Sheet: '+name+' ===\n'+XLSX.utils.sheet_to_csv(wb.Sheets[name]));
  });
  var fullText=allText.join('\n\n');
  setUploadStatus('Extracting from spreadsheet…',70);
  var extracted=extractCREData(fullText);
  wb.SheetNames.forEach(function(name){
    var rows=XLSX.utils.sheet_to_json(wb.Sheets[name],{header:1});
    rows.forEach(function(row){
      if(!Array.isArray(row)) return;
      var k=(row[0]||'').toString().toLowerCase().trim();
      var v=row[1]!=null?row[1]:row[2];
      if(!k||v==null) return;
      var n=typeof v==='number'?v:parseFloat((v+'').replace(/[$,%]/g,''));
      if(isNaN(n)) return;
      if(k.includes('purchase price')||k.includes('asking price')) extracted.purchasePrice=extracted.purchasePrice||n;
      if(k==='noi'||k.includes('net operating income')) extracted.noi=extracted.noi||n;
      if(k.includes('cap rate')){var p=n>1?n:n*100;if(p>1&&p<20) extracted.capRateGoing=extracted.capRateGoing||p;}
      if(k.includes('units')||k==='# of units'){if(n>0&&n<50000) extracted.units=extracted.units||Math.round(n);}
      if(k.includes('occupancy')){var p2=n>1?n:n*100;if(p2>30&&p2<=100) extracted.physicalOccupancy=extracted.physicalOccupancy||p2;}
      if(k.includes('interest rate')){var r=n>1?n:n*100;if(r>0.5&&r<30) extracted.interestRate=extracted.interestRate||r;}
      if(k.includes('loan amount')||k.includes('mortgage')){if(n>10000) extracted.loanAmount=extracted.loanAmount||n;}
    });
  });
  setUploadStatus('Applying to dashboard…',90);
  applyExtractedData(extracted);
  setUploadStatus('✅ Done — '+extracted.extractedFields.length+' fields from spreadsheet.',100);
}

// ══════════════════════════════════════════════════
// ENHANCED RECALC (uses all 9 sliders)
// ══════════════════════════════════════════════════
var scenarios = [];

function recalc() {
  var price=+document.getElementById('sl-price').value;
  var capPct=+document.getElementById('sl-cap').value;
  var exitCapPct=+document.getElementById('sl-exitcap').value;
  var ltvPct=+document.getElementById('sl-ltv').value;
  var ratePct=+document.getElementById('sl-rate').value;
  var occPct=+document.getElementById('sl-occ').value;
  var nogPct=+document.getElementById('sl-nog').value;
  var holdYrs=+document.getElementById('sl-hold').value;
  var amortYrs=+document.getElementById('sl-amort').value;

  function lbl(id,txt){var e=document.getElementById(id);if(e)e.textContent=txt;}
  lbl('lbl-price','$'+(price/1e6).toFixed(2)+'M');
  lbl('lbl-cap',capPct.toFixed(2)+'%');
  lbl('lbl-exitcap',exitCapPct.toFixed(2)+'%');
  lbl('lbl-ltv',ltvPct.toFixed(0)+'%');
  lbl('lbl-rate',ratePct.toFixed(2)+'%');
  lbl('lbl-occ',occPct.toFixed(1)+'%');
  lbl('lbl-nog',nogPct.toFixed(2)+'%');
  lbl('lbl-hold',holdYrs);
  lbl('lbl-amort',amortYrs);

  var noi=price*(capPct/100)*(occPct/100);
  var loanAmt=price*(ltvPct/100);
  var equity=price-loanAmt;
  var annDS=calcPMT(ratePct/100,amortYrs*12,loanAmt)*12;
  var dscr=noi/annDS;
  var ncf1=noi-annDS;
  var coc=ncf1/equity*100;
  var debtYield=noi/loanAmt*100;
  var debtConst=annDS/loanAmt*100;
  var beoOcc=annDS/(price*(capPct/100))*100;

  var sched=buildLoanSchedule(loanAmt,ratePct/100,amortYrs,holdYrs);
  var loanBal=sched[holdYrs-1].endBal;
  var noiExit=noi*Math.pow(1+nogPct/100,holdYrs);
  var exitVal=noiExit/(exitCapPct/100);

  var cfs=[-equity], cumCF=0;
  for(var yr=1;yr<=holdYrs;yr++){
    var noiYr=noi*Math.pow(1+nogPct/100,yr);
    var ncfYr=noiYr-annDS; cumCF+=ncfYr;
    cfs.push(yr===holdYrs?ncfYr+(exitVal-loanBal):ncfYr);
  }
  var irr=calcIRR(cfs)*100;
  var moic=(cumCF+(exitVal-loanBal))/equity;

  var ucfs=[-price];
  for(var uy=1;uy<=holdYrs;uy++){
    var un=noi*Math.pow(1+nogPct/100,uy);
    ucfs.push(uy===holdYrs?un+exitVal:un);
  }
  var uirr=calcIRR(ucfs)*100;

  function setOut(id,text,color){
    var e=document.getElementById(id);
    if(e){e.textContent=text;if(color) e.style.color=color;}
  }
  setOut('out-dscr',dscr.toFixed(2)+'×',dscr>=1.25?'var(--green)':dscr>=1.10?'var(--yellow)':'var(--red)');
  setOut('out-irr',irr.toFixed(1)+'%',irr>=15?'var(--green)':irr>=10?'var(--yellow)':'var(--red)');
  setOut('out-moic',moic.toFixed(2)+'×',moic>=1.7?'var(--green)':moic>=1.3?'var(--yellow)':'var(--red)');
  setOut('out-exit',fmt$(exitVal));
  setOut('out-eq',fmt$(equity));
  setOut('out-coc',coc.toFixed(1)+'%',coc>=5?'var(--green)':coc>=3?'var(--yellow)':'var(--red)');
  setOut('out-dy',debtYield.toFixed(1)+'%',debtYield>=7.5?'var(--green)':'var(--yellow)');
  setOut('out-beo',beoOcc.toFixed(0)+'%',beoOcc<75?'var(--green)':beoOcc<85?'var(--yellow)':'var(--red)');
  setOut('out-dc',debtConst.toFixed(2)+'%');
  setOut('out-uirr',uirr.toFixed(1)+'%',uirr>=8?'var(--green)':'var(--yellow)');

  var wfBody=document.getElementById('waterfall-tbody');
  if(wfBody){
    wfBody.innerHTML='';
    var runCF=0;
    sched.forEach(function(row){
      var noiR=noi*Math.pow(1+nogPct/100,row.year);
      var ncfR=noiR-annDS; runCF+=ncfR;
      var cocR=(ncfR/equity)*100;
      var tr=document.createElement('tr');
      tr.innerHTML='<td>Y'+row.year+'</td>'+
        '<td>'+commas(noiR)+'</td>'+
        '<td>'+commas(annDS)+'</td>'+
        '<td style="color:'+(ncfR>=0?'var(--green)':'var(--red)')+'">'+commas(ncfR)+'</td>'+
        '<td>'+cocR.toFixed(1)+'%</td>'+
        '<td>'+commas(row.endBal)+'</td>'+
        '<td>'+commas(runCF)+'</td>';
      wfBody.appendChild(tr);
    });
  }

  window._lastCalc={price,capPct,exitCapPct,ltvPct,ratePct,occPct,nogPct,holdYrs,amortYrs,
    dscr,irr,moic,exitVal,equity,coc,debtYield,beoOcc,debtConst,uirr};
}

function saveScenario() {
  if(!window._lastCalc) recalc();
  var c=window._lastCalc;
  scenarios.push(c);
  var tbody=document.getElementById('scenario-tbody');
  var tr=document.createElement('tr');
  tr.innerHTML=[
    scenarios.length,fmt$(c.price),c.capPct.toFixed(2)+'%',c.exitCapPct.toFixed(2)+'%',
    c.ltvPct+'%',c.ratePct.toFixed(2)+'%',c.occPct.toFixed(1)+'%',
    c.nogPct.toFixed(1)+'%',c.holdYrs+'yr',
    c.dscr.toFixed(2)+'×',c.irr.toFixed(1)+'%',c.moic.toFixed(2)+'×',
    fmt$(c.exitVal),c.coc.toFixed(1)+'%',fmt$(c.equity)
  ].map(function(v){return '<td>'+v+'</td>';}).join('');
  tbody.appendChild(tr);
  document.getElementById('scenario-table-wrap').style.display='block';
  document.getElementById('scenario-count').textContent=scenarios.length+' scenario(s) saved';
}

function clearScenarios() {
  scenarios=[];
  document.getElementById('scenario-tbody').innerHTML='';
  document.getElementById('scenario-table-wrap').style.display='none';
  document.getElementById('scenario-count').textContent='';
}

// ══════════════════════════════════════════════════
// CHAT
// ══════════════════════════════════════════════════
function appendMsg(role, text) {
  var hist=document.getElementById('chat-history');
  var div=document.createElement('div');
  div.className='chat-msg';
  div.innerHTML='<div class="chat-msg-role '+role+'">'+(role==='user'?'You':'Assistant')+'</div>'+
    '<div class="chat-msg-text">'+text.replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</div>';
  hist.appendChild(div);
  hist.scrollTop=hist.scrollHeight;
}
function appendThinking() {
  var hist=document.getElementById('chat-history');
  var div=document.createElement('div');
  div.className='chat-msg'; div.id='thinking-msg';
  div.innerHTML='<div class="chat-msg-role assistant">Assistant</div><div class="chat-msg-text" style="color:var(--muted)">Thinking…</div>';
  hist.appendChild(div); hist.scrollTop=hist.scrollHeight;
}
function removeThinking(){var el=document.getElementById('thinking-msg');if(el)el.remove();}
var chatHistory=[];
function askQuestion(q){document.getElementById('chat-input').value=q;sendChat();}

function sendChat() {
  var input=document.getElementById('chat-input');
  var q=input.value.trim(); if(!q) return;
  input.value='';
  appendMsg('user',q);
  chatHistory.push({role:'user',content:q});

  if(!ANTHROPIC_API_KEY) {
    var d=dealData, lower=q.toLowerCase(), resp='';
    if(lower.includes('dscr')&&d.noi&&d.loanAmount){
      var la=d.loanAmount,r=d.interestRate||6.25,a=d.amortization||30;
      var ds=calcPMT(r/100,a*12,la)*12;
      var dv=d.noi/ds;
      resp='DSCR = '+dv.toFixed(2)+'× (NOI '+commas(d.noi)+' / DS '+commas(ds)+'). '+(dv>=1.2?'Above':'Below')+' typical lender minimum of 1.20×.';
    } else if(lower.includes('summar')||lower.includes('overview')) {
      resp=d.propertyName?'Summary of '+d.propertyName+':\n\n'+OM_CONTEXT:
        'No document uploaded yet. Upload an OM, T12, or Rent Roll to get property-specific analysis.';
    } else if(lower.includes('noi')&&d.noi) {
      resp='Extracted NOI: '+commas(d.noi)+(d.capRateGoing?' at '+fmtPct(d.capRateGoing,2)+' cap rate':'')+'. Use the Analyst Calc Zone to run scenarios.';
    } else {
      resp=d.propertyName?
        'Based on the uploaded data for '+d.propertyName+':\n\n'+OM_CONTEXT.substring(0,800)+
        '\n\n[Set your Anthropic API key for full AI analysis]':
        'Upload a document first — I will answer questions about the extracted property data. [Configure API key for AI-powered responses]';
    }
    setTimeout(function(){appendMsg('assistant',resp);},400);
    return;
  }
  appendThinking();
  fetch('https://api.anthropic.com/v1/messages',{
    method:'POST',
    headers:{'x-api-key':ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01',
      'content-type':'application/json','anthropic-dangerous-direct-browser-calls':'true'},
    body:JSON.stringify({model:'claude-opus-4-5',max_tokens:1024,
      system:'You are a senior CRE analyst. Use this extracted property data:\n\n'+OM_CONTEXT,
      messages:chatHistory})
  }).then(function(r){return r.json();})
  .then(function(data){
    removeThinking();
    var text=data.content&&data.content[0]?data.content[0].text:JSON.stringify(data);
    chatHistory.push({role:'assistant',content:text});
    appendMsg('assistant',text);
  }).catch(function(err){removeThinking();appendMsg('assistant','API error: '+err.message);});
}

// ══════════════════════════════════════════════════
// IC MEMO GENERATOR
// ══════════════════════════════════════════════════
function generateMemo() {
  var out=document.getElementById('memo-output');
  if(!out) return;
  out.style.display='block';
  var d=dealData;
  if(!ANTHROPIC_API_KEY){
    var la=d.loanAmount||(d.purchasePrice?d.purchasePrice*0.65:0);
    var eq=d.purchasePrice?d.purchasePrice-la:0;
    var r=d.interestRate||6.25, am=d.amortization||30;
    var ds=la?calcPMT(r/100,am*12,la)*12:0;
    var dv=d.noi&&ds?d.noi/ds:0;
    var coc=d.noi&&ds&&eq?(d.noi-ds)/eq*100:0;
    out.textContent='INVESTMENT COMMITTEE MEMORANDUM\n'+
      '════════════════════════════════\n'+
      'ASSET:    '+(d.propertyName||'Property')+'\n'+
      'LOCATION: '+(d.location||'—')+'\n'+
      'DATE:     '+new Date().toLocaleDateString()+'\n'+
      '════════════════════════════════\n\n'+
      'I. EXECUTIVE SUMMARY\n'+
      (d.propertyName||'This property')+' is a '+(d.units||'?')+'-unit '+(d.assetClass||'multifamily')+' property'+
      (d.location?' in '+d.location:'')+' '+(d.yearBuilt?'built in '+d.yearBuilt:'')+'\n'+
      (d.purchasePrice?'Purchase price: '+commas(d.purchasePrice)+' ('+fmtPct(d.capRateGoing||0,2)+' going-in cap).\n':'')+
      '\nII. FINANCIAL SUMMARY\n'+
      (d.purchasePrice?'- Purchase Price: '+commas(d.purchasePrice)+'\n':'')+
      (d.noi?'- NOI: '+commas(d.noi)+'\n':'')+
      (la?'- Loan: '+commas(la)+' @ '+fmtPct(r,2)+' / '+am+'yr AM\n':'')+
      (dv?'- DSCR: '+dv.toFixed(2)+'×\n':'')+
      (coc?'- CoC Y1: '+fmtPct(coc,1)+'\n':'')+
      '\nIII. DATA GAPS\n'+
      (d.missing&&d.missing.length?d.missing.map(function(m){return '- '+m;}).join('\n'):'None identified')+
      '\n\n════════════════════════════════\n'+
      'Configure Anthropic API key for AI-generated memos.\n════════════════════════════════';
    return;
  }
  out.textContent='Generating IC Memo via Claude…';
  fetch('https://api.anthropic.com/v1/messages',{
    method:'POST',
    headers:{'x-api-key':ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01',
      'content-type':'application/json','anthropic-dangerous-direct-browser-calls':'true'},
    body:JSON.stringify({model:'claude-opus-4-5',max_tokens:2048,
      messages:[{role:'user',content:'Generate a full professional Investment Committee Memorandum. Sections: Executive Summary, Investment Thesis, Financial Analysis, Risk Factors, Recommendation.\n\n'+OM_CONTEXT}]})
  }).then(function(r){return r.json();})
  .then(function(d2){out.textContent=d2.content&&d2.content[0]?d2.content[0].text:JSON.stringify(d2);})
  .catch(function(err){out.textContent='Error: '+err.message;});
}

// ══════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════
if(ANTHROPIC_API_KEY){
  var noteEl=document.getElementById('api-key-note');
  if(noteEl) noteEl.style.display='none';
}

// Render all 11 tabs; tab-ask is initialized once (preserving chat history).
// Chat history greeting is set inside initChatHistory() called from renderAllTabs().
renderAllTabs();
updateSidebar();
recalc();
