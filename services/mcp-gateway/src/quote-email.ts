import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {z} from 'zod';
import type {BusinessQuotes} from './business.js';
import {quotePdf} from './quote-pdf.js';
export interface QuoteMailer {send(to:string,subject:string,text:string,pdf:Buffer):Promise<string>}
export async function emailQuote(store:BusinessQuotes,mailer:QuoteMailer|undefined,allowedRecipients:string[],input:{quoteId:string;digest:string;to:string;approved:boolean}){
 const to=z.string().email().parse(input.to).toLowerCase();
 if(!input.approved)throw new Error('Review the quote and explicitly approve emailing it to this recipient first.');
 if(!allowedRecipients.map(x=>x.toLowerCase()).includes(to))throw new Error('This recipient is not configured for the business.');
 if(!mailer)throw new Error('Email delivery is not configured. You can still download the PDF.');
 const {quote,digest}=await store.get(input.quoteId);if(input.digest!==digest)throw new Error('The quote changed. Review it again before emailing.');
 const key=createHash('sha256').update(digest+'\n'+to).digest('hex');const receipt=join(store.directory,'email-'+key+'.json');
 const pdf=await quotePdf(quote);
 try{await writeFile(receipt,JSON.stringify({status:'sending',quoteId:quote.id,to}),{flag:'wx',mode:0o600});}
 catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;return JSON.parse(await readFile(receipt,'utf8'));}
 try{
  const messageId=await mailer.send(to,'THE GIFT SIGNAL - '+quote.eventName,'Your itemized business quote is attached. This is not an order. Shipping, tax and delivery still need confirmation.',pdf);
  const result={status:'sent',quoteId:quote.id,to,messageId};await writeFile(receipt,JSON.stringify(result),{mode:0o600});return result;
 }catch{
  const result={status:'delivery_unknown',quoteId:quote.id,to,detail:'Check the sender before retrying; the server will not send a duplicate automatically.'};await writeFile(receipt,JSON.stringify(result),{mode:0o600});return result;
 }
}
