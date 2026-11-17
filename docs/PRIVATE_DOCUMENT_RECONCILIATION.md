# Privat dokumentinventering

Superadmin → Dokumentinventering visar högst 50 objekt eller dokumentreferenser åt gången, med nästa/föregående sida. Den autentiserade administratörens UUID och aktiva privata behörighet kontrolleras före och efter läsningen. SQL låser aktuell Auth- och administratörsbehörighet för läsning. Företagsägare och användarmetadata ger ingen åtkomst.

Inventeringen jämför Storage-katalogen med registrerade avtalsoriginal, arkivens PDF-/evidenspar, uppladdade original och artefakter, offertarkiv och allmänna dokumentreferenser. Den skiljer registrerade befintliga objekt, registrerade saknade objekt och objekt utan registrerad referens. Lagringsområdets privata flagga och objektets skapandetid visas. Inga filer, köer eller dokumentregistreringar ändras.

En oregistrerad fil är inte automatiskt övergiven. Systemets befintliga uppladdningsvägar har ingen fullständig gemensam avsiktsjournal före filskrivningen. Därför anges pågående försök alltid som **ej fastställt**; `attemptState` är `unknown` och `canDelete` är alltid `false`. Statusen gäller även gamla filer. Skapandetid bevisar inte att bevarandekrav upphört. Inventeringen kontrollerar katalogreferenser, inte objektets faktiska bytes, SHA-256 eller backup.

Före ett separat driftbeslut krävs jämförelse med aktuella dokument- och begärandereferenser, signeringskälla, eventuellt pågående eller återförsökt arbete, faktiska filbytes och kontrollsummor, samt bevarande-/backupregler. Bekräftade original och ofullständiga par får inte automatiskt skrivas över eller tas bort. Den här funktionen har ingen raderingsåtgärd.

SQL-funktionen `get_private_document_inventory` är en begränsad, autentiserad invoker-wrapper runt en privat behörighetskontrollerad implementation. Inga nya direkta tabell- eller Storage-grants ges.

# Äldre fordonsuppgifter

Äldre tomma eller för långa märkes-/modellfält lämnas orörda i databasen och visas som en avgränsad varning på lagerraden. Etiketten begränsas till 160 tecken; tomma värden visar ”Uppgift saknas”. Fel företag, fel aktör och fel datatyp avvisar fortfarande hela svaret. `NOT VALID`-kontroller begränsar framtida skrivningar till samma längder som formuläret, utan att en befintlig avvikelse stoppar migrationskörningen.

Före validering av de äldre raderna kan en behörig databasoperatör inventera antal utan att skriva data:

```sql
select count(*) filter(where length(make) not between 1 and 160) as make_requires_review,
       count(*) filter(where length(model) not between 1 and 160) as model_requires_review
from public.vehicles;
```

Det finns ingen automatisk ändring av ursprungliga fordonsvärden i den här rättningen.
