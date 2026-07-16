# Tovila — Phase 1 + 2 MVP

An AI customer-support / order-capture agent for Kenyan online sellers who
currently take orders manually over WhatsApp DMs.

**Phase 1**: a webhook server that receives WhatsApp messages, replies using
Claude, and logs structured orders ("leads") to Postgres — end to end, for
one hardcoded demo seller ("Amara Styles").

**Phase 2**: a password-protected web dashboard for demoing the loop to
sellers — conversations, captured leads, and a product/FAQ editor — plus a
seed script so it looks populated before live WhatsApp is even wired up.

## Stack

- Node.js + Express, EJS for server-rendered views
- WhatsApp Business Cloud API (Meta)
- Anthropic Claude API (tool use for order extraction)
- PostgreSQL + Prisma
- Docker Compose (local Postgres)

## Folder structure

```
src/
  index.js            Express app entry point (webhook unauthenticated, dashboard behind auth)
  middleware/auth.js   Basic Auth guard for the dashboard
  routes/
    webhook.js         GET/POST /webhook — Meta verification + incoming messages
    dashboard.js        Dashboard pages: conversations, leads, product/FAQ editor
  agent/
    seller.js          Builds the system prompt from data/seller.json
    core.js             Calls Claude, runs the create_lead tool loop
  data/
    seller.json        Demo seller catalog/FAQs — editable via the dashboard
    sellerStore.js      Read/write helpers for seller.json
  services/
    conversation.js    Conversation/message persistence, history + dashboard queries
    leads.js            Lead persistence + dashboard queries
  whatsapp/client.js    Sends replies via the WhatsApp Cloud API
  db/client.js          Prisma client singleton
views/                  EJS templates for the dashboard
public/style.css        Dashboard styling
prisma/
  schema.prisma         conversations / messages / leads tables
  seed.js                Populates fake demo conversations/leads
docker-compose.yml       Local Postgres
```

---

## 1. Manual setup (things only you can do)

### 1a. Get a WhatsApp test number from Meta for Developers

1. Go to [developers.facebook.com](https://developers.facebook.com/) and log
   in / create an account.
2. Click **My Apps → Create App**. Choose the **"Business"** app type.
3. In your new app's dashboard, find **WhatsApp** in the product list and
   click **Set up**.
4. Meta gives you a **test phone number** for free, plus a **temporary
   access token** (valid ~24h) — good enough for this MVP. Note down:
   - **Phone number ID** (shown on the WhatsApp → API Setup page)
   - **Temporary access token** (same page)
   - Add a personal WhatsApp number as a **recipient** on that same page (test
     numbers can only message pre-approved recipients) — you'll need this to
     actually test.
5. (Optional, for longer-lived testing) Generate a **permanent access token**
   via a System User in Meta Business Settings instead of the 24h temporary
   one — not required to get the loop working.

### 1b. Expose your local server with ngrok

Meta needs a public HTTPS URL to send webhook events to. For local dev, use
[ngrok](https://ngrok.com/):

```sh
ngrok http 3000
```

Copy the `https://....ngrok-free.app` URL it gives you — you'll use
`https://....ngrok-free.app/webhook` as the webhook URL in the next step.

### 1c. Configure the webhook in the Meta App Dashboard

1. In your app, go to **WhatsApp → Configuration**.
2. Under **Webhook**, click **Edit** and enter:
   - **Callback URL**: `https://<your-ngrok-domain>/webhook`
   - **Verify token**: any string you make up — put the *same* string in
     `WHATSAPP_VERIFY_TOKEN` in your `.env` (see step 3 below)
3. Click **Verify and save**. Meta will hit your `GET /webhook` — this only
   works once your server (step 4 below) is already running and the ngrok
   tunnel is live.
4. Under **Webhook fields**, subscribe to **messages**.

### 1d. Get an Anthropic API key

Create one at [console.anthropic.com](https://console.anthropic.com/) if you
don't already have one.

---

## 2. Local setup

### 2a. Install dependencies

```sh
npm install
```

### 2b. Configure environment variables

```sh
cp .env.example .env
```

Fill in `.env` with the values from step 1: `WHATSAPP_ACCESS_TOKEN`,
`WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `ANTHROPIC_API_KEY`. The
`DATABASE_URL` default already matches `docker-compose.yml`, no changes
needed unless you customize it.

Also set `DASHBOARD_USERNAME` and `DASHBOARD_PASSWORD` to whatever
credentials you want to log into the dashboard with during demos — pick
your own values, they don't come from Meta or Anthropic.

If you don't have live WhatsApp working yet (e.g. still waiting on Meta
verification), you can leave `WHATSAPP_ACCESS_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID`
as placeholders for now — the dashboard and seed script don't need them.

### 2c. Start Postgres

```sh
docker compose up -d
```

### 2d. Run migrations

```sh
npx prisma migrate dev --name init
```

This creates the `conversations`, `messages`, and `leads` tables and
generates the Prisma client.

### 2e. (Optional) Seed fake demo data

If live WhatsApp isn't wired up yet, or you just want the dashboard to look
populated immediately:

```sh
npm run seed
```

This wipes any existing conversations/messages/leads and inserts 4
realistic fake conversations for "Amara Styles" (a mix of FAQ-only chats and
completed orders). Safe to re-run any time — it's idempotent.

### 2f. Start the server

```sh
npm run dev
```

You should see `Tovila server listening on port 3000`. Keep `ngrok http
3000` running in another terminal (step 1b) so Meta can reach it.

### 2g. Log into the dashboard

Open [http://localhost:3000](http://localhost:3000) and log in with the
`DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` you set in `.env` (your browser
will show a native login prompt — this is HTTP Basic Auth, not a custom
login page).

- **`/`** — conversations, most recent first; click one to see the full
  thread
- **`/leads`** — captured orders in a table
- **`/products`** — view/edit the demo seller's catalog, delivery fees, and
  FAQs; saves immediately and the agent picks up changes on its very next
  reply (no restart needed)

---

## 3. Test the loop

From the WhatsApp number you added as a recipient (step 1a), message your
test number:

> Hi, do you have the floral dress in size M?

You should get a natural reply back (price, size, stock) generated by
Claude. Then follow up:

> I'll take it, deliver to Kilimani, my name is Jane

Claude should confirm the order in the reply, and a new row should appear in
the `leads` table — refresh the dashboard's `/leads` page (or the
conversation thread at `/conversations/:id`) to see it show up. You can also
inspect the raw tables with:

```sh
npx prisma studio
```

(opens a browser UI at http://localhost:5555).

---

## Notes / known MVP limitations

- Single hardcoded seller ("Amara Styles") — multi-tenant sellers come in a
  later phase.
- Text messages only (no images/audio/documents yet).
- No webhook signature verification (`X-Hub-Signature-256`) yet — fine for
  local testing, should be added before any public deployment.
- No real queue — processing happens in an unawaited async function after
  the immediate `200 OK`, which is enough to dodge Meta's retry/duplicate
  behavior at this scale but isn't a durable job queue.
- One "conversation" per phone number, open-ended (no explicit close/expiry).
- Dashboard auth is a single hardcoded username/password over HTTP Basic
  Auth — fine for screen-sharing a demo over HTTPS (via ngrok), not meant as
  real multi-user access control.
- The product/FAQ editor edits `src/data/seller.json` directly on disk, not
  a database table — matches the single hardcoded seller for now; a later
  phase will move this to Postgres once sellers are multi-tenant.
