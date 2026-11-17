/** Old SQL writers accepted unbounded make/model text. Preserve the row and its
 * identity, project a bounded label, and flag it for correction. Scope checks
 * remain strict in the caller and malformed/non-string values still deny. */
export function projectVehicleText(value:unknown):{text:string;review:boolean}{
 if(typeof value!=='string')throw Error('Invalid vehicle text');
 if(value.length===0)return{text:'Uppgift saknas',review:true};
 if(value.length>160)return{text:value.slice(0,159)+'…',review:true};
 return{text:value,review:false};
}
