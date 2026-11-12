# Arkivåterställning och beroendesäkerhet, 12 november 2026

**Genomfört:** Zods verifierade sårbarhet är åtgärdad och en sammanhängande isolerad export-/återställningskedja har körts. **Inte aktiverat:** extern automatisk backup eller produktionsåterställning. Separat lagringsplats är ännu inte vald.

## Sårbart beroende

`npm audit --json` visade en HIGH för Zod 4.1.12: [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), påverkat intervall `<4.6.6`. Endast Zod uppdaterades, med exakt pin till 4.6.7 och låst tarball/integritet i package-lock. Ingen force-uppdatering eller annan paketuppgradering gjordes.

Efter uppdateringen ger audit exit 0 och **0 sårbarheter på samtliga nivåer**. Arkiv-/återställningsgruppen passerar 23/23, de kompletta ordinarie avtals-/leveransresorna 3/3 och TypeScript-kontrollen passerar med den nya versionen. Detta delbevis ersätter inte projektets gemensamma slutbygg och helsvit.

## Vad återställningsprovet bevisar

Det nya `contract-backup-roundtrip.test.mjs` återanvänder samma riktiga dealer-/guest-actions och migrerade SQL som avtalsresan. Ett syntetiskt tvåpartssignerat avtal arkiveras och levereras i den lokala fixturen. Därefter:

1. Den faktiska privata arkivpaketrouten verifierar användarens åtkomst, SQL-källa och båda lagrade originalen och exporterar TAR-filen.
2. Route-svarets verifierade paket-SHA sparas i en separat betrodd ankarsfil, skild från paketets innehåll. Detta modellerar betrodd export; det är inte en separat fysisk backupplats.
3. Befintlig offline-CLI körs i en ny process med endast PATH/LANG, utan appens servernycklar eller leverantörskonfiguration.
4. Verify-only skapar inga återställningsfiler. Restore skapar en ny katalog med `0700` och de fasta filerna med `0600`.
5. Återlästa PDF-/evidensbytes matchar exakt de registrerade originalen. Manifestets hash och evidensens bindning till PDF-filen verifieras. `restore-proof.json` matchar det verifierade resultatet.
6. Korrupt paket, fel separat hash, symbolisk länk och befintlig målkatalog nekas. En skadad källa i provets Storage-adapter blockerar export med 409 och får inte ersättas av en ny rendering.

Det behållna syntetiska provet var 25 600 byte; PDF 15 634 byte och evidens 1 485 byte. Paketets SHA-256 är `cb85be737747af93d02708e92b0901d064017b8dc3f4bfdc1204c4b0847676c1`. Maskerat verifieringsunderlag finns i [proof.json](verification/20261112-backup-and-dependencies/proof.json).

Auth, mejlleverantör och Storage-HTTP använder kontrollerade lokala adaptrar; databasregler, RLS-katalog, actions, export, renderer och offline-CLI körs. Ingen verklig kund, mottagare, annons eller produktionslagring används. Testdatabaserna stängs efter körningen. Endast uttryckligen behållna syntetiska filprov lämnas i arbetsytan.

## Repeterbar kontroll

Efter låst installation och `npm run test:setup`:

```sh
npm run test:archive-restore
```

Kommandot kör endast isolerade syntetiska prov och aktiverar ingen driftbackup. Node.js 24, projektberoenden samt befintliga PDF-/TAR-provverktyg enligt [testmiljöguiden](TEST_ENVIRONMENT.md) behövs.

För operatörens egna exporter används fortfarande det befintliga verktyget med en separat sparad betrodd kontrollsumma och en ny återställningskatalog, enligt [CONTRACT_ARCHIVE_BACKUP](CONTRACT_ARCHIVE_BACKUP.md). Källpaketet måste komma från rätt, behörighetskontrollerade export; en nyberäknad hash av en okänd fil bevisar inte äkthet.

## Exakta återstående produktionsberoenden

| Punkt | Vad som återstår |
| --- | --- |
| Oberoende lagringsplats | Välj separat konto/bucket/tjänst, plats och en tydlig ansvarig. Ingen leverantör eller fjärrdestination har valts av koden. |
| Åtkomst och nycklar | Bestäm läs-/skriv-/återställningsbehörighet och krypterings-/nyckelhantering; credentials läggs i driftplattformens hemlighetsinställningar, aldrig i chatten. |
| Frekvens och bevarande | Godkänn backupintervall, bevarandetid och RPO/RTO så det går att mäta om kopian är tillräckligt aktuell. |
| Automatisk överföring och övervakning | När destinationen finns behövs dess adapter/jobbschema, verifierade överföringar för samtliga original och larm för saknade eller gamla kopior. Dessa är inte aktiverade av en lokal drill. |
| Komplett systemåterställning | Säkerställ betrodd databasbackup som hör till filerna och en granskad återställning i avskild miljö. Supabases databasbackup innehåller inte Storage-filernas innehåll. |
| Verkligt avtalsprov | Kör en separat godkänd resa med avsedda testidentiteter, aktuell handlarbehörighet, godkänd testmall, rätt mejlkonfiguration och privat originalbucket. Kontrollera mottagen länk, signering, original och export utan att använda verkliga kundärenden. |

En superadminroll ger inte automatiskt åtkomst till en handlares avtalsoriginal. Produktionsprovet måste använda rätt handlar-/kundbehörighet. Inga historiska underskrifter, original eller bevaranderegler har ändrats. Provet återställer filer, inte företag, Auth-konton eller databasmetadata.
