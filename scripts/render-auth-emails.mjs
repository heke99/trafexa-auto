import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/** Supabase Go templates; placeholders must remain intact in generated HTML. */
export const authEmails = [
  { id: 'confirmation', subject: 'Bekräfta din e-postadress hos Trafexa', heading: 'Välkommen till Trafexa', preview: 'Bekräfta din e-postadress för att slutföra registreringen.', body: 'Bekräfta din e-postadress för att slutföra registreringen av ditt konto hos Trafexa.', cta: 'Bekräfta e-postadress', security: 'Om du inte har skapat ett konto hos Trafexa kan du bortse från detta mejl.' },
  { id: 'recovery', subject: 'Återställ ditt lösenord hos Trafexa', heading: 'Välj ett nytt lösenord', preview: 'Du har begärt att återställa lösenordet till ditt Trafexa-konto.', body: 'Vi har tagit emot en begäran om att återställa lösenordet till ditt konto. Följ länken för att välja ett nytt lösenord.', cta: 'Återställ lösenord', security: 'Om du inte har begärt återställningen kan du bortse från detta mejl. Ditt lösenord ändras först när du själv väljer ett nytt.' },
  { id: 'email_change', subject: 'Bekräfta byte av e-postadress hos Trafexa', heading: 'Bekräfta din e-postadress', preview: 'Bekräfta det begärda bytet av e-postadress för ditt Trafexa-konto.', body: 'En ändring av e-postadressen till <strong>{{ .NewEmail }}</strong> har begärts för ditt konto. Följ länken för att bekräfta ändringen. Du kan behöva bekräfta både den gamla och den nya adressen.', cta: 'Bekräfta ändringen', security: 'Om du inte har begärt ändringen ska du inte klicka på länken. Kontakta oss på info@trafexa.com.' },
  { id: 'invite', subject: 'Du har bjudits in till Trafexa', heading: 'Din inbjudan till Trafexa', preview: 'Du har fått en inbjudan till ett konto hos Trafexa.', body: 'Du har bjudits in till Trafexa. Följ länken för att öppna inbjudan och slutföra åtkomsten till ditt konto.', cta: 'Öppna inbjudan', security: 'Om du inte känner igen inbjudan kan du bortse från detta mejl eller kontakta oss på info@trafexa.com.' },
  { id: 'magic_link', subject: 'Din inloggningslänk till Trafexa', heading: 'Logga in på Trafexa', preview: 'Använd din personliga länk för att logga in på Trafexa.', body: 'Du har begärt en personlig inloggningslänk. Följ länken för att logga in på ditt konto hos Trafexa.', cta: 'Logga in', security: 'Om du inte har begärt en inloggningslänk ska du inte klicka på länken. Du kan bortse från detta mejl.' },
  { id: 'reauthentication', subject: 'Din verifieringskod för Trafexa', heading: 'Bekräfta att det är du', preview: 'Använd verifieringskoden för att bekräfta åtgärden i Trafexa.', body: 'Ange koden nedan i Trafexa för att bekräfta åtgärden. Dela aldrig koden med någon annan.', security: 'Om du inte har begärt en verifieringskod ska du inte använda eller dela den. Kontakta oss om du misstänker obehörig åtkomst.' },
];

export function renderAuthEmail(email) {
  const action = email.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0"><tr><td bgcolor="#195d44" style="border-radius:8px"><a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:16px 24px;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;line-height:24px;text-decoration:none;border-radius:8px">${email.cta}</a></td></tr></table>
<p style="margin:0 0 8px;font-size:16px;line-height:25px;color:#53615a">Om knappen inte fungerar, kopiera länken och klistra in den i webbläsaren:</p>
<p style="margin:0 0 24px;word-break:break-all;overflow-wrap:anywhere;font-size:16px;line-height:25px"><a href="{{ .ConfirmationURL }}" style="color:#195d44;text-decoration:underline">{{ .ConfirmationURL }}</a></p>
<p style="margin:0 0 24px;font-size:16px;line-height:25px;color:#53615a">Länken är personlig och kan bara användas en gång. Om den har gått ut behöver du begära en ny.</p>`
    : '<p style="margin:28px 0;padding:20px;background:#edf4ef;border:1px solid #c4d6ca;border-radius:8px;text-align:center;font-family:Courier New,monospace;font-size:32px;font-weight:700;line-height:40px;letter-spacing:6px;color:#143d2e">{{ .Token }}</p><p style="margin:0 0 24px;font-size:16px;line-height:25px;color:#53615a">Om koden har gått ut behöver du begära en ny.</p>';
  return `<!doctype html>
<html lang="sv" dir="ltr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>${email.subject}</title></head>
<body style="margin:0;padding:0;background:#f5f3ed;color:#183d2f;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%">
<div style="display:none;font-size:1px;line-height:1px;color:#f5f3ed;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">${email.preview}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ed"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #dedfd7;border-radius:12px">
<tr><td style="padding:28px 24px;background:#143d2e;border-radius:12px 12px 0 0"><a href="https://www.trafexa.com" style="color:#ffffff;font-size:28px;font-weight:700;letter-spacing:1px;text-decoration:none">TRAFEXA</a><p style="margin:8px 0 0;color:#e2eee6;font-size:16px;line-height:24px">En samlad arbetsyta för bilhandeln</p></td></tr>
<tr><td style="padding:32px 24px"><h1 style="margin:0 0 20px;color:#183d2f;font-size:26px;line-height:34px;font-weight:700">${email.heading}</h1>
<p style="margin:0 0 16px;color:#33473d;font-size:16px;line-height:26px">${email.body}</p>
${action}
<p style="margin:0;padding-top:24px;border-top:1px solid #e3e7e1;color:#53615a;font-size:16px;line-height:25px">${email.security}</p>
<p style="margin:20px 0 0;color:#33473d;font-size:16px;line-height:25px">Behöver du hjälp? Kontakta <a href="mailto:info@trafexa.com" style="color:#195d44;text-decoration:underline">info@trafexa.com</a>.</p></td></tr>
</table>
<p style="margin:20px 0 0;color:#53615a;font-size:16px;line-height:24px">Trafexa Nordic AB · 556855-4884<br><a href="https://www.trafexa.com/privacy" style="color:#195d44;text-decoration:underline">Integritetspolicy</a></p>
</td></tr></table>
</body></html>
`;
}

export async function writeAuthEmails() {
  const folder = new URL('../supabase/templates/auth/', import.meta.url);
  await mkdir(folder, { recursive: true });
  for (const email of authEmails) await writeFile(new URL(`${email.id}.html`, folder), renderAuthEmail(email));
  await writeFile(new URL('subjects.json', folder), `${JSON.stringify(Object.fromEntries(authEmails.map(({ id, subject }) => [id, subject])), null, 2)}\n`);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await writeAuthEmails();
