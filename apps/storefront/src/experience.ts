export const relationships = ['Partner', 'Friend', 'Family', 'Colleague', 'Myself'] as const;
export const occasions = ['Just because', 'Birthday', 'Anniversary', 'Thank you', 'A new chapter', 'Christmas', 'Hanukkah', 'Diwali', 'Thanksgiving host gift', 'New Year', 'Employee appreciation'] as const;
export const interests = ['Quiet rituals', 'Design & objects', 'Food & hosting', 'Travel & discovery'] as const;
export const deadlines = ['No rush', 'This week', 'Within 3 days', 'Tomorrow'] as const;
export interface Brief { recipient: string; relationship: string; occasion: string; interests: string[]; budget: number; deadline: string; note: string }
export interface Concept { id: string; title: string; category: string; description: string; mood: string; interests: string[]; items: { name: string; estimate: number }[] }
export const concepts: Concept[] = [
 {id:'slow-sunday',title:'The slow Sunday',category:'THE RITUAL EDIT',description:'A little permission to switch off. Warm light, something beautiful to hold, and time that belongs to them.',mood:'ritual',interests:['Quiet rituals','Design & objects'],items:[{name:'Sculptural ceramic cup',estimate:45},{name:'Botanical candle',estimate:55},{name:'Linen reading journal',estimate:35}]},
 {id:'after-hours',title:'An evening, elevated',category:'THE HOST EDIT',description:'For the one who turns a table into a gathering. Thoughtful details that make staying in an occasion.',mood:'host',interests:['Food & hosting','Design & objects'],items:[{name:'Hand-finished serving bowl',estimate:70},{name:'Pair of linen napkins',estimate:30},{name:'Small-batch pantry pairing',estimate:40}]},
 {id:'elsewhere',title:'A little elsewhere',category:'THE DISCOVERY EDIT',description:'For a mind that is always somewhere new. Beautiful everyday companions for the next chapter.',mood:'travel',interests:['Travel & discovery','Quiet rituals'],items:[{name:'Pocket travel journal',estimate:30},{name:'Textured travel pouch',estimate:65},{name:'Illustrated city companion',estimate:40}]}
];
export const emptyBrief = (): Brief => ({recipient:'',relationship:'',occasion:'',interests:[],budget:150,deadline:'No rush',note:''});
export function validStep(brief: Brief, step: number): boolean {
 if(step===0) return brief.recipient.trim().length>0 && brief.recipient.length<=60 && (relationships as readonly string[]).includes(brief.relationship);
 if(step===1) return (occasions as readonly string[]).includes(brief.occasion);
 if(step===2) return brief.interests.length>0 && brief.interests.every(x=>(interests as readonly string[]).includes(x));
 if(step===3) return Number.isFinite(brief.budget) && brief.budget>=25 && brief.budget<=5000;
 return (deadlines as readonly string[]).includes(brief.deadline);
}
export function isBrief(value: unknown): value is Brief {
 if(!value || typeof value!=='object') return false;
 const b=value as Brief;
 return typeof b.recipient==='string' && typeof b.relationship==='string' && typeof b.occasion==='string' && Array.isArray(b.interests) && typeof b.budget==='number' && typeof b.deadline==='string' && typeof b.note==='string' && b.note.length<=280 && [0,1,2,3,4].every(s=>validStep(b,s));
}
export function curate(brief: Brief) {
 if(!isBrief(brief)) throw new Error('Please complete your gifting brief.');
 return concepts.map(concept=>{
   let total=0;
   const items=concept.items.filter(item=>{if(total+item.estimate>brief.budget) return false; total+=item.estimate; return true;});
   const matches=concept.interests.filter(i=>brief.interests.includes(i));
   return {...concept,items,total,matches};
 }).filter(c=>c.items.length>0).sort((a,b)=>b.matches.length-a.matches.length || b.total-a.total);
}
export interface SavedBrief { id: string; savedAt: string; brief: Brief; conceptId: string }
export function readSaved(raw: string | null): SavedBrief[] {
 try { const a:unknown=JSON.parse(raw??'[]'); return Array.isArray(a)?a.filter((x):x is SavedBrief=>!!x && typeof x==='object' && typeof x.id==='string' && typeof x.savedAt==='string' && Number.isFinite(Date.parse(x.savedAt)) && isBrief(x.brief) && concepts.some(c=>c.id===x.conceptId)).slice(0,20):[]; } catch { return []; }
}
export function briefText(brief: Brief, conceptId: string): string {
 const c=curate(brief).find(x=>x.id===conceptId);
 if(!c) throw new Error('This concept is not available within the brief.');
 return ['THE GIFT SIGNAL — PRIVATE GIFT BRIEF','Concept planning only. Not an order or a product offer.','',`For: ${brief.recipient} (${brief.relationship})`,`Occasion: ${brief.occasion}`,`Interests: ${brief.interests.join(', ')}`,`Maximum product budget: $${brief.budget} USD`,`Requested timing: ${brief.deadline} — availability and delivery unconfirmed`,'',c.title,...c.items.map(i=>`${i.name} — planning estimate $${i.estimate}`),`Concept estimate: $${c.total} USD, excluding shipping and tax`,`Personal note: ${brief.note||'To be added'}`,'','Next: confirm real products, current prices, delivery and checkout with an authoritative catalog.'].join('\n');
}
