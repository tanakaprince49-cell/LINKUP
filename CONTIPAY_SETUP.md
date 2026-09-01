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
| `CONTIPAY_AUTH_KEY` | ✅ | Issued Auth Key. Basic-auth user. |
| `CONTIPAY_AUTH_SECRET` | ✅ | Issued Auth Secret. Basic-auth password. |
| `CONTIPAY_MERCHANT_ID` | ✅ | Numeric merchant id, e.g. `1234`. |
| `CONTIPAY_WEBHOOK_URL` | ✅ | `https://<host>/api/contipayWebhook` — no secret in the URL. |
| `CONTIPAY_WEBHOOK_TOKEN` | ✅ | See "Webhook security". Configure the same value in ContiPay. |
| `CONTIPAY_SUCCESS_URL` | optional | Where ContiPay sends the browser on success. |
| `CONTIPAY_CANCEL_URL` | optional | Where ContiPay sends the browser on cancel. |
| `CONTIPAY_ENV` | optional | `sandbox` (default) \| `live` |
| `CONTIPAY_BASE_URL` | optional | Overrides the sandbox/live base URL entirely. |
| `CONTIPAY_STATUS_PATH` | optional | Path of the status inquiry endpoint; dormant until set. |

`CONTIPAY_API_KEY` / `CONTIPAY_API_SECRET` are still accepted as aliases so an
existing Vercel project does not break on deploy.

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

**ContiPay's webhook payload contains no signature.** `clientKey` in the body is
just our own Auth Key echoed back, so it is corroboration, never proof.

ContiPay authenticate delivery with a token in the **`Authorization` header**:

```
Authorization: Bearer <CONTIPAY_WEBHOOK_TOKEN>
```

Configure that same token **in the ContiPay workspace**. Their guidance is
explicit that it must never go in the webhook URL — URLs leak into logs, proxy
headers and referrers — so `webhookUrl()` sends the bare URL and nothing else.

The endpoint checks, in order, before touching a single document:

1. the `Authorization: Bearer` header matches `CONTIPAY_WEBHOOK_TOKEN` (constant-time)
2. `clientKey` matches our Auth Key, and `merchantId` matches ours
3. `merchantRef` already exists in `webTransactions`, created by a signed-in
   checkout — a forged webhook cannot invent a reference
4. `currencyCode` matches what we recorded
5. `amount` is not less than what we recorded

Rejections are logged as `[contipayWebhook] rejected: <reason>`.

**Never log the raw body** (it carries `clientKey`, plus the customer's name,
email and cell) **or the `Authorization` header**. Use `redactWebhook()`, which
emits only `contiPayRef`, `merchantRef`, `correlator`, `statusCode`, `status`,
`amount` and `currencyCode` — the fields ContiPay themselves say to log.

## 3b. Status codes

| Code | Meaning | Final? | We do |
|---|---|---|---|
| `1` | PAID | ✅ | Grant the entitlement |
| `3` | ERROR | ✅ | Mark failed |
| `4` | DECLINED | ✅ | Mark failed |
| `0` | PENDING | ❌ | Keep open, wait |
| `6` | QUEUED / SUBMITTED | ❌ | Keep open, wait |
| other | — | ❌ | Record as `review`, never settle |

Only `1`, `3` and `4` settle an order. Treating `0` or `6` as final is the
classic way to mark a real payment as failed while the customer is still
approving a USSD prompt.

## 4. Idempotency

ContiPay retry failed deliveries **up to 10 times over ~24 hours** with
exponential backoff, and may deliver the same transaction more than once.

Two independent guards:

1. **`contipayWebhookEvents/{contiPayRef}`** — claimed inside a Firestore
   transaction, so a replayed delivery is acknowledged and dropped. Keyed on
   ContiPay's own reference, which is what their docs recommend.
2. **`grantWebEntitlement`** re-reads the transaction document inside its own
   Firestore transaction and bails if it is already `paid`.

Top-ups stack (5 months left + 12 purchased = 17). A $1 payment cannot buy a
year (`amount_mismatch`), and a payment in the wrong currency is rejected
(`currency_mismatch`).

Respond **2xx within 10 seconds**, always — including for duplicates. Anything
else triggers another 10 retries of something we already handled.

## 4b. Reconciliation

A webhook can still be delayed even with retries. ContiPay point at a
**transaction status inquiry endpoint** for that; they do not publish its path
in the guides we have, so it is wired through `CONTIPAY_STATUS_PATH` and stays
dormant until you set it. `inquireTransaction()` returns `null` when
unconfigured, and **null means unknown, never "not paid"**.

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
- [ ] A webhook with a wrong **Bearer token** is rejected (Vercel logs show
      `rejected: bad-bearer-token`)
- [ ] A `statusCode: 0` webhook leaves the order `pending`, not `failed`
- [ ] Endpoint responds in under 10 seconds

Sandbox mobile-money test numbers (provider codes in their docs):

| Method | Code | Success | Insufficient | Timeout |
|---|---|---|---|---|
| EcoCash | `EC` | 0771234567 | 0771234568 | 0771234569 |
| TeleCash | `TC` | 0731234567 | 0731234568 | 0731234569 |
| OneMoney | `OM` | 0711234567 | 0711234568 | 0711234569 |
| InnBucks | `IB` | ends 7 | ends 8 | ends 9 |
| Omari | `OC` | OTP `000000` | `111111` | `222222` |

Replay a webhook by hand (note the Bearer header):

```
curl -i -X POST "https://<host>/api/contipayWebhook" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CONTIPAY_WEBHOOK_TOKEN" \
  --data '{"account":"263712123123","amount":19.99,"merchantId":<id>,
    "clientKey":"<your_auth_key>","contiPayRef":1000001,"firstName":"Jane",
    "lastName":"Smith","email":"jane@mail.com","merchantRef":"LKP-...",
    "message":"Payment Success","methodCode":"acquire","currencyCode":"USD",
    "providerCode":"EC","providerName":"EcoCash","correlator":"OC08...",
    "statusCode":1,"status":"paid"}'
```

## 7. Going live

1. Swap in the **live** Auth Key + Auth Secret + merchant id in Vercel.
2. Set `CONTIPAY_ENV=live`.
3. Confirm the webhook URL is live and publicly reachable.
4. Run one real card through, then refund it.
