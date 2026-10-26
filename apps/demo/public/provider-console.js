const $=s=>document.querySelector(s);
async function json(url,options){
  const r=await fetch(url,options);
  const p=await r.json().catch(()=>({error:'invalid_json'}));
  if(!r.ok) throw new Error(p.error||String(r.status));
  return p;
}
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const defaultSyncKind=p=>p==='etsy'?'listings':p==='walmart'?'catalog':'inventory';

async function load(){
  $('#providers').innerHTML='<p>Loading provider state…</p>';
  try{
    const status=await json('/operator/status');
    if(!status.configured){
      $('#config').hidden=false;
      $('#config').textContent='Operator API is not configured. Set BUSINESS_API_BASE_URL, BUSINESS_API_ORG_ID, BUSINESS_API_CREDENTIAL_ID, and BUSINESS_API_KEY on the Render service.';
      $('#providers').innerHTML='';
      return;
    }
    $('#config').hidden=true;
    const [{providers},{connections}]=await Promise.all([
      json('/operator/providers'),
      json('/operator/connections')
    ]);
    const byProvider=new Map(connections.map(c=>[c.provider,c]));
    const cards=providers.map(p=>({provider:p,connection:byProvider.get(p.provider)}));
    $('#connected').textContent=cards.filter(x=>x.connection&&x.connection.health!=='REVOKED').length;
    $('#healthy').textContent=cards.filter(x=>x.connection?.health==='HEALTHY').length;
    $('#attention').textContent=cards.filter(x=>['TOKEN_EXPIRING','REAUTH_REQUIRED','ERROR'].includes(x.connection?.health)).length;
    $('#not-connected').textContent=cards.filter(x=>!x.connection).length;
    $('#providers').innerHTML=cards.map(({provider:p,connection:c})=>{
      const connected=Boolean(c)&&c.health!=='REVOKED';
      const blocked=[...(p.partnershipRequired||[]),...(c?.partnershipRequired||[])];
      return `<article class="card">
        <span class="health">${esc(c?.health||'NOT_CONNECTED')}</span>
        <h3>${esc(p.displayName)}</h3>
        <p class="detail">${esc(c?.lastSyncError?('Sync needs attention: '+c.lastSyncError):c?.lastSyncAt?('Last synchronized '+c.lastSyncAt):connected?'Connected; initial synchronization has not completed.':'Not connected.')}</p>
        <div class="meta">
          <span class="pill">${esc(p.providerClass)}</span>
          ${c?.externalAccountId?`<span class="pill">${esc(c.externalAccountId)}</span>`:''}
        </div>
        <div class="caps">${(c?.grantedCapabilities||[]).map(x=>`<span class="pill">${esc(x)}</span>`).join('')}${blocked.map(x=>`<span class="pill">blocked: ${esc(x)}</span>`).join('')}</div>
        <div class="actions">
          ${connected?`<button data-sync="${esc(p.provider)}" data-account="${esc(c.externalAccountId)}">Sync</button>
          <button class="secondary" data-readiness="${esc(p.provider)}" data-account="${esc(c.externalAccountId)}">Readiness</button>
          <button class="secondary" data-rekey="${esc(p.provider)}" data-account="${esc(c.externalAccountId)}">Rekey</button>
          <button class="danger" data-revoke="${esc(p.provider)}" data-account="${esc(c.externalAccountId)}">Revoke</button>`:''}
        </div>
        <pre class="status-box" data-status="${esc(p.provider)}" hidden></pre>
      </article>`;
    }).join('');
    bind();
  }catch(e){
    $('#providers').innerHTML='<p class="error">'+esc(e.message)+'</p>';
  }
}

function show(provider,value,ok=true){
  const box=document.querySelector('[data-status="'+CSS.escape(provider)+'"]');
  if(!box)return;
  box.hidden=false;
  box.className='status-box '+(ok?'ok':'error');
  box.textContent=typeof value==='string'?value:JSON.stringify(value,null,2);
}
async function postRuntime(provider,account,action,body={}){
  show(provider,'Working…');
  try{
    const out=await json('/operator/runtime/'+encodeURIComponent(provider)+'/'+encodeURIComponent(account)+'/'+action,{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)
    });
    show(provider,out,true);
    if(action==='revoke') await load();
  }catch(e){show(provider,e.message,false);}
}
function bind(){
  document.querySelectorAll('[data-sync]').forEach(b=>b.onclick=()=>postRuntime(b.dataset.sync,b.dataset.account,'sync',{kind:defaultSyncKind(b.dataset.sync)}));
  document.querySelectorAll('[data-rekey]').forEach(b=>b.onclick=()=>postRuntime(b.dataset.rekey,b.dataset.account,'rekey'));
  document.querySelectorAll('[data-revoke]').forEach(b=>b.onclick=()=>postRuntime(b.dataset.revoke,b.dataset.account,'revoke'));
  document.querySelectorAll('[data-readiness]').forEach(b=>b.onclick=async()=>{
    const p=b.dataset.readiness,a=b.dataset.account;show(p,'Loading readiness…');
    try{show(p,await json('/operator/readiness/'+encodeURIComponent(p)+'/'+encodeURIComponent(a)),true);}
    catch(e){show(p,e.message,false);}
  });
}
$('#refresh').onclick=load;
$('#rekey-batch').onclick=async()=>{
  const limit=Number($('#batch-limit').value||100);
  const box=$('#batch-result');box.hidden=false;box.textContent='Running…';
  try{
    const out=await json('/operator/rekey-batch',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({limit})});
    box.className='status-box ok';box.textContent=JSON.stringify(out,null,2);
  }catch(e){box.className='status-box error';box.textContent=e.message;}
};
load();