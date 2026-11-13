'use client';
import {useId,useState} from 'react';
const models={
 unknown:{label:'Inte klassificerad ännu',help:'Momsmodellen är inte fastställd. Systemet antar inget momsavdrag. Kontrollera inköpsunderlaget innan du använder momskalkylen.'},
 standard:{label:'Vanlig moms (25 %)',help:'Försäljningspriset inkluderar vanlig moms. Av 125 000 kr inklusive moms är 25 000 kr moms. Avdrag för inköpsmoms kräver ett separat, giltigt underlag.'},
 vmb:{label:'Vinstmarginalbeskattning (VMB)',help:'När villkoren för VMB är uppfyllda beräknas momsen på vinstmarginalen. Det är vanligt vid inköp från privatperson. Moms anges inte separat för köparen.'},
} as const;
export function VehicleVatField(){
 const id=useId(),[value,setValue]=useState<keyof typeof models>('unknown');
 return <div className="vehicle-vat-field"><label htmlFor={id}>Momsmodell</label><select id={id} name="vat_scheme" value={value} onChange={e=>setValue(e.target.value as keyof typeof models)} aria-describedby={`${id}-help`}>{Object.entries(models).map(([key,model])=><option key={key} value={key}>{model.label}</option>)}</select><p id={`${id}-help`} className="field-help">{models[value].help}</p><details><summary>Jämför momsmodellerna</summary><dl>{Object.values(models).map(model=><div key={model.label}><dt>{model.label}</dt><dd>{model.help}</dd></div>)}</dl></details></div>;
}
