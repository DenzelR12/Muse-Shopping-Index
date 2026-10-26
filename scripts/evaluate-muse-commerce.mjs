import {readFile} from 'node:fs/promises';
import {proposeMuseCommerceStep} from '../apps/demo/dist/muse-commerce.js';
import {runMuseToolAgent} from '../apps/demo/dist/muse-tool-agent.js';

if(!process.argv.includes('--live')){
  console.error('Use --live to evaluate the configured model. This only requests model proposals; no commerce tools or payments execute.');
  process.exit(2);
}
if(!process.env.META_MODEL_API_KEY||!process.env.META_MODEL_API_BASE_URL||!process.env.META_MUSE_MODEL){
  console.error('Configured Muse model credentials are required. No model evaluation was run.');process.exit(2);
}
const cases=JSON.parse(await readFile(new URL('../training/muse-commerce/validation-scenarios.json',import.meta.url),'utf8'));
let passed=0;let modelResponses=0;
for(const item of cases){
  if(process.argv.includes('--native')){
    let proposed;
    const result=await runMuseToolAgent({userMessage:item.userMessage,maxTurns:1,
      host:{readContext:async()=>structuredClone(item.context),dispatch:async step=>{
        proposed=step;
        // Evaluation-only observation, not a commerce executor.
        return {status:'review_required'};
      }}
    });
    const ok=JSON.stringify(proposed)===JSON.stringify(item.expected);
    if(proposed) modelResponses++;
    if(ok) passed++;
    console.log(JSON.stringify({case:item.id,passed:ok,protocol:'native_tools',stop:result.stop}));
    continue;
  }
  const result=await proposeMuseCommerceStep({context:item.context,userMessage:item.userMessage,now:new Date(item.asOf)});
  if(result.mode==='MUSE') modelResponses++;
  const ok=result.mode==='MUSE'&&JSON.stringify(result.step)===JSON.stringify(item.expected);
  if(ok) passed++;
  console.log(JSON.stringify({case:item.id,passed:ok,mode:result.mode}));
}
console.log(JSON.stringify({model:process.env.META_MUSE_MODEL,total:cases.length,modelResponses,passed,accuracy:passed/cases.length,commerceToolsExecuted:0}));
if(passed!==cases.length) process.exitCode=1;
