export type MetricStatus='verified'|'stale'|'unverifiable';

export interface CompanyMetricRecord {
  metricId:string;
  definitionVersion:string;
  displayName:string;
  value:number;
  unit:string;
  definition:string;
  sourceId:string;
  sourceVersion:string;
  computedAt:string;
  freshnessSlaHours:number;
  status:MetricStatus;
  owner?:string;
  codeVersion:string;
  inputHash:string;
}

export interface ApiCallEvent {
  companyId:string;
  occurredAt:string;
  requestId:string;
  endpoint:string;
  vertical:string;
  statusCode:number;
  latencyMs:number;
  tokensIn?:number;
  tokensOut?:number;
  estimatedCostUsd?:number;
}

export interface AdCommerceEvent {
  companyId:string;
  occurredAt:string;
  campaignId:string;
  adId?:string;
  vertical:string;
  stage:'IMPRESSION'|'CLICK'|'MUSE_OPEN'|'SEARCH'|'DRAFT'|'APPROVAL'|'PURCHASE'|'DELIVERED'|'RETURN';
  spendUsd?:number;
  revenueUsd?:number;
}

export interface CompanyReportInput {
  companyId:string;
  apiCalls:ApiCallEvent[];
  adEvents:AdCommerceEvent[];
  now?:Date;
}

export interface VerticalSummary {
  vertical:string;
  apiCalls:number;
  errorRate:number;
  avgLatencyMs:number;
  purchases:number;
  revenueUsd:number;
  roas:number|null;
  clickToPurchaseRate:number;
}

export interface CompanyIntelligenceReport {
  companyId:string;
  generatedAt:string;
  api:{
    calls:number;
    errors:number;
    errorRate:number;
    avgLatencyMs:number;
    estimatedCostUsd:number;
  };
  ads:{
    impressions:number;
    clicks:number;
    museOpens:number;
    purchases:number;
    spendUsd:number;
    revenueUsd:number;
    ctr:number;
    clickToPurchaseRate:number;
    roas:number|null;
    costPerPurchase:number|null;
  };
  verticals:VerticalSummary[];
}

const pct=(n:number)=>Math.round(n*10000)/100;
const money=(n:number)=>Math.round(n*100)/100;
const safeRate=(num:number,den:number)=>den?num/den:0;

export function effectiveMetricStatus(record:CompanyMetricRecord,now=new Date()):MetricStatus{
  const ageMs=now.getTime()-new Date(record.computedAt).getTime();
  if(!Number.isFinite(ageMs)) return 'unverifiable';
  if(ageMs>record.freshnessSlaHours*3600000) return 'stale';
  if(record.status==='verified'&&(!record.sourceVersion||!record.codeVersion||!record.inputHash)) return 'unverifiable';
  return record.status;
}

