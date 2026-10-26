import {Pool} from 'pg';
import {dispatchProviderHealthAlerts} from './provider-alerts.js';

async function main(){
  if(!process.env.DATABASE_URL) throw new Error('database_not_configured');
  const pool=new Pool({
    connectionString:process.env.DATABASE_URL,
    ssl:process.env.NODE_ENV==='production'?{rejectUnauthorized:false}:undefined
  });
  try{
    const result=await dispatchProviderHealthAlerts({pool});
    console.log(JSON.stringify({event:'provider_alert_check',...result}));
  }finally{
    await pool.end();
  }
}

main().catch(error=>{
  console.error(JSON.stringify({
    event:'provider_alert_check_failed',
    error:error instanceof Error?error.message:'provider_alert_check_failed'
  }));
  process.exit(1);
});
