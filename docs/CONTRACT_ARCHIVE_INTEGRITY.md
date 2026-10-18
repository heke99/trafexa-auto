# Kontroll av arkiverade avtalsoriginal

Handlaren kan uttryckligen kontrollera originalfilerna för ett färdigsignerat native avtal. Arkivets registrerade metadata och en lyckad filkontroll visas som separata uppgifter. Att öppna panelen eller läsa arkivstatus hämtar inte automatiskt filerna för en integritetskontroll.

## Kontrollens kontrakt

`verifyContractArchiveAction` tar endast signeringsreferens och, för handlarens vy, företagsreferens. Servern verifierar det aktuella kontot och läser arkivmetadata. Om ett arkiv finns verifieras den färdiga signeringskällan, och både PDF och JSON-evidens hämtas genom användarens autentiserade Storage-klient. Befintliga privata Storage-policyer gäller; kontrollen använder ingen service- eller registreringsnyckel.

Båda filernas faktiska storlekar och SHA-256 ska matcha det registrerade originalparet. Evidensen ska dessutom binda rätt PDF, dokumentversion, signering och båda sparade parternas bekräftelser. Servern läser källa, metadata och behörighet igen före ett lyckat svar. Ändrad eller återkallad åtkomst får inte ge en lyckad kontroll från ett tidigare hämtat underlag.

Ett positivt svar innehåller arkivets referenser, aktuell aktör/roll och kontrolltid, utan filbytes, personliga dokumentnycklar eller serverhemligheter. Saknat arkiv är inte ett godkänt integritetsresultat. Saknad eller skadad fil, avvikande källa och nätverksavbrott ger inget kontrollbevis och får inte starta omrendering eller skapa ett ersättningsoriginal.

## Användarflöde och behörighet

Kontrollen startas med **Kontrollera originalfilerna** i avtalets originalarkiv. Samma behörigheter gäller som för befintlig privat arkivläsning: företagets ägare, administratör och ekonomiansvarig samt behörig kund genom den befintliga kontobaserade kundvyn. Kontofria dokumentlänkar får inga nya rättigheter genom kontrollen. Superadminrollen ger ingen separat åtkomst till ett företags avtal.

Gränssnittet spärrar överlappande arkivåtgärder medan kontrollen pågår och binder svaret till exakt konto, roll, företag, signering och arkiv. Ny statusläsning eller ändrat underlag tar bort den tidigare filkontrollens status. Sena svar från en tidigare vy får inte uppdatera den aktuella vyn.

## Bevarande och verifieringsgräns

Kontrollen läser endast befintliga original. Den registrerar, laddar upp, ersätter, raderar eller skickar ingenting. Kontrolltiden är ett resultat i den aktuella vyn och utgör ingen beständig revisionspost eller framtida tillgänglighetsgaranti.

Separat Storage-backup, bevarandetider och återställningsprov är fortsatta driftsteg. En lyckad kontroll visar integritet vid kontrolltillfället och ersätter inte en backup. Grundarkivets kontrakt finns i [NATIVE_CONTRACT_ARCHIVE](NATIVE_CONTRACT_ARCHIVE.md). Faktiskt körda prov och publicering redovisas i [IMPLEMENTATION_STATUS](IMPLEMENTATION_STATUS.md).
