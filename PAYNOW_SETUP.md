# Paynow (Zimbabwe) — LINKUP web checkout

Sell LINKUP PLUS and Campaigns to **web** users through Paynow.

## Credentials

| | |
|---|---|
| Company | LINKUP |
| Payment Link | LINKUP |
| Integration ID | `26570` |
| Integration Key | in `.env` — server-side only |

Stored locally in `.env`, which is **gitignored** (`.env*`) and is therefore
never committed. In production these live in
**Vercel → Project → Settings → Environment Variables**.

> ⚠️ **Rotate this key.** It has been pasted into a chat window. Do that once
> the integration is verified end-to-end: Paynow → integration → regenerate key,
> then update `.env` and the Vercel env var.

## Set these four vars in Vercel

```
PAYNOW_INTEGRATION_ID   = 26570
PAYNOW_INTEGRATION_KEY  = <the key>
PAYNOW_RETURN_URL       = https://linkup-muqu.vercel.app/paynow/return
PAYNOW_RESULT_URL       = https://linkup-muqu.vercel.app/api/paynowWebhook
```

`RETURN_URL` is where the browser lands after the customer finishes.
`RESULT_URL` is the server-to-server callback that actually grants access.

---

## The model: prepaid terms, not subscriptions

**Paynow has no recurring-billing API.** There is an unresolved thread on
Paynow's own support forum (Nov 2025) from a developer asking exactly this for
a SaaS subscription product; Paynow's support told him recurring payments are
not supported.

So web plans are **prepaid terms** — one payment, fixed window, no auto-renew:

| Plan key | What it is | Price |
|---|---|---|
| `plus_1m` | LINKUP PLUS — 1 month | $19.99 |
| `plus_3m` | LINKUP PLUS — 3 months | $49.99 |
| `plus_12m` | LINKUP PLUS — 12 months | $149.99 |
| `campaigns_1m` | LINKUP Campaigns — 1 month | $29.99 |
| `campaigns_12m` | LINKUP Campaigns — 12 months | $249.99 |

Topping up **stacks** — buying 3 months twice gives 6 months, it does not
reset. See `extendFrom()` in `api/_paynow.js`.

The upside beyond Paynow's limits: you get the cash up front instead of
waiting on monthly renewals, and there is no involuntary churn from failed
recurring charges.

---

## How a payment flows

```
web app  --POST /api/paynowCheckout { plan }-->  Vercel fn
                                                   | create paynowTransactions/{ref} (status: initiated)
                                                   | POST paynow.co.zw/interface/initiatetransaction
         <---------- { redirectUrl } --------------+
   |
   +--> browser goes to Paynow, customer pays (EcoCash / bank / card)
   |
Paynow --POST /api/paynowWebhook (result URL)--->  Vercel fn
                                                   | verify hash with Integration Key
                                                   | mark paynowTransactions/{ref} paid
                                                   | extend webSubscriptions/{uid}.endsAt
   |
   +--> browser returns to /paynow/return?...
        app calls /api/paynowStatus { reference } as the safety net
```

**Three endpoints**

- `api/paynowCheckout.js` — authenticated, creates the payment, returns the
  redirect URL
- `api/paynowWebhook.js` — Paynow's result URL, grants the entitlement
- `api/paynowStatus.js` — client polls this after returning; if the webhook
  has not landed it asks Paynow directly via the poll URL and then grants

`paynowStatus` exists because **Paynow's webhook is not reliably delivered**.
Never rely on the webhook alone.

---

## Security

- **The Integration Key never reaches the client.** All three endpoints are
  Vercel serverless functions; the key is read from `process.env` at call time.
- **Every webhook is hash-verified before any state changes.** Without this,
  anyone could POST `reference=...&status=Paid` and grant themselves PLUS for
  free. See the check at the top of `api/paynowWebhook.js`.
- **Both Firestore collections are server-write only:**
  `paynowTransactions` and `webSubscriptions` are `allow write: if false`.
  Clients can read their own records; only Firebase Admin (through the API)
  can write them.
- Granting is **idempotent** — a retried webhook cannot extend a term twice.
- The webhook always returns `200`. A non-2xx makes Paynow retry a payment we
  may already have granted, and a retry cannot fix anything from their side.

### A note on the official SDK

The hash here was verified byte-identical to the official `paynow` npm SDK.
Do not copy the SDK's `additionalinfo` handling: it concatenates `"title, "`
per cart item then calls `substr(0, len - 3)` — 3 instead of 2 — silently
chopping the last character off your description. That is a bug in the SDK,
not a Paynow requirement `api/_paynow.js` sends the full string.

---

## Verify the credentials

From your own machine (needs network access to `paynow.co.zw`):

```bash
node scripts/verify-paynow.mjs
```

It initiates a real **$0.01** transaction. Nothing is charged unless someone
completes the payment — it only proves Paynow accepts the ID and key.

If it reports a rejection, the most likely cause is that the account is still
in **sandbox** (your Visa/Mastercard rows showed as `inactive`). Email
**support@paynow.co.zw** with your KYC documents.

---

## Still to decide: gating the web app

The plumbing above records and serves entitlements, but **web is still free**.
`hasLinkupPro()` in `mobile/src/lib/paywall.ts` returns `true` whenever
`Platform.OS === 'web'`, so web users bypass every gate and every free limit.

I have not flipped that, because it changes who gets locked out and deserves
an explicit call:

1. Load `webSubscriptions/{uid}` into auth state (new hook/context).
2. Replace the `Platform.OS === 'web' ? true : ...` shortcut with a real check
   against the web entitlement.
3. Give web users the same `FREE_LIMITS` as mobile until they have paid.
4. Point the web paywall at Paynow instead of Google Play.

Until step 2 lands, charging web users is not enforceable — someone could just
use the app without paying. Say the word and I'll wire it.

**Google Play policy:** do not link from inside the Android app to this web
checkout. Web billing is fine; steering Play users to it is not.
