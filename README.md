# BridgerPay International Card Velocity Tool

A Next.js tool for BridgerPay orchestrator reports.

## What it does
- Filters for **international card traffic**
  - keeps `paymentMethod = credit_card`
  - excludes `Confirmo` and `PayPal` by default
- Shows:
  - velocity spikes
  - retry behavior
  - fraudulent activity patterns
  - high-risk entities
  - decline analysis
  - flagged transactions export

## Main logic
### International card filter
The default filter keeps all rows where:
- `paymentMethod = credit_card`
- `pspName` is **not** `Confirmo`
- `pspName` is **not** `PayPal`

### Retry detection
Retry groups are mainly identified by:
1. `merchantOrderId`
2. fallback to `transactionId`
3. fallback to `email + amount + currency + pspName`

### Fraud / risk scoring
The tool raises scores for:
- high transaction velocity
- very high decline ratio
- fraud / risk decline reasons
- repeated 3DS / authentication issues
- repeated small-amount attempts
- multiple card fingerprints
- multiple IPs
- cross-country attempts

## Local run
```bash
npm install
npm run dev
```

## Deploy to Vercel through GitHub
1. Create a new GitHub repository.
2. Upload all project files to the repo.
3. Go to Vercel.
4. Import the GitHub repository.
5. Framework preset should be detected as **Next.js**.
6. Click **Deploy**.

## Files to edit later
- `lib/analyze.ts` → core logic
- `app/page.tsx` → UI and upload flow
- `app/globals.css` → styling

## Recommended future improvements
- Add date-range filter inside the app
- Add MID-wise analysis
- Add per-PSP decline drilldown
- Add issuer BIN analysis
- Add saveable rule presets for different entities
