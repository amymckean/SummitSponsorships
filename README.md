# Summit Fastpitch sponsorship site

Static page (`index.html`) plus two Netlify Functions:
- `/api/create-sponsorship`: creates the Stripe Checkout session (Summit levels and donations only).
- `/api/stripe-webhook`: logs paid Summit sponsorships/donations to the "Summit Sponsors" tab through the Apps Script.

## Deploy
1. Push this folder to its own GitHub repo and add it as a new Netlify site (no build command, publish directory `.`).
2. Netlify environment variables:
   - `STRIPE_SECRET_KEY`: same Stripe account as the VBC site
   - `SITE_URL`: this site's address, no trailing slash
   - `STRIPE_WEBHOOK_SECRET`: from step 3
   - `SHEET_WEBHOOK_URL` and `SHEET_WEBHOOK_TOKEN`: same values as on the VBC site
3. Stripe > Developers > Webhooks: add endpoint `https://<new site>/api/stripe-webhook` for `checkout.session.completed` and `checkout.session.async_payment_succeeded`; copy its signing secret into `STRIPE_WEBHOOK_SECRET`.
4. Test a $5 donation: Summit Sponsors tab row, donor email, and notification to info@playsummit.org.
