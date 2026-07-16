# Tovila

An AI customer-support / order-capture agent for Kenyan online sellers who
currently take orders manually over WhatsApp DMs.

- **Phase 1**: a webhook server that receives WhatsApp messages, replies
  using Claude, and logs structured orders ("leads") to Postgres.
- **Phase 2**: a password-protected web dashboard — conversations, leads, a
  product/FAQ editor — plus a seed script so it looks populated before live
  WhatsApp is wired up.
- **Phase 3**: multi-tenant sellers (a `sellers` table, routed by the
  WhatsApp number a message was sent to), a seller switcher in the
  dashboard, and a local message simulator so the loop can be built and
  tested without depending on Meta's WhatsApp verification.
- **Phase 4** (this phase): closes out the remaining gaps between "working
  demo" and "something a real seller can trust" — human escalation, the
  WhatsApp 24h messaging rule, order status updates, faster onboarding,
  webhook security, media handling, conversation lifecycle, a durable job
  queue, Swahili/Sheng handling, M-Pesa payment instructions, basic
  analytics, and rate limiting. Details below.

## Stack

- Node.js + Express, EJS for server-rendered views
- WhatsApp Business Cloud API (Meta)
- Anthropic Claude API (tool use for order extraction + escalation)
- PostgreSQL + Prisma (a DB-backed job queue, no Redis needed at this scale)
- Docker Compose (local Postgres) — or any Postgres, e.g. Supabase
- [Resend](https://resend.com) (optional) for escalation email alerts

## Folder structure

```
src/
  index.js              Express entry point — webhook unauthenticated, dashboard behind auth,
                         starts the job worker + auto-close sweep
  middleware/
    auth.js              Basic Auth guard for the dashboard
    verifySignature.js    Verifies Meta's X-Hub-Signature-256 on incoming webhooks
  routes/
    webhook.js           GET/POST /webhook — Meta verification, signature check, enqueues jobs
    dashboard.js          Dashboard pages: conversations, leads, products, onboarding, stats
  agent/
    seller.js            Builds the system prompt from a seller record
    core.js               Calls Claude, runs the create_lead + flag_for_human tool loop
  jobs/
    queue.js              enqueue/claim/complete/fail — the DB-backed job queue
    worker.js              Polls and dispatches jobs
    autoClose.js            Sweeps inactive conversations closed every 15 min
    handlers/processInboundMessage.js   The actual per-message logic (moved off the request cycle)
  services/
    sellers.js            Seller lookup/create/update
    conversation.js       Conversation/message persistence, history, dashboard queries
    leads.js               Lead persistence + status/paid updates
    messagingWindow.js      24h WhatsApp messaging-window check
    orderNotifications.js   Composes + sends customer-facing order status updates
    notifications.js        needs_attention notifications (DB + optional Resend email)
    rateLimit.js             Per-phone-number rate limiting
    stats.js                  Per-seller analytics
  whatsapp/
    client.js              Sends free-form replies via the WhatsApp Cloud API
    templates.js            Template-message stub (for outside the 24h window)
  db/client.js            Prisma client singleton
views/                    EJS templates for the dashboard
public/style.css          Dashboard styling
scripts/
  simulate-message.js     Posts a real Meta-shaped webhook payload to your local server
  test-conversations.js    Batch of realistic Swahili/Sheng test messages
  lib/webhookSimulator.js  Shared helpers for both scripts above
prisma/
  schema.prisma           sellers / conversations / messages / leads / notifications / jobs
  seed.js                  Populates demo sellers + fake conversations/leads
docker-compose.yml         Local Postgres
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
6. Your app's **App Secret** (Settings → Basic) is needed for
   `WHATSAPP_APP_SECRET` (webhook signature verification, section 2b).

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
     `WHATSAPP_VERIFY_TOKEN` in your `.env` (see step 2b below)
3. Click **Verify and save**. Meta will hit your `GET /webhook` — this only
   works once your server (step 2f below) is already running and the ngrok
   tunnel is live.
4. Under **Webhook fields**, subscribe to **messages**.

### 1d. Get an Anthropic API key

Create one at [console.anthropic.com](https://console.anthropic.com/) if you
don't already have one.

### 1e. (Optional) Get a Resend API key

Only needed if you want email alerts when a conversation is flagged
`needs_attention` (section 3, item 1). Skip this entirely and you still get
a DB record + console log for every escalation — email is a pure add-on.
Sign up at [resend.com](https://resend.com) if you want it.

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

Fill in `.env` with the values from step 1:

- `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`
- `WHATSAPP_APP_SECRET` — verifies incoming webhooks are genuinely from Meta
  (`X-Hub-Signature-256`). Set `VERIFY_WEBHOOK_SIGNATURE=false` to bypass
  this locally if you haven't set the secret yet —
  `scripts/simulate-message.js` signs its requests for real when the secret
  IS set, so you can test the real verification path without live WhatsApp.
- `ANTHROPIC_API_KEY`
- `RESEND_API_KEY` (optional, see 1e)

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

This creates all the tables (`sellers`, `conversations`, `messages`,
`leads`, `notifications`, `jobs`) and generates the Prisma client.

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

You should see `Tovila server listening on port 3000`, plus the job worker
and auto-close sweep starting up. Keep `ngrok http 3000` running in another
terminal (step 1b) if you're testing against real WhatsApp.

### 2g. Log into the dashboard

Open [http://localhost:3000](http://localhost:3000) and log in with the
`DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` you set in `.env` (your browser
will show a native login prompt — this is HTTP Basic Auth, not a custom
login page — see item 13 below for why this stays as-is for now).

The **seller switcher** in the top nav flips between sellers — every page is
scoped to whichever seller is currently selected.

- **`/`** — conversations, most recent first, `needs_attention` ones pinned
  to the top with a badge; click one for the full thread, the 24h messaging
  window state, and (if flagged) a "Mark resolved" button
- **`/leads`** — captured orders: inline status dropdown
  (pending/confirmed/shipped/delivered/cancelled — changing it notifies the
  customer over WhatsApp) and a "Mark paid" toggle
- **`/products`** — view/edit the current seller's catalog, delivery fees,
  M-Pesa Till Number, notification email, and FAQs; saves immediately, the
  agent picks up changes on its very next reply
- **`/onboarding`** — add a new seller (name, WhatsApp number, delivery
  info, initial products/FAQs) without touching the database
- **`/stats`** — total conversations, leads captured, average response
  time, messages this week/month

---

## 3. What's new in Phase 4

1. **Human handoff/escalation** — the agent has a `flag_for_human` tool
   (alongside `create_lead`) it calls for complaints, custom/negotiated
   pricing requests, frustration, or genuine uncertainty, replying to the
   customer with a brief honest line instead of guessing. The conversation
   is marked `needs_attention` (pinned to the top of the dashboard), and a
   `Notification` row + console log always fire; an email additionally
   sends via Resend if `RESEND_API_KEY` and the seller's notification email
   are both set. Further messages on a flagged conversation get a fixed
   holding reply (no fresh Claude call) until you click "Mark resolved".
2. **24h WhatsApp messaging window** — `services/messagingWindow.js` tracks
   whether a conversation is still within Meta's 24h customer-initiated
   window, shown on the conversation detail page. Outside that window,
   free-form text isn't allowed by WhatsApp — `whatsapp/templates.js` has
   the real template-message request shape ready to go with one example
   config, but actually **delivering** a template requires an
   **approved template in Meta Business Manager**, which needs the same
   Business verification you may still be waiting on. Until then it will
   4xx against the real Graph API, same as any other placeholder-credential
   call in this app.
3. **Order status updates** — leads have a fuller status lifecycle
   (pending/confirmed/shipped/delivered/cancelled) plus a `paid` flag,
   editable from `/leads`. Status changes to confirmed/shipped/delivered/
   cancelled automatically message the customer (free text inside the 24h
   window, the template stub above outside it).
4. **Seller onboarding** — `/onboarding` replaces manual DB edits for adding
   a seller.
5. **Webhook signature verification** — `X-Hub-Signature-256` is checked
   before any processing; see `WHATSAPP_APP_SECRET`/
   `VERIFY_WEBHOOK_SIGNATURE` above.
6. **Media messages** — images/audio/video/documents/etc. get saved (with
   Meta's media type/id, shown as a badge in the dashboard) and a sensible
   canned reply ("could you describe that in text for now?") instead of
   being ignored or crashing the handler. Actually understanding media
   content is still out of scope.
7. **Conversation lifecycle** — conversations are `open`, `needs_attention`,
   or `closed`. A background sweep closes `open` conversations with no
   activity in 24h (never touching `needs_attention` ones); any new message
   reopens a closed conversation rather than starting a fresh one.
8. **Durable job queue** — webhook processing moved off the request/response
   cycle entirely. `POST /webhook` verifies the signature, enqueues a row in
   the `jobs` table, and returns 200 immediately; a worker polls every 2s,
   retries failures with backoff (up to 5 attempts before giving up), and
   reclaims jobs abandoned by a crashed worker (stuck in `processing` for
   over 2 minutes). Chose a DB-backed queue over BullMQ+Redis — no extra
   infra to run at this scale, and it's a straightforward swap later if
   volume ever justifies it. Retries are idempotent against Meta's own
   message id, so a retried or redelivered message never gets
   double-processed or double-replied-to.
9. **Swahili/Sheng handling** — the system prompt explicitly tells the agent
   to reply in whichever language/mix the customer used.
   `scripts/test-conversations.js` fires a batch of realistic mixed-language
   test messages (including two that should escalate) through the real
   pipeline for manual review — needs a real `ANTHROPIC_API_KEY` to actually
   see reply quality, not just pipeline mechanics.
10. **M-Pesa** — the seller's Till Number is injected into the system prompt
    as a dedicated PAYMENT section, so order confirmations reliably state it
    (rather than hoping the model extracts a number that was never actually
    present in free-text FAQ data). Full STK push / Daraja integration is
    out of scope — payment is manual, confirmed via the "Mark paid" toggle.
11. **Basic analytics** — see `/stats` above.
12. **Rate limiting** — max 20 customer messages/hour per raw phone number
    (across all sellers), checked before any Claude call. Over the cap, the
    message is still saved but no reply is generated — logged clearly so
    you can see if it's happening.
13. **Dashboard auth** — deliberately left as a single hardcoded username/
    password over HTTP Basic Auth. Fine for one person demoing over HTTPS
    (via ngrok); real multi-user/per-seller access control is a later phase.

---

## 4. Test the loop over real WhatsApp

From the WhatsApp number you added as a recipient (step 1a), message your
test number:

> Hi, do you have the floral dress in size M?

You should get a natural reply back (price, size, stock) generated by
Claude. Then follow up:

> I'll take it, deliver to Kilimani, my name is Jane

Claude should confirm the order (including the M-Pesa Till Number) in the
reply, and a new row should appear in the `leads` table — refresh the
dashboard's `/leads` page (or the conversation thread) to see it show up.
Try changing its status to "shipped" and watch a WhatsApp update go out.

Inspect the raw tables any time with:

```sh
npx prisma studio
```

(opens a browser UI at http://localhost:5555).

---

## 5. Test the loop locally, without WhatsApp

If Meta's verification is still pending, use the simulator instead — it
POSTs a payload shaped exactly like Meta's real webhook body to your own
`/webhook`, so it exercises the real code path end to end (signature check,
seller routing, the job queue, Claude, lead extraction, DB writes), not a
shortcut.

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
database, and prints it right there in your terminal. It also proves
multi-tenant routing: point `<to>` at a different seller's number and
you should see that seller's own catalog/FAQs reflected in the reply. If
`WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID` are still placeholders,
the actual WhatsApp send will fail — that's expected and handled gracefully
(logged as `Would have sent to WhatsApp: ...`); the reply is saved to the DB
either way.

For a batch of realistic Swahili/Sheng test messages (including two that
should trigger escalation), run:

```sh
node scripts/test-conversations.js
```

---

## Notes / known limitations

- Full media understanding (actually looking at images, listening to
  audio) is out of scope — media messages get a sensible canned reply, not
  real comprehension.
- Template messages (for outside the 24h window) have the real request
  shape wired up but need an **approved template in Meta Business
  Manager** to actually deliver — blocked on the same verification as live
  WhatsApp generally.
- M-Pesa payment is instruction-only (Till Number in the confirmation,
  manual "Mark paid" toggle) — no STK push / Daraja API integration.
- All sellers currently share one WhatsApp Business number/access token in
  `.env` — routing already keys off the `whatsapp_number` a message was
  sent to, but giving each seller their own Meta phone number (and sending
  via the matching `phone_number_id`/token) is a later phase, once you're
  onboarding real sellers.
- Dashboard auth is intentionally a single hardcoded login (item 13 above)
  — not being revisited at this stage.
