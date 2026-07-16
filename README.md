# Tovila — Phase 1 + 2 + 3 MVP

An AI customer-support / order-capture agent for Kenyan online sellers who
currently take orders manually over WhatsApp DMs.

**Phase 1**: a webhook server that receives WhatsApp messages, replies using
Claude, and logs structured orders ("leads") to Postgres.

**Phase 2**: a password-protected web dashboard for demoing the loop to
sellers — conversations, captured leads, and a product/FAQ editor — plus a
seed script so it looks populated before live WhatsApp is even wired up.

**Phase 3**: multi-tenant sellers (a `sellers` table, routed by the WhatsApp
number a message was sent to), a seller switcher in the dashboard, and a
local message simulator so the whole loop can be built and tested without
depending on Meta's WhatsApp verification.

## Stack

- Node.js + Express, EJS for server-rendered views
- WhatsApp Business Cloud API (Meta)
- Anthropic Claude API (tool use for order extraction)
- PostgreSQL + Prisma
- Docker Compose (local Postgres) — or any Postgres, e.g. Supabase

## Folder structure

```
src/
  index.js            Express app entry point (webhook unauthenticated, dashboard behind auth)
  middleware/auth.js   Basic Auth guard for the dashboard
  routes/
    webhook.js         GET/POST /webhook — Meta verification, seller routing, incoming messages
    dashboard.js        Dashboard pages: conversations, leads, product/FAQ editor (per seller)
  agent/
    seller.js          Builds the system prompt from a seller record
    core.js             Calls Claude, runs the create_lead tool loop
  services/
    sellers.js         Seller lookup/update (by id or by whatsapp_number)
    conversation.js    Conversation/message persistence, history + dashboard queries
    leads.js            Lead persistence + dashboard queries
  whatsapp/client.js    Sends replies via the WhatsApp Cloud API
  db/client.js          Prisma client singleton
views/                  EJS templates for the dashboard
public/style.css        Dashboard styling
scripts/
  simulate-message.js   Posts a real Meta-shaped webhook payload to your local server
prisma/
  schema.prisma         sellers / conversations / messages / leads tables
  seed.js                Populates demo sellers + fake conversations/leads
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

**Still blocked on Meta's verification?** Skip straight to [section
2](#2-local-setup) and use the local simulator (section 4) instead — nothing
else in this README depends on Meta being sorted out first.

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
`WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `ANTHROPIC_API_KEY`.
`DATABASE_URL` / `DIRECT_URL` point at your Postgres instance — the defaults
match `docker-compose.yml`; if you're using a pooled provider (e.g. Supabase),
`DATABASE_URL` should be the pooled connection string and `DIRECT_URL` the
direct one (migrations need the direct connection).

Also set `DASHBOARD_USERNAME` and `DASHBOARD_PASSWORD` to whatever
credentials you want to log into the dashboard with during demos — pick
your own values, they don't come from Meta or Anthropic.

If you don't have live WhatsApp working yet (e.g. still waiting on Meta
verification), you can leave `WHATSAPP_ACCESS_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID`
as placeholders — the dashboard, seed script, and simulator (section 4) don't
need them. A failed WhatsApp send is caught and logged as `Would have sent to
WhatsApp: ...` instead of crashing, so the rest of the loop still works.

### 2c. Start Postgres

```sh
docker compose up -d
```

(Skip this if you're pointing `DATABASE_URL`/`DIRECT_URL` at a hosted
Postgres instance instead, e.g. Supabase.)

### 2d. Run migrations

```sh
npx prisma migrate dev --name init
```

This creates the `sellers`, `conversations`, `messages`, and `leads` tables
and generates the Prisma client.

### 2e. Seed demo sellers + fake conversations

```sh
npm run seed
```

This upserts two demo sellers — **Amara Styles** (`254700000001`, boutique
clothing) and **Kiko Jewellery** (`254700000002`, jewellery) — by
`whatsapp_number`, so re-running the script won't clobber catalog/FAQ edits
you've made via the dashboard. It then wipes and recreates a handful of
realistic fake conversations/leads for each seller (a mix of FAQ-only chats
and completed orders), so the dashboard has something to show immediately.

### 2f. Start the server

```sh
npm run dev
```

You should see `Tovila server listening on port 3000`. Keep `ngrok http
3000` running in another terminal (step 1b) if you're testing against real
WhatsApp.

### 2g. Log into the dashboard

Open [http://localhost:3000](http://localhost:3000) and log in with the
`DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` you set in `.env` (your browser
will show a native login prompt — this is HTTP Basic Auth, not a custom
login page).

- The **seller switcher** in the top nav lets you flip between sellers —
  every page (conversations, leads, products) is scoped to whichever seller
  is currently selected.
- **`/`** — conversations for the current seller, most recent first; click
  one to see the full thread
- **`/leads`** — captured orders in a table
- **`/products`** — view/edit the current seller's catalog, delivery fees,
  and FAQs; saves immediately and the agent picks up changes on its very
  next reply (no restart needed)

---

## 3. Test the loop over real WhatsApp

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

## 4. Test the loop locally, without WhatsApp (`scripts/simulate-message.js`)

If Meta's verification is still pending, use the simulator instead — it
POSTs a payload shaped exactly like Meta's real webhook body to your own
`/webhook`, so it exercises the real code path (seller routing, Claude,
lead extraction, DB writes), not a shortcut.

```sh
node scripts/simulate-message.js "<to-seller-number>" "<from-customer-number>" "<message text>"
```

`<to>` must match a seller's `whatsapp_number` (the demo sellers from `npm
run seed` are `254700000001` for Amara Styles and `254700000002` for Kiko
Jewellery). `<from>` is any made-up customer number — reuse the same one
across calls to build up a conversation.

```sh
node scripts/simulate-message.js "254700000001" "254701338496" "Do you have the floral dress in size M?"

node scripts/simulate-message.js "254700000001" "254701338496" "I'll take it, deliver to Kilimani, my name is Jane"

node scripts/simulate-message.js "254700000002" "254709112233" "How much is the beaded necklace?"
```

The script posts the message, waits for the agent's reply to land in the
database, and prints it right there in your terminal — no need to tail the
server logs. It also proves multi-tenant routing: point `<to>` at a
different seller's number and you should see that seller's own catalog/FAQs
reflected in the reply, and the conversation show up under the right seller
in the dashboard. If `WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID` are
still placeholders, the actual WhatsApp send will fail — that's expected and
handled gracefully (logged as `Would have sent to WhatsApp: ...` in the
server's terminal); the reply is saved to the DB either way.

---

## Notes / known MVP limitations

- Text messages only (no images/audio/documents yet).
- No webhook signature verification (`X-Hub-Signature-256`) yet — fine for
  local testing, should be added before any public deployment.
- No real queue — processing happens in an unawaited async function after
  the immediate `200 OK`, which is enough to dodge Meta's retry/duplicate
  behavior at this scale but isn't a durable job queue.
- One "conversation" per (seller, customer phone) pair, open-ended (no
  explicit close/expiry).
- Dashboard auth is a single hardcoded username/password over HTTP Basic
  Auth — fine for screen-sharing a demo over HTTPS (via ngrok), not meant as
  real multi-user or per-seller access control (that's a later phase).
- All sellers currently share one WhatsApp Business number/access token in
  `.env` — routing already keys off the `whatsapp_number` a message was sent
  to, but actually giving each seller their own Meta phone number (and
  sending replies via the matching `phone_number_id`/token) is a later
  phase, once you're onboarding real sellers.