export function summarizeCompanyIntelligence(input:CompanyReportInput):CompanyIntelligenceReport{
  const api=input.apiCalls.filter(e=>e.companyId===input.companyId);
  const ads=input.adEvents.filter(e=>e.companyId===input.companyId);

  const apiErrors=api.filter(e=>e.statusCode>=400).length;
  const apiCost=api.reduce((s,e)=>s+(e.estimatedCostUsd??0),0);
  const avgLatency=api.length?api.reduce((s,e)=>s+e.latencyMs,0)/api.length:0;

  const countStage=(stage:AdCommerceEvent['stage'])=>ads.filter(e=>e.stage===stage).length;
  const impressions=countStage('IMPRESSION');
  const clicks=countStage('CLICK');
  const museOpens=countStage('MUSE_OPEN');
  const purchases=countStage('PURCHASE');
  const spend=ads.reduce((s,e)=>s+(e.spendUsd??0),0);
  const revenue=ads.reduce((s,e)=>s+(e.revenueUsd??0),0);

  const verticals=[...new Set([...api.map(e=>e.vertical),...ads.map(e=>e.vertical)])].sort().map(vertical=>{
    const va=api.filter(e=>e.vertical===vertical);
    const vd=ads.filter(e=>e.vertical===vertical);
    const vErrors=va.filter(e=>e.statusCode>=400).length;
    const vPurchases=vd.filter(e=>e.stage==='PURCHASE').length;
    const vClicks=vd.filter(e=>e.stage==='CLICK').length;
    const vSpend=vd.reduce((s,e)=>s+(e.spendUsd??0),0);
    const vRevenue=vd.reduce((s,e)=>s+(e.revenueUsd??0),0);
    return {
      vertical,
      apiCalls:va.length,
      errorRate:pct(safeRate(vErrors,va.length)),
      avgLatencyMs:Math.round(va.length?va.reduce((s,e)=>s+e.latencyMs,0)/va.length:0),
      purchases:vPurchases,
      revenueUsd:money(vRevenue),
      roas:vSpend>0?Math.round((vRevenue/vSpend)*100)/100:null,
      clickToPurchaseRate:pct(safeRate(vPurchases,vClicks))
    };
  });

  return {
    companyId:input.companyId,
    generatedAt:(input.now??new Date()).toISOString(),
    api:{
      calls:api.length,
      errors:apiErrors,
      errorRate:pct(safeRate(apiErrors,api.length)),
      avgLatencyMs:Math.round(avgLatency),
      estimatedCostUsd:money(apiCost)
    },
    ads:{
      impressions,clicks,museOpens,purchases,
      spendUsd:money(spend),
      revenueUsd:money(revenue),
      ctr:pct(safeRate(clicks,impressions)),
      clickToPurchaseRate:pct(safeRate(purchases,clicks)),
      roas:spend>0?Math.round((revenue/spend)*100)/100:null,
      costPerPurchase:purchases?money(spend/purchases):null
    },
    verticals
  };
}

export function buildCompanyReportMarkdown(report:CompanyIntelligenceReport,metrics:CompanyMetricRecord[],now=new Date()){
  const statuses=metrics.map(metric=>({metric,status:effectiveMetricStatus(metric,now)}));
  const lines=[
    `# Company Intelligence Report — ${report.companyId}`,
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '## API usage',
    '',
    `- Calls: ${report.api.calls}`,
    `- Error rate: ${report.api.errorRate}%`,
    `- Average latency: ${report.api.avgLatencyMs} ms`,
    `- Estimated API cost: $${report.api.estimatedCostUsd.toFixed(2)}`,
    '',
    '## Ad-to-commerce efficiency',
    '',
    `- Impressions: ${report.ads.impressions}`,
    `- Clicks: ${report.ads.clicks}`,
    `- Muse opens: ${report.ads.museOpens}`,
    `- Purchases: ${report.ads.purchases}`,
    `- CTR: ${report.ads.ctr}%`,
    `- Click → purchase: ${report.ads.clickToPurchaseRate}%`,
    `- ROAS: ${report.ads.roas??'n/a'}`,
    `- Cost per purchase: ${report.ads.costPerPurchase===null?'n/a':'$'+report.ads.costPerPurchase.toFixed(2)}`,
    '',
    '## Vertical performance',
    '',
    '| Vertical | API calls | Error rate | Avg latency | Purchases | Revenue | ROAS | Click→Purchase |',
    '|---|---:|---:|---:|---:|---:|---:|---:|'
  ];
  for(const row of report.verticals){
    lines.push(`| ${row.vertical} | ${row.apiCalls} | ${row.errorRate}% | ${row.avgLatencyMs} ms | ${row.purchases} | $${row.revenueUsd.toFixed(2)} | ${row.roas??'n/a'} | ${row.clickToPurchaseRate}% |`);
  }
  lines.push('','## Metric verification','','| Metric | Status | Source | Computed | SLA |','|---|---|---|---|---:|');
  for(const {metric,status} of statuses){
    lines.push(`| ${metric.displayName} | ${status} | ${metric.sourceId}@${metric.sourceVersion} | ${metric.computedAt} | ${metric.freshnessSlaHours}h |`);
  }
  return lines.join('\n');
}
