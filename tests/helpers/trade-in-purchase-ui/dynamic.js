import {DealTradeInPurchase} from '../../../src/components/deal-trade-in-purchase';
export default function dynamic(loader){return String(loader).includes('deal-trade-in-purchase')?DealTradeInPurchase:()=>null;}
