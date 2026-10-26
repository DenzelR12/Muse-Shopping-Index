import type {ShoppingOffer} from '@gift-signal/shopping-index';

const now='2026-10-24T15:00:00.000Z';

export const demoOffers:ShoppingOffer[]=[
  {
    offerId:'atlas-carry-on-22',companyId:'atlas-retail',entityId:'carry-on-22',kind:'PRODUCT',
    title:'Atlas Carry-On 22',summary:'Lightweight polycarbonate carry-on with USB-C pass-through and compression panels.',
    price:289,currency:'USD',availability:'AVAILABLE',destinationOrRegion:'US',fulfillmentMode:'SHIP',
    deliveryOrStartAt:'2026-10-28T18:00:00.000Z',
    attributes:{brand:'Atlas',weightLb:6.8,color:'Graphite'},
    intents:['carry-on','travel','luggage','business travel'],
    actions:['VIEW','CONFIGURE','ADD_TO_CART','BUY'],
    evidence:[{sourceId:'atlas-demo-api',observedAt:now,sourceType:'COMPANY_CONNECTOR',fields:['price','availability','delivery','variant']}]
  },
  {
    offerId:'nomad-carry-on-pro',companyId:'nomad-retail',entityId:'carry-on-pro',kind:'PRODUCT',
    title:'Nomad Carry-On Pro',summary:'Premium aluminum-frame carry-on with removable laptop sleeve.',
    price:349,currency:'USD',availability:'LIMITED',destinationOrRegion:'US',fulfillmentMode:'SHIP',
    deliveryOrStartAt:'2026-10-29T18:00:00.000Z',
    attributes:{brand:'Nomad',weightLb:8.1,color:'Midnight'},
    intents:['carry-on','travel','premium','laptop'],
    actions:['VIEW','CONFIGURE','ADD_TO_CART','BUY'],
    evidence:[{sourceId:'nomad-demo-api',observedAt:now,sourceType:'COMPANY_CONNECTOR',fields:['price','availability','delivery']}]
  },
  {
    offerId:'orlando-family-2day',companyId:'sunshine-travel',entityId:'orlando-family',kind:'TRAVEL',
    title:'Orlando Family Stay + 2 Park Days',summary:'Three hotel nights near the resort area plus two theme-park days for four.',
    price:3720,currency:'USD',availability:'AVAILABLE',destinationOrRegion:'Orlando',fulfillmentMode:'BOOKING',
    deliveryOrStartAt:'2026-11-13T15:00:00.000Z',
    attributes:{travelers:4,hotelNights:3,parkDays:2},
    intents:['family','theme park','hotel','orlando','vacation'],
    actions:['VIEW','CONFIGURE','BOOK'],
    evidence:[{sourceId:'sunshine-demo-booking',observedAt:now,sourceType:'BOOKING_API',fields:['price','availability','hotel','dates','park days']}]
  },
  {
    offerId:'orlando-value-2day',companyId:'harbor-travel',entityId:'orlando-value',kind:'TRAVEL',
    title:'Orlando Value Hotel + 2 Park Days',summary:'Three-night value hotel package and two park days for four travelers.',
    price:3295,currency:'USD',availability:'LIMITED',destinationOrRegion:'Orlando',fulfillmentMode:'BOOKING',
    deliveryOrStartAt:'2026-11-13T15:00:00.000Z',
    attributes:{travelers:4,hotelNights:3,parkDays:2},
    intents:['family','theme park','hotel','orlando','value'],
    actions:['VIEW','CONFIGURE','BOOK'],
    evidence:[{sourceId:'harbor-demo-booking',observedAt:now,sourceType:'BOOKING_API',fields:['price','availability','hotel','dates','park days']}]
  }
];
