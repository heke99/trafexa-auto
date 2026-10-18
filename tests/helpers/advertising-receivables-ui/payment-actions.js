import * as actions from '../advertising-payment-ui/actions.js';
export const getPlatformAdvertisingPaymentPageAction=actions.getPlatformAdvertisingPaymentPageAction;
export const listAdvertisingPaymentPageAction=actions.listAdvertisingPaymentPageAction;
export const lookupAdvertisingPaymentAction=actions.lookupAdvertisingPaymentAction;
export async function registerAdvertisingPaymentAction(input){window.busyAtIo.push(window.receivablesBusy);window.onPaymentIo?.();return actions.registerAdvertisingPaymentAction(input);}
export async function reverseAdvertisingPaymentAction(input){window.busyAtIo.push(window.receivablesBusy);window.onPaymentIo?.();return actions.reverseAdvertisingPaymentAction(input);}
