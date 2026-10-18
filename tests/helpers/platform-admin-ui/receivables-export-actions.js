import * as actual from '../advertising-payment-ui/export-actions.js';
import * as unavailable from '../advertising-payment-ui/unavailable-export-actions.js';
export const getPlatformAdvertisingPaymentExportAction=input=>(window.fixture.enableReceivablesPayment ? actual : unavailable).getPlatformAdvertisingPaymentExportAction(input);
export const getAdvertisingPaymentExportAction=input=>(window.fixture.enableReceivablesPayment ? actual : unavailable).getAdvertisingPaymentExportAction(input);
