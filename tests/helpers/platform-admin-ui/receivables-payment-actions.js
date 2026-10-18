import * as actual from '../advertising-payment-ui/actions.js';
import * as unavailable from '../advertising-payment-ui/unavailable-actions.js';
const invoke=(name,input)=>(window.fixture.enableReceivablesPayment ? actual : unavailable)[name](input);
export const getPlatformAdvertisingPaymentPageAction=input=>invoke('getPlatformAdvertisingPaymentPageAction',input);
export const listAdvertisingPaymentPageAction=input=>invoke('listAdvertisingPaymentPageAction',input);
export const lookupAdvertisingPaymentAction=input=>invoke('lookupAdvertisingPaymentAction',input);
export const registerAdvertisingPaymentAction=input=>invoke('registerAdvertisingPaymentAction',input);
export const reverseAdvertisingPaymentAction=input=>invoke('reverseAdvertisingPaymentAction',input);
