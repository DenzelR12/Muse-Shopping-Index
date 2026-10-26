import PDFDocument from 'pdfkit';
import type {Quote} from './business.js';
const money=(cents:number)=>'$'+(cents/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
export function quotePdf(quote:Quote):Promise<Buffer>{
 return new Promise((resolve,reject)=>{
  const doc=new PDFDocument({size:'A4',margin:48,bufferPages:true,info:{Title:'THE GIFT SIGNAL - Itemized Business Quote',Author:'THE GIFT SIGNAL'}});const chunks:Buffer[]=[];
  doc.on('data',chunk=>chunks.push(chunk));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);
  const header=()=>{doc.rect(0,0,595.28,105).fill('#203126');doc.fillColor('#D5C399').font('Helvetica').fontSize(9).text('THE GIFT SIGNAL / BUSINESS',48,34,{characterSpacing:2});doc.fillColor('#FFFFFF').font('Times-Roman').fontSize(25).text('A thoughtful plan. Every item clear.',48,56);doc.fillColor('#203126');};
  header();doc.y=130;doc.font('Helvetica-Bold').fontSize(16).text(quote.eventName);doc.moveDown(.5).font('Helvetica').fontSize(10).text('Prepared for '+quote.businessId).text('Purpose: '+quote.purpose.replaceAll('_',' ')).text('Requested date: '+(quote.neededBy??'Not specified')).text('Quote '+quote.id).text('Created '+quote.createdAt.slice(0,10)+' | USD | Review required');
  const columns=()=>{doc.moveDown(1);const y=doc.y;doc.rect(48,y,499,24).fill('#ECECE2');doc.fillColor('#203126').font('Helvetica-Bold').fontSize(9).text('ITEM / VARIANT',56,y+8,{width:270}).text('QTY',338,y+8,{width:40,align:'right'}).text('UNIT',388,y+8,{width:65,align:'right'}).text('AMOUNT',464,y+8,{width:75,align:'right'});doc.y=y+36;};
  columns();
  for(const line of quote.lines){
   const detail=line.title+'\n'+line.variantTitle+' | SKU '+line.sku+'\nIncludes: '+line.included;
   doc.font('Helvetica').fontSize(9);const height=Math.max(58,doc.heightOfString(detail,{width:265,lineGap:3})+20);
   if(doc.y+height>730){doc.addPage();header();doc.y=125;columns();}
   const y=doc.y;doc.fillColor('#24362A').font('Helvetica').fontSize(9).text(detail,56,y,{width:265,lineGap:3});doc.text(String(line.quantity),338,y,{width:40,align:'right'}).text(money(line.priceCents),388,y,{width:65,align:'right'}).text(money(line.lineTotalCents),464,y,{width:75,align:'right'});doc.moveTo(48,y+height-8).lineTo(547,y+height-8).strokeColor('#D5D9CC').stroke();doc.y=y+height;
  }
  if(doc.y>595){doc.addPage();header();doc.y=135;}
  doc.moveDown().font('Helvetica-Bold').fontSize(14).text('Product subtotal: '+money(quote.subtotalCents),48,doc.y,{width:499,align:'left'});doc.moveDown(.4).font('Helvetica').fontSize(10).text('Product budget: '+money(quote.budgetCents),{width:499,align:'left'});doc.text('Remaining before shipping and tax: '+money(quote.budgetCents-quote.subtotalCents),{width:499,align:'left'});doc.moveDown(1).fontSize(9);for(const note of quote.exclusions)doc.text(note,{width:499,align:'left',lineGap:4});
  const pages=doc.bufferedPageRange();for(let i=0;i<pages.count;i++){doc.switchToPage(i);doc.font('Helvetica').fontSize(8).fillColor('#737B6A').text('PRIVATE BUSINESS QUOTE  |  '+(i+1)+' / '+pages.count,48,790,{lineBreak:false});}
  doc.end();
 });
}
