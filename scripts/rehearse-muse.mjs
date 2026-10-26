import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {existsSync} from 'node:fs';

const root=fileURLToPath(new URL('../',import.meta.url));
if(!existsSync(root+'apps/api/dist/muse-agent-host.js')){console.error('Run pnpm build before rehearsing.');process.exit(2);}
console.log('OFFLINE REHEARSAL: model and provider transports are mocked. No live Muse result, training job, payment or merchant order.');
const env={...process.env,NODE_ENV:'test',MUSE_AGENT_ENABLED:'false'};
for(const key of Object.keys(env)){
  if(/^(META_|STRIPE_|SHOPIFY_|PROVIDER_|OIDC_|SHOP_OIDC_|DATABASE_URL$|ENROLLMENT_TEST_DATABASE_URL$|NODE_OPTIONS$)/.test(key)) delete env[key];
}
const tests=[
  'tests/reel-muse-purchase-e2e.test.ts','apps/demo/test/muse-tool-agent.test.ts','apps/demo/test/muse-commerce.test.ts',
  'apps/api/test/muse-agent-host.test.ts','apps/api/test/consumer-enrollment.test.ts','apps/api/test/muse-confirmation-submit.test.ts',
  'apps/api/test/provider-transaction-execution.test.ts','apps/api/test/provider-paid-fulfillment-reconciliation.test.ts',
  'apps/api/test/provider-refund-compensation.test.ts','apps/api/test/provider-refund-webhook.test.ts',
  'services/payments/test/stripe.test.ts'
];
const result=spawnSync(process.execPath,['--import','tsx','--import',root+'scripts/rehearsal-no-network.mjs','--test',...tests],{cwd:root,env,stdio:'inherit'});
if(result.error) console.error('Could not start rehearsal.');
process.exitCode=result.status??1;
