# Moringa Grove

A responsive promotional site with a small Node.js backend and a private content editor.

## Run locally

1. Install Node.js 18 or newer.
2. Run `npm install`.
3. Copy `.env.example` to `.env` and set a unique `ADMIN_USERNAME`, a strong `ADMIN_PASSWORD`, and a random `SESSION_SECRET` (at least 32 characters).
4. Run `npm start` and open `http://localhost:3000`. Sign in to `/admin` to edit the live homepage content.

Homepage content, gallery photo details, and inquiry submissions are stored in MongoDB. Uploaded photo files remain in `data/gallery/`.

Set `MONGODB_URI` in `.env` to your MongoDB connection string. `MONGODB_DATABASE` selects the database and defaults to `moringa`.

On the first start against an empty MongoDB database, the app imports any legacy `content.json`, `gallery.json`, and `inquiries.jsonl` data. The source files are left untouched. Uploaded photo files remain in `data/gallery/`, so keep that directory on durable storage and back it up separately.

## Gallery photos

Sign in at `/admin`, then choose **Manage gallery**, or open `/admin/gallery` directly. Upload up to five gallery files at a time: JPG, PNG, or WebP photos (5 MB each) and one MP4 or WebM video clip (up to 25 MB). Gallery items are published immediately on the homepage and at `/gallery`; removing an item in the admin gallery removes it from both.

The homepage shows up to three uploaded items in an expandable accordion row on desktop, with a regular card layout on mobile. The full `/gallery` page keeps a standard responsive grid.

## Notifications

Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, and `ADMIN_EMAIL` to email new inquiries and admin password reset links. Each inquiry sends a notification to `ADMIN_EMAIL` and an acknowledgment to the sender. For Gmail, use `smtp.gmail.com` on port `587`, set `SMTP_USER` and `SMTP_FROM` to the sending address, and use a Google App Password for `SMTP_PASSWORD` (not the normal account password). Twilio SMS alerts are optional; set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`, and `OWNER_PHONE`.

The public inquiry form accepts a 10-digit mobile number and a valid email address; both the browser and server validate these fields.

Admin and gallery sign-in require a short-lived, one-time CAPTCHA code; use the refresh button to request a new code. The admin login supports an optional 30-day signed session. **Forgot password?** emails a one-time reset link that expires after 30 minutes. Set `APP_BASE_URL` to the site's public origin (HTTPS in production) so reset links point to the right site. On first startup, `ADMIN_PASSWORD` is hashed with scrypt and initialized in MongoDB; after that, password resets update the stored hash. Plaintext passwords and reset tokens are not stored in MongoDB.

For local testing without an email account, set `EMAIL_MODE=log` in `.env` and restart the app. In development this saves the inquiry and prints clearly marked email previews to the server console; it does not send emails. This mode is disabled in production.

The inquiry is recorded in MongoDB before notifications are attempted. If a provider is not configured or is temporarily unavailable, the inquiry remains safely stored in MongoDB; provider errors are written to the server log.

## Deployment notes

Serve this app over HTTPS in production, set `NODE_ENV=production`, and configure a durable MongoDB deployment. The gallery files still require a durable writable volume at `data/gallery/`. The public site uses externally hosted Unsplash images and Google Fonts. Set MongoDB, SMTP, `APP_BASE_URL`, and initial admin credentials through the hosting provider's secret manager; never commit `.env`.

The included CMS supports orchard copy, up to five hero slides, and up to eight benefit highlights. Admin sessions are HTTP-only, signed, and expire after eight hours unless “Remember me” is selected, extending the session to 30 days. CAPTCHA challenges are held in memory, so multi-instance deployments need sticky routing or shared challenge storage, as well as a shared session secret.

## Hindi translation

The **Translate** dropdown in the page header switches the public pages and admin interface between Hindi and English; the choice is remembered in the browser. Translation uses the unofficial Google Translate endpoint through `@vitalets/google-translate-api`, so an internet connection is required and the provider may rate-limit requests. The backend batches text, retries temporary network failures, and reports provider throttling separately. Only displayed text and accessibility labels are sent for translation; form field values are not.

## Tests

Run `npm test` for validation coverage of content, inquiry input, admin session signing, database migration, and translation request limits.
