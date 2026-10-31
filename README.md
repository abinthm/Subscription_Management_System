# Brightloop — Subscription Management System

One platform for the full life of a subscription business: products and plans, quotations, subscriptions, automatic recurring invoices, payments, and a live finance dashboard.

**Stack:** Node.js + Express 5 · PostgreSQL (raw SQL with `pg`, no ORM) · React 18 + Vite · Server-Sent Events for live updates.
Runtime dependencies are kept to five: `express`, `pg`, `nodemailer`, `react`, `react-router-dom`. Password hashing (scrypt), tokens, validation, cookies, and real-time updates use Node built-ins or our own code.

## Quick start

Requirements: Node 22+, PostgreSQL 14+.

```bash
createdb subscriptions
createdb subscriptions_test          # used by the test suite

cd server
cp .env.example .env
npm install
npm run seed                         # schema + demo data (2,500 subscriptions)
npm run dev                          # API on http://localhost:4000

cd ../client
npm install
npm run dev                          # UI on http://localhost:5173
```

| Role     | Email                   | Password        |
|----------|-------------------------|-----------------|
| Admin    | admin@brightloop.io     | `Admin@1234`    |
| Staff    | staff@brightloop.io     | `Staff@1234`    |
| Customer | customer@brightloop.io  | `Customer@1234` |

Without SMTP settings, emails (password reset links, invoices) are printed to the API console.

Production: `cd client && npm run build`, then `cd server && npm start` serves the API and the built UI from one port.

Tests: `cd server && npm test` (pricing engine unit tests + billing integration tests against `subscriptions_test`).

## Architecture

```
server/src
├── app.js, server.js, jobs.js     HTTP app, entry point, hourly billing/expiry job
├── config.js                      all environment configuration
├── db/                            pool + transaction helper, migrations, seed
├── lib/                           framework-free logic: validation, pricing, dates, errors, mail, events
├── middleware/                    session auth + role guards, rate limiting, error mapping
└── modules/<feature>/
    ├── routes.js                  HTTP: validate input, check role, call service, publish event
    └── service.js                 business rules + SQL, no req/res
client/src
├── api/                           fetch wrapper with typed errors
├── hooks/                         auth, live updates, data fetching, URL filters, toasts
├── components/                    shared UI kit, layout, line editor
└── pages/                         one folder per feature
```

Each request goes **route → validate → service → SQL**. Services never see `req`/`res`, so billing runs the same way from an HTTP call or the scheduler.

### Key decisions

- **The database enforces the invariants.** Enums for every status, `CHECK` constraints on money, dates, percentages and usage limits, `citext` unique emails, and a partial unique index `invoices(subscription_id, period_start) WHERE status <> 'cancelled'`, so nothing can be billed twice even if two billing runs race.
- **Billing is idempotent and isolated.** Each subscription is invoiced in its own transaction under `SELECT … FOR UPDATE`. Periods are computed from `start_date + n × period` (no month-end drift), and missed periods are caught up. One failing subscription never blocks the rest.
- **Prices are computed server-side.** Unit price = product price + variant extra. Clients send only product, variant and quantity. Money is calculated in integer cents; discounts are spread proportionally across lines so tax applies to the discounted amount.
- **Discounts apply themselves.** A discount attached to a subscription is checked on every invoice (date window, usage limit, minimum amount/quantity, product scope), counted when used, and given back if the invoice is cancelled.
- **Security.** Sessions are random 256-bit tokens stored as SHA-256 hashes in an `httpOnly`, `SameSite=Lax` cookie. Passwords use scrypt with per-user salt. Reset tokens are single-use, hashed, and expire after 30 minutes; a reset revokes all sessions. Auth endpoints are rate limited, and every query is parameterised. Customers are scoped to their own records in the service layer, and other customers' records return 404 rather than 403.
- **Real time without a library.** Mutations publish a tiny `{topic, id}` event over SSE. Clients re-fetch through the normal authorised API, so no data leaks through the event stream.
- **Performance.** Paginated lists use `count(*) OVER()` (one round trip), indexes cover every filter, and the billing scan uses a partial index. With the seeded 2,500 subscriptions and 5,000 invoices, the dashboard summary returns in about 30 ms and lists in about 20 ms.

### Subscription lifecycle

`draft → quotation → confirmed → active ⇄ paused → closed`. Pause, renew and early close are allowed per plan. Plans with `auto_close` close automatically at expiry. Confirmed subscriptions activate on their start date. Quotations expire after their template's validity window.

### Roles

| Capability                                    | Admin | Staff | Customer |
|-----------------------------------------------|:-----:|:-----:|:--------:|
| Products, plans, taxes, discounts             | ✔     | view  |          |
| Add staff / admins                            | ✔     |       |          |
| Customers, subscriptions, templates, invoices, payments | ✔ | ✔ |    |
| Own subscriptions, invoices, payments         |       |       | ✔        |
| Accept quote, pause / resume / renew / close (if plan allows) | ✔ | ✔ | ✔ |
