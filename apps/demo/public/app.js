const $=q=>document.querySelector(q);
const money=(n,c='USD')=>new Intl.NumberFormat('en-US',{style:'currency',currency:c}).format(n);
document.querySelectorAll('[data-example]').forEach(b=>b.addEventListener('click',()=>{$('#prompt').value=b.dataset.example;}));

async function json(url,options){const r=await fetch(url,options);const p=await r.json();if(!r.ok)throw new Error(p.error||String(r.status));return p;}
async function refreshMetrics(){const m=await json('/api/metrics');$('#baseline').textContent=m.baselineClicks;$('#connector').textContent=m.connectorClicks;$('#removed').textContent=m.removedClicks;$('#reduction').textContent=m.reductionPercent+'%';}
$('#search').addEventListener('click',async()=>{
  const message=$('#prompt').value.trim(); if(!message)return;
  $('#results').innerHTML='<p class="muted">Searching connected companies…</p>'; $('#review').hidden=true;
  try{
    const data=await json('/api/search',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message})});
    $('#mode').textContent=data.mode==='MUSE'?'Muse interpreted this request via Meta Model API.':'Deterministic fallback mode — add Meta Model API env vars to make Muse live.';
    $('#results').innerHTML=data.results.length?data.results.map((r,i)=>`
      <article class="offer">
        <div><span class="rank">0${i+1}</span><span class="score">${r.score} signal</span></div>
        <h2>${r.offer.title}</h2>
        <p>${r.offer.summary||''}</p>
        <div class="offer-meta"><strong>${money(r.offer.price,r.offer.currency)}</strong><span>${r.offer.companyId}</span><span>${r.offer.availability}</span></div>
        <p class="muted">${r.reasons.join(' · ')}</p>
        <button class="primary" data-draft="${r.offer.offerId}">Prepare this action →</button>
      </article>`).join(''):'<p>No actionable connected offer matched.</p>';
    document.querySelectorAll('[data-draft]').forEach(b=>b.addEventListener('click',()=>prepare(b.dataset.draft)));
    refreshMetrics();
  }catch(e){$('#results').innerHTML='<p class="error">'+e.message+'</p>';}
});
async function prepare(offerId){
  const data=await json('/api/draft',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({offerId,quantity:1})});
  const d=data.draft;
  $('#review').hidden=false;
  $('#review').innerHTML=`<p class="kicker">REVIEW BEFORE COMMIT</p><h2>${d.offer.title}</h2><p>${d.offer.summary||''}</p><div class="review-total"><span>Exact demo total</span><strong>${money(d.total,d.offer.currency)}</strong></div><p class="muted">Live deployments revalidate price, availability, configuration and policy before commit.</p><button class="approve" id="approve">Approve exact action →</button><p class="muted">This competition demo does not charge money.</p>`;
  $('#review').scrollIntoView({behavior:'smooth'});
  $('#approve').addEventListener('click',()=>approve(d.draftId));
  refreshMetrics();
}
async function approve(draftId){
  const data=await json('/api/approve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({draftId,approved:true})});
  $('#review').innerHTML=`<p class="kicker">CONFIRMED / DEMO</p><h2>From intent to action.</h2><p>${data.transaction.message}</p><div class="review-total"><span>Provider reference</span><strong>${data.transaction.providerReference}</strong></div><p>${data.fulfillment.message}</p><p class="muted">Next production step: asynchronous provider/payment webhooks advance the real order or booking lifecycle.</p>`;
  refreshMetrics();
}
refreshMetrics();
