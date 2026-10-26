import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import nodemailer from 'nodemailer';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {z} from 'zod';
import {BusinessQuotes} from './business.js';
import {createBusinessMcp} from './business-server.js';
import type {QuoteMailer} from './quote-email.js';

// One operator-configured business per local process. Do not expose this over public HTTP.
const businessId=z.string().min(1).max(100).parse(process.env.GIFT_SIGNAL_BUSINESS_ID);
const catalogPath=resolve(z.string().min(1).parse(process.env.GIFT_SIGNAL_CATALOG_PATH));
const directory=resolve(z.string().min(1).parse(process.env.GIFT_SIGNAL_QUOTES_PATH));
const recipients=(process.env.GIFT_SIGNAL_EMAIL_RECIPIENTS??'').split(',').map(x=>x.trim()).filter(Boolean).map(x=>z.string().email().parse(x));
const store=new BusinessQuotes(businessId,directory,async()=>JSON.parse(await readFile(catalogPath,'utf8')));
let mailer:QuoteMailer|undefined;
if(process.env.GIFT_SIGNAL_SMTP_URL){
 const smtpUrl=new URL(process.env.GIFT_SIGNAL_SMTP_URL);
 if(!['smtp:','smtps:'].includes(smtpUrl.protocol))throw new Error('Use an SMTP or SMTPS sender URL.');
 const from=z.string().email().parse(process.env.GIFT_SIGNAL_EMAIL_FROM);
 const transport=nodemailer.createTransport({host:smtpUrl.hostname,port:Number(smtpUrl.port || (smtpUrl.protocol==='smtps:'?465:587)),secure:smtpUrl.protocol==='smtps:',requireTLS:true,auth:smtpUrl.username?{user:decodeURIComponent(smtpUrl.username),pass:decodeURIComponent(smtpUrl.password)}:undefined},{from,disableFileAccess:true,disableUrlAccess:true});
 mailer={async send(to,subject,text,pdf){const response=await transport.sendMail({to,subject,text,attachments:[{filename:'gift-signal-itemized-quote.pdf',content:pdf,contentType:'application/pdf'}]});if(!response.accepted?.length)throw new Error('Recipient was not accepted.');return response.messageId;}};
}
await createBusinessMcp(store,mailer,recipients).connect(new StdioServerTransport());
