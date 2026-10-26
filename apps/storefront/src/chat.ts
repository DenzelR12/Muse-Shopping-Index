import { catalogExamples, directCatalog, type CatalogKey } from './catalog.js';

const escape=(value:string)=>value.replace(/[&<>"']/g,char=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char]!));
export type ChatChoice={key:CatalogKey;why:string};

export function chatChoices(message:string):ChatChoice[]{
 const query=message.toLowerCase();
 const numbers=[...query.matchAll(/\$?([0-9][0-9,]*)/g)].map(match=>Number(match[1]?.replaceAll(',',''))).filter(Number.isFinite);
 const maxBudget=/under|up to|max|budget|less than/.test(query)?numbers[0]:undefined;
 const terms=query.split(/[^a-z0-9]+/).filter(term=>term.length>2);
 const scored=directCatalog.map(([key,product])=>{
  if(maxBudget!==undefined&&product.priceValue>maxBudget)return {key:key as CatalogKey,product,score:-100};
  const context=[product.title,product.brand,product.category,product.productType,...product.recipientFit,...product.occasionFit,...product.intents].join(' ').toLowerCase();
  let score=terms.reduce((total,term)=>total+(context.includes(term)?3:0),0);
  if(/client/.test(query)&&product.recipientFit.includes('client'))score+=7;
  if(/coworker|colleague|office/.test(query)&&product.recipientFit.includes('coworker'))score+=7;
  if(/travel|trip|luggage|bag/.test(query)&&product.intents.some(value=>/travel|luggage|bag/.test(value)))score+=7;
  if(/gamer|gaming/.test(query)&&product.recipientFit.includes('gamer'))score+=7;
  if(/luxury|premium/.test(query)&&product.priceValue>=250)score+=5;
  if(/holiday|christmas|hanukkah|diwali/.test(query)&&product.occasionFit.includes('holiday'))score+=6;
  return {key:key as CatalogKey,product,score};
 }).filter(item=>item.score>=0).sort((a,b)=>b.score-a.score||a.product.priceValue-b.product.priceValue).slice(0,3);
 return scored.map(({key,product})=>({key,why:product.context}));
}

const card=({key,why}:ChatChoice)=>{
 const item=catalogExamples[key]!;
 return `<article class="chat-product"><img src="${item.images[0]}" alt="${item.title} product photograph" width="180" height="180"/><div><p class="eyebrow">${item.brand} · IN STOCK WHEN CHECKED</p><h3>${item.title}</h3><p>${item.price} · ${item.options}</p><p><strong>Why this fits:</strong> ${why}</p><p class="field-hint">${item.evidence}</p><a class="button button-dark" href="${item.cartUrl}" target="_blank" rel="noopener">Add to Shopify cart ↗</a></div></article>`;
};

export function chatMarkup(messages:Array<{speaker:'guide'|'you';text:string}>,result?:ChatChoice[]){
 return `<section class="gift-chat" aria-labelledby="dialog-title"><p class="eyebrow">THE GIFT CONCIERGE</p><h2 id="dialog-title" tabindex="-1">Who are you shopping for?</h2><p class="dialog-description">Tell me the person, your budget, and the occasion. I’ll show three real products with images and direct cart choices.</p><div id="chat-log" class="chat-log" aria-live="polite">${messages.map(message=>`<p class="chat-message ${message.speaker}"><span>${message.speaker==='guide'?'THE GIFT SIGNAL':'YOU'}</span>${escape(message.text)}</p>`).join('')}${result?`<div class="chat-results"><p class="chat-message guide"><span>THE GIFT SIGNAL</span>These are the three closest verified options. Shopify confirms final stock, delivery, tax and return eligibility before payment.</p>${result.map(card).join('')}</div>`:''}</div><form id="chat-form" class="chat-compose"><label class="sr-only" for="chat-input">Recipient, budget and occasion</label><input id="chat-input" maxlength="280" autocomplete="off" placeholder="A client, under $100, for a holiday thank-you" required/><button class="button button-dark" type="submit">Show 3 gifts ↗</button></form><div class="chat-suggestions" aria-label="Conversation suggestions"><button type="button" data-chat="A client under $100 for a holiday thank-you">Client under $100</button><button type="button" data-chat="A coworker for an office holiday party under $50">Coworker</button><button type="button" data-chat="A luxury anniversary gift for her">Luxury for her</button><button type="button" data-chat="A gamer who also travels, budget $350">Gamer who travels</button></div><p class="field-hint">Recommendations use Signal Verified products only. Product details are verified snapshots, and Shopify confirms live price, stock, delivery, tax and return eligibility before payment.</p></section>`;
}
