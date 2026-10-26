import './styles.css';
import './planner.css';
import './chat.css';
import { plannerScene } from './planner-scene.js';
import { catalogDetail, catalogExamples, type CatalogKey } from './catalog.js';
import { chatMarkup, chatChoices } from './chat.js';
import { relationships, occasions, interests, deadlines, emptyBrief, validStep, curate, readSaved, briefText, type Brief, type SavedBrief } from './experience.js';
const $ = <T extends Element = HTMLElement>(q:string) => document.querySelector<T>(q)!;
const escape = (s:string) => s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const money = (n:number) => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(n);
const dialog=$<HTMLDialogElement>('#atelier'); const content=$('#dialog-content');
const key='gift-signal:briefs:v1';
let saved:SavedBrief[]=[];
try { saved=readSaved(localStorage.getItem(key)); } catch { /* Storage may be unavailable in private browsing. */ }
let brief:Brief=emptyBrief(); let step=0; let currentConcept=''; let returnFocus:HTMLElement|null=null;
const updateCount=()=>{$('#saved-count').textContent=String(saved.length);}; updateCount();
$('#year').textContent=String(new Date().getFullYear());
let toastTimer:ReturnType<typeof setTimeout>;
function toast(message:string){$('#toast').textContent=message; $('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),4500);}
function open(){ if(dialog.open) return; returnFocus=document.activeElement as HTMLElement;dialog.showModal();document.body.classList.add('dialog-open'); }
function close(){dialog.close();}
dialog.addEventListener('close',()=>{document.body.classList.remove('dialog-open');returnFocus?.focus();});
$('#close-dialog').addEventListener('click',close);
dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)close();}});
function focusTitle(){requestAnimationFrame(()=>{$('#dialog-title').focus();dialog.scrollTop=0;});}
function begin(interest?:string){
 const opening=interest?`I’m looking for something connected to ${interest}.`:'I’m here to help you find something thoughtful. Who or what are we shopping for?';
 content.innerHTML=chatMarkup([{speaker:'guide',text:opening}]);open();focusTitle();bindChat();
}
function showChatResults(message:string){
 content.innerHTML=chatMarkup([{speaker:'guide',text:'Tell me who you are shopping for, the budget, and the occasion.'},{speaker:'you',text:message}],chatChoices(message));open();focusTitle();bindChat();
}
function showProduct(id:CatalogKey){
 if(!catalogExamples[id])return;
 content.innerHTML=catalogDetail(id);open();focusTitle();
 const zoom=$<HTMLButtonElement>('.product-zoom');
 zoom.addEventListener('click',()=>{const expanded=zoom.classList.toggle('expanded');zoom.setAttribute('aria-pressed',String(expanded));zoom.setAttribute('aria-label',expanded?'Reduce product photo':'Enlarge product photo');});
 document.querySelectorAll<HTMLElement>('[data-photo]').forEach(button=>button.addEventListener('click',()=>{
  const i=Number(button.dataset.photo);const photo=$<HTMLImageElement>('#product-main-image');photo.src=catalogExamples[id].images[i]!;photo.alt=catalogExamples[id].title+' — catalog photograph '+(i+1);
  document.querySelectorAll('[data-photo]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));
 }));
 $('#catalog-to-brief').addEventListener('click',()=>begin());
 $('#catalog-to-private-request')?.addEventListener('click',()=>renderPrivateRequest(id));
}
function renderPrivateRequest(id:CatalogKey){
 const product=catalogExamples[id];
 if(!('requestOnly' in product)||!product.requestOnly){begin(`I want a private acquisition request for ${product.title}.`);return;}
 content.innerHTML=`<section class="private-request" aria-labelledby="dialog-title"><p class="eyebrow">PRIVATE ACQUISITION / REQUEST DETAILS</p><h2 id="dialog-title" tabindex="-1">Let’s confirm the <em>important details.</em></h2><p class="dialog-description">For ${escape(product.title)}, we check the selected configuration, price, fulfillment, taxes, and delivery before payment.</p><form id="private-request-form"><label class="field-label" for="private-name">Your name or business</label><input id="private-name" name="name" maxlength="100" autocomplete="organization" required/><label class="field-label" for="private-quantity">Quantity</label><input id="private-quantity" name="quantity" type="number" min="1" max="999" value="1" required/><label class="field-label" for="private-destination">Delivery city and country</label><input id="private-destination" name="destination" maxlength="120" autocomplete="shipping address-level2" required/><label class="field-label" for="private-date">Needed by <span>(optional)</span></label><input id="private-date" name="neededBy" type="date"/><label class="field-label" for="private-notes">Configuration or delivery notes <span>(optional)</span></label><textarea id="private-notes" name="notes" maxlength="500" rows="4" placeholder="For example: installation needs, selected configuration, access requirements, or event details"></textarea><p id="private-request-error" class="field-error" role="alert"></p><div class="form-actions"><button class="text-button" id="private-request-back" type="button">← Back to item</button><button class="button button-dark" type="submit">Create request brief ↗</button></div></form></section>`;
 $('#private-request-back').addEventListener('click',()=>showProduct(id));
 $('#private-request-form').addEventListener('submit',event=>{event.preventDefault();const form=new FormData(event.currentTarget as HTMLFormElement);const name=String(form.get('name')??'').trim();const quantity=Number(form.get('quantity'));const destination=String(form.get('destination')??'').trim();if(!name||!destination||!Number.isInteger(quantity)||quantity<1||quantity>999){$('#private-request-error').textContent='Add your name or business, a quantity, and a delivery city and country.';return;}const neededBy=String(form.get('neededBy')??'');const notes=String(form.get('notes')??'').trim();const lines=['THE GIFT SIGNAL — PRIVATE ACQUISITION REQUEST','Not an order, invoice, payment request, stock reservation, or delivery promise.','',`Item: ${product.title}`,`Listed price reference: ${product.price}`,`Selected option: ${product.options}`,`Requested by: ${name}`,`Quantity: ${quantity}`,`Destination: ${destination}`,`Needed by: ${neededBy||'Not specified'}`,`Notes: ${notes||'None provided'}`,'','Next: verify the exact configuration, current variant price, availability, freight, tax, and delivery before sending any payment request.'].join('\n');content.innerHTML=`<section class="private-request"><p class="eyebrow">PRIVATE ACQUISITION / REQUEST READY</p><h2 id="dialog-title" tabindex="-1">A clear request.<br><em>Ready for verification.</em></h2><div class="preview-notice"><strong>${escape(product.title)}</strong><br>${quantity} requested · ${escape(destination)}<br>Price, availability, fulfillment, taxes, and delivery still require confirmation.</div><p class="dialog-description">Keep this request brief for the quote workflow. An approved itemized quote is the next step before checkout.</p><button class="button button-dark" id="download-private-request">Download request brief ↓</button><button class="text-button" id="private-request-restart">Start another private request</button></section>`;$('#download-private-request').addEventListener('click',()=>{const url=URL.createObjectURL(new Blob([lines],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='the-gift-signal-private-acquisition-request.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Your private acquisition request is ready to keep.');});$('#private-request-restart').addEventListener('click',()=>renderPrivateRequest(id));focusTitle();});focusTitle();
}
function bindChat(){
 const form=$<HTMLFormElement>('#chat-form');
 const submit=(message:string)=>{const clean=message.trim();if(!clean)return;content.innerHTML=chatMarkup([{speaker:'guide',text:'I’m here to help you find something thoughtful. Who or what are we shopping for?'},{speaker:'you',text:clean}],chatChoices(clean));focusTitle();bindChat();};
 form.addEventListener('submit',event=>{event.preventDefault();submit($<HTMLInputElement>('#chat-input').value);});
 document.querySelectorAll<HTMLElement>('[data-chat]').forEach(button=>button.addEventListener('click',()=>submit(button.dataset.chat??'')));
 document.querySelectorAll<HTMLElement>('.gift-chat [data-product]').forEach(button=>button.addEventListener('click',()=>showProduct(button.dataset.product as CatalogKey)));
}
document.querySelectorAll<HTMLElement>('[data-begin]').forEach(el=>el.addEventListener('click',()=>begin()));
document.querySelectorAll<HTMLElement>('.intent-guide-grid [data-chat]').forEach(el=>el.addEventListener('click',()=>showChatResults(el.dataset.chat??'')));
document.querySelectorAll<HTMLElement>('[data-edit]').forEach(el=>el.addEventListener('click',()=>begin(el.dataset.edit)));
document.querySelectorAll<HTMLElement>('[data-occasion]').forEach(el=>el.addEventListener('click',()=>{begin();brief.occasion=el.dataset.occasion!;}));
document.querySelectorAll<HTMLElement>('[data-product]').forEach(el=>el.addEventListener('click',()=>showProduct(el.dataset.product as CatalogKey)));
$('#open-saved').addEventListener('click',()=>{renderSaved();open();});
const labels=['Their world','The occasion','The little things','Your budget','The moment'];
const choices=(values:readonly string[],selected:string|string[],name:string,multi=false)=>`<div class="choices">${values.map(v=>`<label class="choice"><input type="${multi?'checkbox':'radio'}" name="${name}" value="${escape(v)}" ${(Array.isArray(selected)?selected.includes(v):selected===v)?'checked':''}/><span>${escape(v)}</span></label>`).join('')}</div>`;
function framePlanner(stage:number){
 const pane=content.innerHTML;
 content.innerHTML=plannerScene(stage,escape(brief.recipient))+ '<div class="conversation-pane">'+pane+'</div>';
 const replay=$<HTMLButtonElement>('.scene-replay');
 replay.addEventListener('click',()=>{const playing=$('.planner-art').classList.toggle('is-replaying');replay.setAttribute('aria-pressed',String(playing));replay.textContent=playing?'Pause the composition Ⅱ':'Replay the composition ↻';});
}
function renderStep(){
 const titles=['Who are we thinking of?',`What’s the occasion for ${escape(brief.recipient)}?`,'What lights them up?','What feels comfortable to spend?','When would you love it to arrive?'];
 const subtitles=['Let’s start with someone you know. A first name or nickname is plenty.','A milestone, a thank-you, or simply because. Every reason counts.','Pick a few things that feel like their world. We’ll use these to shape the ideas.','Choose a limit that works for you. Our concept estimates exclude shipping and tax.','Choose your preferred timing, then add a few words in your own voice. Delivery still needs to be confirmed.'];
 let fields='';
 if(step===0)fields=`<label class="field-label" for="recipient">Their first name or nickname</label><input id="recipient" name="recipient" maxlength="60" autocomplete="off" placeholder="Someone special" value="${escape(brief.recipient)}" required/><fieldset><legend>They are my…</legend>${choices(relationships,brief.relationship,'relationship')}</fieldset>`;
 if(step===1)fields=`<fieldset><legend class="sr-only">Occasion</legend>${choices(occasions,brief.occasion,'occasion')}</fieldset>`;
 if(step===2)fields=`<fieldset><legend class="sr-only">Interests</legend>${choices(interests,brief.interests,'interests',true)}</fieldset>`;
 if(step===3)fields=`<label class="field-label" for="budget">Maximum product budget · USD</label><div class="budget-input"><span>$</span><input id="budget" name="budget" type="number" min="25" max="5000" step="1" value="${brief.budget}" required/></div><div class="budget-presets">${[75,150,250,500].map(v=>`<button type="button" data-budget="${v}" class="chip">${money(v)}</button>`).join('')}</div><p class="field-hint">We keep every concept within this amount. You can change it later.</p>`;
 if(step===4)fields=`<fieldset><legend class="sr-only">Preferred timing</legend>${choices(deadlines,brief.deadline,'deadline')}</fieldset><label class="field-label" for="note">A personal note <span>(optional)</span></label><textarea id="note" name="note" maxlength="280" rows="3" placeholder="A few words that only you would say…">${escape(brief.note)}</textarea><p class="field-hint">Up to 280 characters. Saved only with your brief.</p>`;
 content.innerHTML=`<div class="step-track" aria-label="Step ${step+1} of 5">${labels.map((l,i)=>`<span class="${i===step?'active':i<step?'complete':''}" ${i===step?'aria-current="step"':''}><b>0${i+1}</b><small>${l}</small></span>`).join('')}</div><p class="eyebrow">YOUR SIGNAL / 0${step+1}</p><h2 id="dialog-title" tabindex="-1">${titles[step]}</h2><p class="dialog-description">${subtitles[step]}</p><form id="brief-form" novalidate>${fields}<p id="field-error" class="field-error" role="alert"></p><div class="form-actions">${step>0?'<button class="text-button" id="back" type="button">← Back</button>':'<span class="field-hint">A little attention goes a long way.</span>'}<button class="button button-dark" type="submit">${step===4?'Reveal their signal':'Continue'} <span aria-hidden="true">↗</span></button></div></form>`;
 framePlanner(step);
 const answers=[brief.recipient,brief.occasion,brief.interests.join(', '),money(brief.budget)];
 const trail=document.createElement('div');trail.className='conversation-trail';trail.setAttribute('aria-label','Your answers — select to edit');
 trail.innerHTML=answers.slice(0,step).map((answer,i)=>`<button type="button" data-answer="${i}" aria-label="Edit ${labels[i]}: ${escape(answer)}">${escape(answer)} <span aria-hidden="true">↗</span></button>`).join('');
 $('.step-track').after(trail);
 const form=$<HTMLFormElement>('#brief-form');
 function capture(){const d=new FormData(form);if(step===0){brief.recipient=String(d.get('recipient')??'').trim();brief.relationship=String(d.get('relationship')??'');}if(step===1)brief.occasion=String(d.get('occasion')??'');if(step===2)brief.interests=d.getAll('interests').map(String);if(step===3)brief.budget=Number(d.get('budget'));if(step===4){brief.deadline=String(d.get('deadline')??'');brief.note=String(d.get('note')??'');}}
 document.querySelectorAll<HTMLElement>('[data-answer]').forEach(el=>el.addEventListener('click',()=>{capture();step=Number(el.dataset.answer);renderStep();}));
 $('#back')?.addEventListener('click',()=>{capture();step--;renderStep();});
 document.querySelectorAll<HTMLElement>('[data-budget]').forEach(el=>el.addEventListener('click',()=>{$<HTMLInputElement>('#budget').value=el.dataset.budget!;}));
 form.addEventListener('submit',e=>{e.preventDefault();capture();if(!validStep(brief,step)){const errors=['Add a name and choose your relationship.','Choose an occasion.','Choose at least one interest.','Enter a budget from $25 to $5,000.','Choose your preferred timing.'];$('#field-error').textContent=errors[step];return;}if(step<4){step++;renderStep();}else renderResults();});focusTitle();
}
function renderResults(){
 const results=curate(brief);
 content.innerHTML=`<p class="eyebrow">A SIGNAL FOR ${escape(brief.recipient.toUpperCase())}</p><h2 id="dialog-title" tabindex="-1">A little more <em>them.</em></h2><p class="dialog-description">${escape(brief.occasion)} · Up to ${money(brief.budget)} · ${escape(brief.deadline)}</p><div class="preview-notice">Concept selection · Planning estimates, not live products or offers.</div><div class="result-list">${results.map((c,i)=>`<article class="result-card"><div class="result-heading"><p class="eyebrow">${i===0?'YOUR CLOSEST SIGNAL':c.category}</p><span>${money(c.total)} <small>est.</small></span></div><h3>${c.title}</h3><p>${c.description}</p><ul>${c.items.map(item=>`<li><span>${item.name}</span><span>${money(item.estimate)}</span></li>`).join('')}</ul><div class="fit-note"><span>WHY THIS DIRECTION</span><p>${c.matches.length?`Reflects their interest in ${escape(c.matches.join(' and ').toLowerCase())}.`:'An alternative direction to explore.'} ${money(brief.budget-c.total)} remains in your product budget.</p></div><button class="button button-dark" data-select="${c.id}">Make this their brief <span aria-hidden="true">↗</span></button></article>`).join('')||'<div class="empty-state"><span class="mark">✳</span><h3>A little room to reconsider.</h3><p>No concept fits this budget yet. Try $30 or more, or explore a different direction.</p></div>'}</div><button class="text-button" id="edit-brief">← Refine your brief</button>`;
 framePlanner(5);
 document.querySelectorAll<HTMLElement>('[data-select]').forEach(el=>el.addEventListener('click',()=>{currentConcept=el.dataset.select!;renderReview();}));$('#edit-brief').addEventListener('click',()=>{step=3;renderStep();});focusTitle();
}
function renderReview(){const c=curate(brief).find(x=>x.id===currentConcept);if(!c){renderResults();return;}
 content.innerHTML=`<p class="eyebrow">THE FINISHING TOUCH</p><h2 id="dialog-title" tabindex="-1">For ${escape(brief.recipient)}.<br><em>From the heart.</em></h2><div class="review-paper"><span class="mark" aria-hidden="true">✳</span><p class="eyebrow">${c.category}</p><h3>${c.title}</h3><p>${escape(brief.occasion)} · ${escape(brief.relationship)}</p><ul>${c.items.map(i=>`<li><span>${i.name}</span><span>${money(i.estimate)}</span></li>`).join('')}</ul><div class="review-total"><span>Concept estimate</span><strong>${money(c.total)} USD</strong></div><p class="field-hint">Excludes shipping and tax. Products, prices and delivery are unconfirmed.</p><label class="field-label" for="final-note">Your personal note</label><textarea id="final-note" maxlength="280" rows="3" placeholder="Make it personal…">${escape(brief.note)}</textarea></div><p class="field-hint">Save your plan in this browser or download a copy. This does not place an order or send a message.</p><div class="review-actions"><button class="button button-dark" id="save-brief">Save gift brief <span aria-hidden="true">↗</span></button><button class="button button-outline-dark" id="download-brief">Download brief ↓</button></div><button id="back-results" class="text-button">← See other directions</button>`;
 framePlanner(5);
 $('#final-note').addEventListener('input',()=>{brief.note=$<HTMLTextAreaElement>('#final-note').value;});
 $('#save-brief').addEventListener('click',()=>{const entry={id:crypto.randomUUID(),savedAt:new Date().toISOString(),brief:{...brief,interests:[...brief.interests]},conceptId:currentConcept};const next=[entry,...saved.filter(s=>!(s.conceptId===currentConcept&&JSON.stringify(s.brief)===JSON.stringify(brief)))].slice(0,20);try{localStorage.setItem(key,JSON.stringify(next));saved=next;updateCount();toast('Your gift brief is saved in this browser.');}catch{toast('Browser storage is unavailable. Download your brief to keep it.');}});
 $('#download-brief').addEventListener('click',()=>{const url=URL.createObjectURL(new Blob([briefText(brief,currentConcept)],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='the-gift-signal-brief.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Your gift brief is ready to keep.');});
 $('#back-results').addEventListener('click',renderResults);focusTitle();
}
function renderSaved(){content.innerHTML=`<p class="eyebrow">A LITTLE SOMETHING TO RETURN TO</p><h2 id="dialog-title" tabindex="-1">Your saved <em>signals.</em></h2><p class="dialog-description">Private to this browser. Download a brief to keep a separate copy.</p>${saved.length?`<div class="saved-list">${saved.map(s=>`<article><div><small>${escape(s.brief.occasion)} · ${new Date(s.savedAt).toLocaleDateString()}</small><h3>For ${escape(s.brief.recipient)}</h3><p>${money(s.brief.budget)} maximum · ${escape(s.brief.deadline)}</p></div><div><button class="text-button" data-open="${escape(s.id)}">Open brief ↗</button><button class="delete-button" data-delete="${escape(s.id)}" aria-label="Delete brief for ${escape(s.brief.recipient)}">Delete</button></div></article>`).join('')}</div>`:'<div class="empty-state"><span class="mark">✳</span><h3>A thoughtful idea belongs here.</h3><p>Create your first brief and save it for later.</p></div>'}<button class="button button-dark" id="new-brief">Create a gift brief ↗</button>`;
 document.querySelectorAll<HTMLElement>('[data-open]').forEach(el=>el.addEventListener('click',()=>{const s=saved.find(x=>x.id===el.dataset.open)!;brief={...s.brief,interests:[...s.brief.interests]};currentConcept=s.conceptId;renderReview();}));
 document.querySelectorAll<HTMLElement>('[data-delete]').forEach(el=>el.addEventListener('click',()=>{const next=saved.filter(x=>x.id!==el.dataset.delete);try{localStorage.setItem(key,JSON.stringify(next));saved=next;updateCount();renderSaved();toast('Brief removed from this browser.');}catch{toast('Unable to update browser storage.');}}));$('#new-brief').addEventListener('click',()=>begin());focusTitle();
}
const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
const reveal=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in-view');reveal.unobserve(e.target);}}),{threshold:0.08});
document.querySelectorAll('.reveal').forEach(el=>reveal.observe(el));
let frame=0;
window.addEventListener('scroll',()=>{if(reduced.matches||frame)return;frame=requestAnimationFrame(()=>{const p=Math.min(window.scrollY/window.innerHeight,1);document.documentElement.style.setProperty('--hero-shift',`${p*65}px`);document.documentElement.style.setProperty('--hero-scale',String(1+p*.045));frame=0;});},{passive:true});

const storySection = document.querySelector('#anatomy')!;
const loadStory = new IntersectionObserver(entries => { if(entries.some(e=>e.isIntersecting)){loadStory.disconnect();import('./anatomy.js').then(m=>m.mountAnatomy()).catch(()=>storySection.classList.add('story-fallback'));} }, {rootMargin:'900px'});
loadStory.observe(storySection);
