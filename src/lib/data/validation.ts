export function textField(form: FormData,key:string,max=160) {
 const value=form.get(key); if(value===null)return '';
 if(typeof value!=='string')throw new Error('Uppgiften måste anges som text.');
 const text=value.trim();
 if(text.length>max)throw new Error(`Uppgiften får innehålla högst ${max} tecken.`);
 return text;
}
export function requiredField(form:FormData,key:string,min=1,max=160) {
 const value=textField(form,key,max); if(value.length<min) throw new Error('Fyll i alla obligatoriska uppgifter.');return value;
}
export function uuidField(form:FormData,key:string) {
 const value=requiredField(form,key);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new Error('Välj en giltig post.');return value;
}
export function moneyField(form:FormData,key:string,allowZero=false) {
 const value=requiredField(form,key).replace(/\s/g,'').replace(',','.');
 if(!/^\d{1,10}(?:\.\d{1,2})?$/.test(value)) throw new Error('Ange ett belopp med högst två decimaler.');
 const [whole,fraction='']=value.split('.');const ore=Number(whole)*100+Number(fraction.padEnd(2,'0'));
 if(!Number.isSafeInteger(ore)||(!allowZero&&ore<=0)) throw new Error('Beloppet måste vara större än noll.');return ore;
}
export function enumField(form:FormData,key:string,allowed:string[],fallback?:string) {
 const value=textField(form,key)||fallback;if(!value||!allowed.includes(value)) throw new Error('Välj ett giltigt alternativ.');return value;
}
export function integerField(form:FormData,key:string,min:number,max:number,fallback?:number) {
 const raw=textField(form,key);
 if(raw!==''&&!/^-?\d+$/.test(raw))throw new Error('Ange ett heltal för årtal, miltal eller löptid.');
 const value=raw===''?fallback:Number(raw);
 if(value===undefined||!Number.isSafeInteger(value)||value<min||value>max) throw new Error('Kontrollera årtal, miltal eller löptid.');return value;
}
