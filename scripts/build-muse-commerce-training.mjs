import {readFile,writeFile} from 'node:fs/promises';
import {MUSE_COMMERCE_POLICY,validateMuseCommerceStep} from '../apps/demo/dist/muse-commerce.js';
import {MUSE_TOOL_POLICY,MUSE_COMMERCE_TOOLS} from '../apps/demo/dist/muse-tool-agent.js';

const root=new URL('../training/muse-commerce/',import.meta.url);
const ids=new Set();
for(const split of ['train','validation']){
  const scenarios=JSON.parse(await readFile(new URL(split+'-scenarios.json',root),'utf8'));
  const lines=[];
  const nativeLines=[];
  for(const scenario of scenarios){
    if(ids.has(scenario.id)) throw Error('duplicate_scenario_id');
    ids.add(scenario.id);
    validateMuseCommerceStep(scenario.expected,scenario.context,new Date(scenario.asOf));
    lines.push(JSON.stringify({messages:[
      {role:'system',content:MUSE_COMMERCE_POLICY},
      {role:'system',content:'server_context: '+JSON.stringify({asOf:scenario.asOf,...scenario.context})},
      {role:'user',content:scenario.userMessage},
      {role:'assistant',content:JSON.stringify(scenario.expected)}
    ]}));
    nativeLines.push(JSON.stringify({tools:MUSE_COMMERCE_TOOLS,messages:[
      {role:'system',content:MUSE_TOOL_POLICY},
      {role:'system',content:'server_context: '+JSON.stringify({asOf:scenario.asOf,...scenario.context})},
      {role:'user',content:scenario.userMessage},
      {role:'assistant',content:null,tool_calls:[{id:'call_'+scenario.id,type:'function',function:{name:scenario.expected.action,arguments:JSON.stringify(scenario.expected.args)}}]}
    ]}));
  }
  const content=lines.join('\n')+'\n';
  const target=new URL(split+'.jsonl',root);
  if(process.argv.includes('--check')){
    if(await readFile(target,'utf8')!==content) throw Error('training_export_outdated:'+split);
  }else await writeFile(target,content);
  const nativeContent=nativeLines.join('\n')+'\n';
  const nativeTarget=new URL('native-'+split+'.jsonl',root);
  if(process.argv.includes('--check')){
    if(await readFile(nativeTarget,'utf8')!==nativeContent) throw Error('native_training_export_outdated:'+split);
  }else await writeFile(nativeTarget,nativeContent);
  console.log(`${split}: ${scenarios.length} synthetic examples validated`);
}
