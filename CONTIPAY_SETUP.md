# ContiPay setup (LINKUP web checkout)

ContiPay is the **web** payment rail. Android still uses Google Play Billing.
Paynow and Dodo Payments have been **removed** — do not reintroduce them.

Web plans are sold as **prepaid terms**, because ContiPay collects one payment
at a time and has no recurring/subscription API.

## Environments

| | Base URL |
|---|---|
| Sandbox | `https://api-uat.contipay.net` |
| Live | `https://api.contipay.net` |

Selected by `CONTIPAY_ENV` (`sandbox` default, `live` to go live).

## 1. Environment variables

Set these **in Vercel** (Project → Settings → Environment Variables). They are
server-side only. Never put them in `mobile/`, never in a `EXPO_PUBLIC_*` var,
never in git.

| Variable | Required | Notes |
|---|---|---|
| `CONTIPAY_API_KEY` | ✅ | Issued API key. Basic-auth user. |
| `CONTIPAY_API_SECRET` | ✅ | Issued API secret. Basic-auth password. |
| `CONTIPAY_MERCHANT_ID` | ✅ | Numeric merchant id, e.g. `1234`. |
| `CONTIPAY_WEBHOOK_URL` | ✅ | `https://<host>/api/contipayWebhook` |
| `CONTIPAY_WEBHOOK_TOKEN` | ⚠️ strongly recommended | See "Webhook security" below. |
| `CONTIPAY_SUCCESS_URL` | optional | Where ContiPay sends the browser on success. |
| `CONTIPAY_CANCEL_URL` | optional | Where ContiPay sends the browser on cancel. |
| `CONTIPAY_ENV` | optional | `sandbox` (default) \| `live` |

Restart/redeploy after changing any of these — they are read per request, but a
running function keeps its old process env until redeployed.

## 2. How a payment flows

1. **Browser** → `POST /api/contipayCheckout` with `{ plan }` and a Firebase ID token.
2. **Server** writes `webTransactions/{reference}` with `status: 'initiated'`
   **before** calling ContiPay, so a timeout can never orphan a payment.
3. **Server** → `PUT {base}/acquire/payment` with `Authorization: Basic <key:secret>`.
   ContiPay replies `{ status: "Pending", redirectUrl, ... }`.
4. **Browser** navigates to `redirectUrl` (ContiPay's hosted page).
5. **ContiPay** → `POST /api/contipayWebhook?token=…` with the final status.
   **This is what grants the entitlement.**
6. **Browser** returns to `CONTIPAY_SUCCESS_URL`; the client calls
   `POST /api/contipayStatus` to confirm and refresh entitlements.

`successUrl` is **not** trusted for granting. Only the webhook grants.

## 3. Webhook security — read this

**ContiPay's webhook payload contains no signature.** The only identity in the
body is `clientKey`, which is our own API key echoed back.

So the endpoint authenticates on:

1. **`CONTIPAY_WEBHOOK_TOKEN`** — a shared secret appended to the webhook URL
   server-side when we build the payload (`webhookUrlWithToken()` in
   `api/_contipay.js`). This is a genuinely unguessable check.
2. **`clientKey` + `merchantId`** — must match ours.
3. **The reference must already exist** in `webTransactions`, created by a
   signed-in user at checkout. A forged webhook cannot invent a reference.

Without (1), anyone who observed a single webhook could replay it and grant
themselves PLUS for free. **Keep the token set.**

Rejections are logged as `[contipayWebhook] rejected: <reason>`.

## 4. Idempotency

A retried webhook cannot extend a term twice. `grantWebEntitlement` re-reads the
transaction document **inside** a Firestore transaction and bails if it is
already `paid`. Top-ups stack (5 months left + 12 purchased = 17).

The webhook also refuses to grant if the paid amount is **less** than the amount
we recorded at checkout (`amount_mismatch`), so a $1 payment cannot buy a year.

## 5. Amounts

Amounts come from `shared/pricing.js` (`WEB_TERMS`) — the same table the mobile
app renders prices from. **Never** hard-code a price in a server file.

## 6. Testing

Use ContiPay's sandbox test cases (their docs → Test Cases) for:
successful payment, declined payment, cancelled payment, and webhook retry.

Checklist:

- [ ] `/api/contipayCheckout` returns a `redirectUrl`
- [ ] Paying in sandbox lands on `CONTIPAY_SUCCESS_URL`
- [ ] Webhook arrives; `webTransactions/{ref}` flips to `paid`
- [ ] `webSubscriptions/{uid}` gains/extends the right tier
- [ ] Replaying the same webhook does **not** extend the term again
- [ ] A webhook with a wrong token is rejected (check Vercel logs)

## 7. Going live

1. Swap in the **live** API key + secret + merchant id in Vercel.
2. Set `CONTIPAY_ENV=live`.
3. Confirm the webhook URL is live and publicly reachable.
4. Run one real card through, then refund it.
