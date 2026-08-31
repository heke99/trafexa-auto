# Trafexa website

A lightweight B2B vehicle sourcing website for **Trafexa**, operated by **Diversa Nordic AB**.

## Run locally

Static pages can be served with any local web server, for example:

```bash
python3 -m http.server 8000
```

The vehicle request form posts to `/api/inquiry`, which is implemented as a Vercel serverless function.

## Deploy on Vercel

1. Upload this folder to a Git repository or import the folder into Vercel.
2. Add environment variables:
   - `RESEND_API_KEY` — Resend API key.
   - `INQUIRY_TO` — optional, defaults to `hekmat.h@div3rsa.com`.
   - `INQUIRY_FROM` — recommended after verifying trafexa.com in Resend, e.g. `Trafexa <requests@trafexa.com>`.
3. Add `trafexa.com` and `www.trafexa.com` as project domains in Vercel.
4. Configure DNS records as instructed by Vercel.

## Form behavior

If the email service is not configured or unavailable, the website tells the visitor to email `hekmat.h@div3rsa.com` directly.

## Photography

The site uses two remote Unsplash photographs that are marked there as free to use under the Unsplash License. Replace them with your own supplier/dealership photography later for even stronger brand authenticity.
