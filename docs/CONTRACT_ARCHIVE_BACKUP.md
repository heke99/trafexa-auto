# Export och återställningsprov av avtalsoriginal

Denna etapp förbereder portabel export och ett isolerat återställningsprov. Användaren har ännu inte valt en separat lagringsplats. Funktionen kopierar därför inte automatiskt filer till någon extern leverantör och aktiverar ingen schemalagd backup.

## Export från avtalets originalarkiv

**Hämta arkivpaket** är en uttrycklig nedladdning från ett redan registrerat native avtalsarkiv. Servern hämtar och verifierar både PDF och JSON-evidens samt deras signeringskälla enligt [integritetskontrollen](CONTRACT_ARCHIVE_INTEGRITY.md). Aktuella metadata, underlag och behörigheter kontrolleras igen efter paketeringen, före svaret. Saknat eller skadat original ger inget paket och ersätts aldrig av en ny rendering.

Paketet är en okomprimerad POSIX USTAR-fil (`.tar`) med exakt tre vanliga filer:

| Fil | Innehåll |
|---|---|
| `original.pdf` | Arkivets exakta signerade PDF-bytes |
| `evidence.json` | Arkivets exakta signeringsbevis |
| `manifest.json` | Versionsmärkt arkivmetadata och det verifierade färdigsignerade underlaget |

Manifestformatet är `trafexa-contract-archive`, schema 1. PDF får vara högst 50 MiB, evidens 1 MiB och manifest 2 MiB; hela paketet har en absolut gräns på 54 MiB. Inga filer komprimeras eller hämtas via adresser i manifestet. Paketet innehåller personuppgifter och signeringsunderlag och ska förvaras med begränsad åtkomst.

Nedladdningen använder befintlig autentiserad läsåtkomst för ägare, administratör, ekonomi och behörig kontobaserad kund. En superadminroll ger ingen separat åtkomst till företagets avtal. Kontofria dokumentlänkar får ingen ny exportbehörighet. Svaret är privat och får inte mellanlagras. Det strömmas först efter verifieringen, så att större paket inte använder Vercels vanliga gräns för buffrade svar.

Webbläsaren kontrollerar aktuell arkiv-/aktörsbindning och paketets SHA-256 före nedladdningen. Den visade kontrollsumman ska sparas separat från paketet tillsammans med en betrodd referens till rätt avtal. En kontrollsumma som beräknas från en okänd fil eller läses enbart ur samma okända paket är inget fristående äkthetsbevis. En nedladdning bevisar inte att en separat säkerhetskopia har lagrats eller att webbläsaren har skrivit filen permanent på disk.

## Isolerat återställningsprov

Projektets offlineverktyg kräver Node.js 24 och projektets installerade beroenden. Det använder ingen servernyckel, nätverksanslutning eller produktionsdatabas. Kör det i projektroten och använd den kontrollsumma som sparats separat vid den betrodda exporten:

```bash
node scripts/verify-contract-archive-package.mjs \
  --package /saker-plats/avtal.tar \
  --sha256 DEN_SEPARAT_SPARADE_SHA256
```

För att också prova återställning av filerna väljer operatören en ny katalog vars överordnade katalog redan finns:

```bash
node scripts/verify-contract-archive-package.mjs \
  --package /saker-plats/avtal.tar \
  --sha256 DEN_SEPARAT_SPARADE_SHA256 \
  --restore-dir /isolerade-prov/nytt-avtalsprov
```

Verktyget verifierar paketets betrodda yttre hash före TAR-/JSON-tolkning. Det kontrollerar det exakta filformatet, originalens hashvärden och storlekar, PDF-/evidensparet, dokumentversionen och de sparade bekräftelserna. Okända filer, länkar, alternativa sökvägar, dubbletter, extra innehåll, felaktiga storlekar och ofullständiga paket nekas.

Återställning tillåts bara till en ny katalog; befintliga filer, kataloger och symboliska länkar skrivs inte över. Katalogen skapas med rättighet `0700` och filerna med `0600`. Bara de tre fasta filnamnen används. Filerna återläses och jämförs med verifierade bytes innan `restore-proof.json` skrivs. Ett misslyckat filsystemssteg kan lämna ett ofullständigt prov i den nya katalogen; det ger inget lyckat resultat. Kontrollera och hantera ett sådant prov separat.

Detta återställer filer till ett isolerat prov. Det registrerar inte ett nytt original, skriver inte i Supabase Storage och återställer inte företag, konton eller databasmetadata. Produktionsåterställning behöver även betrodd databasbackup, aktuell behörighetskontroll och en separat granskad återställningsrutin.

## Återstående driftbeslut

Nästa driftsteg är val av separat lagringsplats, åtkomst och kryptering, ansvarig driftägare, bevarandetid, backupfrekvens samt kontrollerad återställning i en avskild miljö. En backup av Supabase-databasen omfattar inte Storage-filernas innehåll. Den här exporten ändrar inga bevaranderegler och raderar inga original.

Körda prov och publicering redovisas i [implementationsstatus](IMPLEMENTATION_STATUS.md). Grundarkivets bindningar och begränsningar finns i [NATIVE_CONTRACT_ARCHIVE](NATIVE_CONTRACT_ARCHIVE.md).
