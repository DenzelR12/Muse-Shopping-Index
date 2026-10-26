export const clamp = (x:number,min=0,max=1) => Math.max(min,Math.min(max,x));
export const chapterProgress = [0, .3, .5, .7, .99] as const;
export function easeBetween(progress:number,start:number,end:number){const t=clamp((progress-start)/(end-start));return t*t*(3-2*t);}
export function storyState(progress:number){
 const p=clamp(progress);
 return {progress:p,chapter:Math.min(4,Math.floor(p*5)),material:easeBetween(p,.04,.2),objects:easeBetween(p,.18,.42),note:easeBetween(p,.42,.6),settle:easeBetween(p,.63,.82),seal:easeBetween(p,.79,.98),rotation:-.38+p*.6};
}
