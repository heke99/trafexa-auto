export type NetworkVehicle={make:string;model:string;year:number;mileageKm:number;fuel:string;gearbox:string;priceOre:string;currency:'SEK';seller:string};
export type NetworkListing={id:string;version:number;vehicle:NetworkVehicle};
export type NetworkOwn={stockId:string;title:string;registration:string;status:string;listingId:string|null;version:number;published:boolean;live:boolean;source:NetworkVehicle|null};
export type NetworkThread={id:string;title:string;direction:'sent'|'received';counterparty:string;senderEmail:string;hasOlderMessages:boolean;messages:{id:string;own:boolean;text:string;createdAt:string}[]};
export type NetworkPage={companyId:string;actorId:string;role:string;items:NetworkListing[];own:NetworkOwn[];threads:NetworkThread[];hasMore:boolean};
export type NetworkResult<T>={ok:true;data:T}|{ok:false;code:string;error:string};
