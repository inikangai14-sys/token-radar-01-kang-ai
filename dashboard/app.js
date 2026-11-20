(function(){
'use strict';
var DATA=window.RADAR;
if(!DATA)return;
var BASE_PLAN=3100,BASE_SHARE=0.07,T_BILL=0.04;
var state={q:'',category:'all',chain:'all',verdict:'all',watchlist:false,sort:'rank',dir:1};
var usd=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0});
var usd2=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2});
function money(n){if(n===null||n===undefined||!isFinite(n))return 'n/a';if(Math.abs(n)>=1e9)return '$'+(n/1e9).toFixed(2)+'B';if(Math.abs(n)>=1e6)return '$'+(n/1e6).toFixed(1)+'M';if(Math.abs(n)>=1e3)return '$'+(n/1e3).toFixed(1)+'K';return usd.format(n)}
function fullMoney(n){if(n===null||n===undefined||!isFinite(n))return 'n/a';return usd.format(n)}
function pct(n){if(n===null||n===undefined||!isFinite(n))return 'n/a';return (n>0?'+':'')+n.toFixed(2)+'%'}
function age(n){if(n===null||n===undefined)return 'unknown';if(n>=365)return (n/365).toFixed(1)+'y';return n+'d'}
function chains(r){return r.chains&&r.chains.length?r.chains.join(' / '):'unknown chain'}
function el(tag,attrs){var node=document.createElement(tag);if(attrs)Object.keys(attrs).forEach(function(k){if(k==='class')node.className=attrs[k];else if(k==='text')node.textContent=attrs[k];else if(k.slice(0,2)==='on')node.addEventListener(k.slice(2),attrs[k]);else if(attrs[k]!==null&&attrs[k]!==undefined)node.setAttribute(k,attrs[k])});for(var i=2;i<arguments.length;i++){var c=arguments[i];if(c===null||c===undefined)continue;if(Array.isArray(c))c.forEach(function(x){if(x)node.appendChild(x)});else if(typeof c==='string')node.appendChild(document.createTextNode(c));else node.appendChild(c)}return node}
function feeFor(plan,row){return Math.max(3,Math.round(plan*(row.fee_bps||100)/10000))}
function economics(row,plan,share){
  var drop=row.value_if_launches_usd*row.launch_odds*(plan/row.tvl_usd)*share;
  var fees=feeFor(plan,row);
  var net=drop-fees;
  var hold=row.hold_days||30;
  var riskFree=plan*T_BILL*hold/365;
  var gross=row.value_if_launches_usd*(plan/row.tvl_usd)*share;
  var breakeven=gross>0?fees/gross:Infinity;
  return {drop:drop,fees:fees,net:net,riskFree:riskFree,hold:hold,breakeven:breakeven,verdict:verdictFor(net,riskFree)};
}
function verdictFor(net,riskFree){if(net>=2*riskFree)return 'FARM';if(net>riskFree)return 'MARGINAL';return 'SKIP'}
function baseEconomy(row){return economics(row,row.plan_usd||BASE_PLAN,BASE_SHARE)}
function verdict(row){return baseEconomy(row).verdict}
function mult(row){return row.implied_value_usd/row.tvl_usd}
function rows(){
  return DATA.rows.filter(function(r){
    if(state.watchlist&&!r.watchlist)return false;
    if(state.category!=='all'&&(r.category||'Other')!==state.category)return false;
    if(state.chain!=='all'&&r.chains.indexOf(state.chain)<0)return false;
    if(state.verdict!=='all'&&verdict(r)!==state.verdict)return false;
    if(!state.q)return true;
    return (r.name+' '+r.slug+' '+(r.category||'')+' '+chains(r)).toLowerCase().indexOf(state.q.toLowerCase())>=0;
  });
}
function sorted(list){
  var k=state.sort,d=state.dir;
  return list.slice().sort(function(a,b){
    var x,y;
    if(k==='rank'){x=a.rank;y=b.rank}
    else if(k==='name'){x=a.name.toLowerCase();y=b.name.toLowerCase()}
    else if(k==='tvl'){x=a.tvl_usd;y=b.tvl_usd}
    else if(k==='growth'){x=a.change_7d||0;y=b.change_7d||0}
    else if(k==='age'){x=a.age_days||0;y=b.age_days||0}
    else if(k==='mult'){x=mult(a);y=mult(b)}
    else if(k==='implied'){x=a.implied_value_usd;y=b.implied_value_usd}
    else if(k==='cost'){x=baseEconomy(a).net;y=baseEconomy(b).net}
    else{x=a.rank;y=b.rank}
    if(typeof x==='string')return d*x.localeCompare(y);
    return d*(x-y);
  });
}
function sortHeader(key,label,title){return el('th',{title:title||null},el('button',{type:'button',onclick:function(){if(state.sort===key)state.dir=-state.dir;else{state.sort=key;state.dir=key==='name'||key==='rank'?1:-1}render()}},label,state.sort===key?el('span',{'aria-hidden':'true',text:state.dir<0?' v':' ^'}):null))}
function cats(){return Array.from(new Set(DATA.rows.map(function(r){return r.category||'Other'}))).sort()}
function chainList(){return Array.from(new Set(DATA.rows.reduce(function(all,r){return all.concat(r.chains||[])},[]))).sort()}
function verdictCounts(){var out={FARM:0,MARGINAL:0,SKIP:0};DATA.rows.forEach(function(r){out[verdict(r)]+=1});return out}
function controls(){
  var q=el('input',{type:'search',placeholder:'Search protocol, slug, category or chain',value:state.q,'aria-label':'Search',oninput:function(e){state.q=e.target.value;render()}});
  var cat=el('select',{'aria-label':'Category',onchange:function(e){state.category=e.target.value;render()}},el('option',{value:'all',text:'All categories'}));
  cats().forEach(function(c){cat.appendChild(el('option',{value:c,text:c}))});
  cat.value=state.category;
  var chain=el('select',{'aria-label':'Chain',onchange:function(e){state.chain=e.target.value;render()}},el('option',{value:'all',text:'All chains'}));
  chainList().forEach(function(c){chain.appendChild(el('option',{value:c,text:c}))});
  chain.value=state.chain;
  var counts=verdictCounts();
  var tabs=el('div',{class:'tabs',role:'group','aria-label':'Verdict filter'},[['all','All',DATA.rows.length]].concat([['FARM','FARM',counts.FARM],['MARGINAL','MARGINAL',counts.MARGINAL],['SKIP','SKIP',counts.SKIP]]).map(function(t){
    return el('button',{type:'button',class:'tab'+(state.verdict===t[0]?' on':''),'aria-pressed':state.verdict===t[0],onclick:function(){state.verdict=t[0];render()}},t[1],el('span',{text:String(t[2])}));
  }));
  var watch=el('label',{class:'toggle'},el('input',{type:'checkbox',checked:state.watchlist,onchange:function(e){state.watchlist=e.target.checked;render()}}),'Watchlist only');
  return el('div',{class:'toolbar'},el('div',{class:'toolbar-top'},el('div',{class:'field search'},el('label',{for:'q',text:'Search'}),q),el('div',{class:'field'},el('label',{for:'cat',text:'Category'}),cat),el('div',{class:'field'},el('label',{for:'chain',text:'Chain'}),chain),watch,el('span',{class:'count',text:rows().length+' shown / '+DATA.rows.length+' ranked'})),tabs);
}
function verdictBadge(value){return el('span',{class:'badge v-'+value.toLowerCase(),text:value})}
function render(){
  var app=document.getElementById('board');
  app.replaceChildren();
  app.appendChild(el('div',{class:'board-head'},el('div',null,el('h2',{text:'Ranked board'}),el('p',{text:'Fitted implied value, stated P25–P75 range, launch odds and the net cost of farming at the default plan.'})),el('span',{class:'board-tag',text:DATA.rows.length+' protocols · ranks 1–'+DATA.rows.length})));
  app.appendChild(controls());
  var list=sorted(rows());
  if(list.length===0){app.appendChild(el('div',{class:'panel empty'},el('p',{text:'No protocol matches that filter.'})));return}
  var wrap=el('div',{class:'table-wrap'});
  var table=el('table');
  var max=list[0].implied_value_usd||1;
  var head=el('thead',null,el('tr',null,
    sortHeader('rank','#'),
    sortHeader('name','Protocol'),
    sortHeader('tvl','TVL'),
    sortHeader('growth','7d'),
    sortHeader('age','Age'),
    el('th',null,'P25–P75'),
    sortHeader('mult','MULT'),
    sortHeader('implied','Implied'),
    sortHeader('cost','Net cost'),
    el('th',null,'Verdict')
  ));
  var body=el('tbody');
  list.forEach(function(r){
    var e=baseEconomy(r);
    var w=Math.max(2,Math.round(r.implied_value_usd/max*100));
    var netCost=e.fees-e.drop;
    var costText=netCost<=0?'−'+money(-netCost):money(netCost);
    var tr=el('tr',{onclick:function(){openDetail(r)},tabindex:'0',onkeydown:function(e){if(e.key==='Enter')openDetail(r)}});
    tr.appendChild(el('td',{class:'num rank',text:String(r.rank)}));
    tr.appendChild(el('td',null,el('div',{class:'name'},el('b',{text:r.name}),el('span',{class:'sub',text:r.slug+' · '+(r.category||'Other')}))));
    tr.appendChild(el('td',{class:'num',text:money(r.tvl_usd)}));
    tr.appendChild(el('td',{class:'num '+(r.change_7d>=0?'pos':'neg'),text:pct(r.change_7d)}));
    tr.appendChild(el('td',{class:'num',text:age(r.age_days)}));
    tr.appendChild(el('td',{class:'num range',text:money(r.p25_usd)+'–'+money(r.p75_usd)}));
    tr.appendChild(el('td',{class:'num',text:mult(r).toFixed(3)+'×'}));
    tr.appendChild(el('td',null,el('div',{class:'implied'},el('span',{class:'num',text:money(r.implied_value_usd)}),el('span',{class:'bar'},el('i',{style:'width:'+w+'%'})))));
    tr.appendChild(el('td',{class:'num '+(netCost<=0?'pos':'neg'),title:'Fees minus expected drop at the default plan',text:costText}));
    tr.appendChild(el('td',null,verdictBadge(e.verdict)));
    body.appendChild(tr);
  });
  table.append(head,body);
  wrap.appendChild(table);
  app.appendChild(el('div',{class:'panel'},wrap));
}
function pair(label,value){return el('div',{class:'pair'},el('span',{class:'pair-label',text:label}),el('span',{class:'leader','aria-hidden':'true'}),el('b',{class:'num',text:value}))}
function facts(){
  var elx=document.getElementById('facts');
  elx.replaceChildren();
  var oof=DATA.validation.kfold;
  [['Rows',String(DATA.rows.length)],['Watchlist',DATA.watchlist_size+'/'+DATA.watchlist_size],['Traded fits',String(DATA.model.curve.n)],['OOF 5-fold median error',oof.median_abs_pct.toFixed(1)+'% · n='+oof.n],[DATA.model.global_odds_label,(DATA.model.global_odds*100).toFixed(1)+'% ('+DATA.model.global_odds_launched+'/'+DATA.model.global_odds_sample+')'],['Curve slope',DATA.model.curve.slope.toFixed(3)]].forEach(function(p,i){
    elx.appendChild(el('div',{class:'fact'+(i===3?' accent':'')},el('span',{text:p[0]}),el('b',{text:p[1]})));
  });
}
function detailKpis(r){
  var e=baseEconomy(r);
  return el('div',{class:'kpis'},
    el('div',{class:'kpi'},el('span',{text:'Implied value'}),el('b',{text:money(r.implied_value_usd)})),
    el('div',{class:'kpi'},el('span',{text:'P25–P75'}),el('b',{text:money(r.p25_usd)+' – '+money(r.p75_usd)})),
    el('div',{class:'kpi'},el('span',{text:'Launch odds'}),el('b',{text:(r.launch_odds*100).toFixed(1)+'%'})),
    el('div',{class:'kpi'},el('span',{text:'MULT · implied / TVL'}),el('b',{text:mult(r).toFixed(3)+'×'}))
  );
}
function economicsPanel(r){
  var e=baseEconomy(r);
  var panel=el('section',{class:'detail-section economics'},el('div',{class:'section-head'},el('h3',{text:'Farm economics'}),verdictBadge(e.verdict)));
  var top=el('div',{class:'econ-top'},el('div',null,el('span',{class:'eyebrow',text:'Net value of farming'}),el('strong',{class:'econ-net '+(e.net>=0?'pos':'neg'),text:(e.net>=0?'+':'−')+fullMoney(Math.abs(e.net))}),el('p',{class:'econ-sub',text:'Expected drop '+fullMoney(e.drop)+' − fees '+fullMoney(e.fees)+' · '+usd.format(r.plan_usd||BASE_PLAN)+' plan · 7% drop share'})),el('div',{class:'econ-side'},pair('Capital at risk',fullMoney(r.plan_usd||BASE_PLAN)),pair('Fees over '+e.hold+' days',fullMoney(e.fees)),pair('Break-even launch odds',e.breakeven>1?'>100%':(e.breakeven*100).toFixed(1)+'%'),pair('4% T-bill over same horizon',fullMoney(e.riskFree))));
  panel.appendChild(top);
  var matrix=el('div',{class:'matrix'},el('div',{class:'matrix-head'},el('span',{text:'Drop share'}),el('span',{text:usd.format(1000)+' plan'}),el('span',{text:usd.format(3100)+' plan'}),el('span',{text:usd.format(10000)+' plan'})));
  [0.035,0.07,0.14].forEach(function(share){
    var row=el('div',{class:'matrix-row'},el('span',{class:'matrix-label',text:(share*100).toFixed(1)+'%'}));
    [1000,3100,10000].forEach(function(plan){
      var cell=economics(r,plan,share);
      row.appendChild(el('div',{class:'cell v-'+cell.verdict.toLowerCase()},el('b',{text:(cell.net>=0?'+':'−')+money(Math.abs(cell.net))}),el('span',{text:cell.verdict})));
    });
    matrix.appendChild(row);
  });
  panel.appendChild(matrix);
  panel.appendChild(el('p',{class:'note',text:'Expected drop = value if it launches × launch odds × (plan size / TVL) × drop share. Fees scale with plan size and chain cost. Verdict compares net value with twice the 4% T-bill return over the same '+e.hold+'-day wait.'}));
  panel.appendChild(el('p',{class:'note',text:'Typical wait: '+e.hold+' days. T-bill benchmark: '+fullMoney(e.riskFree)+' risk-free. Break-even odds: '+ (e.breakeven>1?'>100%':(e.breakeven*100).toFixed(1)+'%')+'.'}));
  return panel;
}
function launchEvidence(r){
  var basis=r.odds_basis==='category+age peers'?'category + age peers':'the age cohort';
  return el('section',{class:'detail-section'},el('h3',{text:'Launch odds and peer evidence'}),
    el('div',{class:'evidence'},el('div',{class:'evidence-big'},el('b',{text:r.peer_launched+' of '+r.peer_sample}),el('span',{text:(r.category||'category')+' peers in the '+r.cohort+' age cohort have launched a token'})),el('div',{class:'evidence-side'},pair('Basis',basis),pair('Odds used',(r.launch_odds*100).toFixed(1)+'%'),pair('Cohort odds',(r.cohort_odds*100).toFixed(1)+'%'),pair('P25–P75 sensitivity',r.range_sensitivity))),
    el('p',{class:'note',text:'Odds come from '+basis+' and are shrunk toward the snapshot-wide share; the cohort table is shown beside them so the peer count is never confused with a launch guarantee.'}));
}
function comparables(r){
  var comps=DATA.comparables.filter(function(c){return c.slug!==r.slug}).slice(0,6);
  return el('section',{class:'detail-section'},el('h3',{text:'Nearest traded comparables'}),el('div',{class:'pair-list'},comps.map(function(c){return pair(c.name,money(c.mcap_usd))})),el('p',{class:'note',text:'Traded protocols closest by TVL. Each row shows the protocol name, a leader, and its recorded market cap.'}));
}
function stepParts(text){
  var m=text.match(/^(.*?) COST: (.*?) TIME: (.*)$/);
  if(!m)return {title:text,cost:'',time:''};
  return {title:m[1],cost:m[2],time:m[3]};
}
function farmPlan(r){
  return el('section',{class:'detail-section'},el('h3',{text:'Farm plan · '+r.farm_steps.length+' steps'}),el('ol',{class:'steps'},r.farm_steps.map(function(s,i){
    var p=stepParts(s);
    return el('li',null,el('div',{class:'step-title'},el('span',{class:'step-n',text:String(i+1)}),el('b',{text:p.title})),p.cost?el('div',{class:'step-meta'},el('span',{class:'chip',text:'COST '+p.cost}),el('span',{class:'chip time',text:'TIME '+p.time})):null);
  })));
}
function formula(r){
  return 'curve_value = 10^('+DATA.model.curve.intercept.toFixed(3)+' + '+DATA.model.curve.slope.toFixed(3)+' × log10(TVL))\nvalue_if_launches = curve_value × category_premium × momentum\nimplied = value_if_launches × launch_odds\nimplied = '+fullMoney(r.implied_value_usd)+'\nP25–P75 = true residual quartiles × odds interval ('+r.range_sensitivity+')';
}
function openDetail(r){
  var root=document.getElementById('detail-root');
  root.replaceChildren();
  var card=el('div',{class:'detail-card',role:'dialog','aria-modal':'true','aria-labelledby':'detail-title'});
  card.appendChild(el('div',{class:'detail-head'},el('div',null,el('span',{class:'detail-kicker',text:'#'+r.rank+' · '+(r.category||'Other')+' · '+chains(r)}),el('h2',{id:'detail-title',text:r.name}),el('span',{class:'sub',text:r.slug})),el('button',{class:'close',type:'button',text:'Close',onclick:function(){root.replaceChildren()}})));
  card.appendChild(detailKpis(r));
  card.appendChild(economicsPanel(r));
  card.appendChild(launchEvidence(r));
  card.appendChild(comparables(r));
  card.appendChild(farmPlan(r));
  card.appendChild(el('section',{class:'detail-section'},el('h3',{text:'Value breakdown'}),el('pre',{class:'formula',text:formula(r)})));
  var shade=el('div',{class:'detail',onclick:function(e){if(e.target===shade)root.replaceChildren()}},card);
  root.appendChild(shade);
}
function validationPanel(){
  var p=document.getElementById('validation-panel');
  var k=DATA.validation.kfold;
  p.replaceChildren(el('div',{class:'section-head'},el('h2',{text:'Out-of-sample validation'}),el('span',{class:'board-tag',text:'5-fold · median error '+k.median_abs_pct.toFixed(1)+'%'})),
    el('div',{class:'mini-grid'},[['5-fold OOF median error',k.median_abs_pct.toFixed(1)+'%'],['5-fold OOF within P25–P75',k.within_interval.toFixed(1)+'%'],['LOO median miss',DATA.validation.loo.median_abs_pct.toFixed(1)+'%'],['LOO within P25–P75',DATA.validation.loo.within_interval.toFixed(1)+'%'],['By-time median miss',DATA.validation.by_time.median_abs_pct.toFixed(1)+'%'],['By-time within P25–P75',DATA.validation.by_time.within_interval.toFixed(1)+'%'],['Older fit',String(DATA.validation.by_time.train_n)],['Newer test',String(DATA.validation.by_time.test_n)]].map(function(x){return el('div',{class:'mini'},el('span',{text:x[0]}),el('b',{text:x[1]}))})),
    el('p',{text:'Five folds refit the curve on four-fifths of the traded protocols and score the held-out fifth; folds follow slug order so the number is deterministic. Leave-one-out refits on every other traded protocol. The by-time split fits only protocols listed before 2024-01-01 and tests the newer ones. Miss is absolute percentage error; range calibration is the share whose realised market cap fell inside the P25–P75 band.'}));
}
function auditPanel(){
  var p=document.getElementById('audit-panel');
  p.replaceChildren(el('h2',{text:'Audit seal'}),el('pre',{class:'seal',text:DATA.audit.seal}),el('p',{text:'The board is deterministic: the same snapshot and model always write the same rows. Ages come only from snapshot.as_of. Farm economics are computed from each row, never from the clock.'}));
}
document.getElementById('as-of').textContent='as_of '+DATA.as_of;
document.getElementById('model-name').textContent=DATA.model_version;
document.getElementById('row-count').textContent=DATA.rows.length+' rows';
facts();validationPanel();auditPanel();render();
})();
