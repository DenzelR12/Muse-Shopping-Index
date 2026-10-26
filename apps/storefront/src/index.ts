export const brand={name:'THE GIFT SIGNAL',tagline:'Smart gifts. Right now.',colors:{black:'#060606',ivory:'#F3EFE6',gold:'#D4AF37',amber:'#FF5A1F',mint:'#65C7A6',stone:'#92908A'}};
export const giftingFlow=['recipient','occasion','interests','budget','deadline'];
export const resultLabels=['BEST SIGNAL','SMARTER VALUE','LET THEM CHOOSE'];
export const urgencyAxis=['10 MIN','TOMORROW','3 DAYS','THIS WEEK','NO RUSH'];

export {museConfirmationSheet,renderMuseConfirmation} from './muse-confirmation.js';
export type {MuseApprovalEnvelope,MuseConfirmationSheet} from './muse-confirmation.js';
// Live Muse confirmation page (standalone module: the storefront has no
// page-entry system, so hosts mount it on a container element; main.ts,
// the separate gifting-concierge surface, is untouched).
export {mountMuseConfirmationPage,createMuseConfirmationServerHandlers} from './muse-confirmation-page.js';
export type {MuseConfirmationPageOptions,MuseConfirmationPageResult,MuseConfirmationPageRoot,MuseConfirmationServerConfig,MuseConfirmationFetch} from './muse-confirmation-page.js';
