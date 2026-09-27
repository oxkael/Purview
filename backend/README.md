# Purview backend

Node.js 20 or newer, TypeScript, Fastify, and viem. The TypeScript compiler targets ES2022 so the emitted service uses the same JavaScript target across supported Node versions. The service provides health checks, live chain reads, conservative intent parsing, and read-only 0x price/quote requests. It does not create fabricated portfolio values or transaction results. Planning and execution endpoints remain unimplemented.

## Run

```powershell
Copy-Item .env.example .env
npm install
npm run dev
```

`npm run dev` compiles and starts the service. Run it again after source changes. `npm run build` compiles the service and `npm start` runs the compiled output. The service does not require a wallet private key. Do not add one for the read-only framework.

## Endpoints

- `GET /api/health`: process health; does not imply that chain integrations are available.
- `POST /api/intent`: conservative parsing for the documented USDG target / NVDA sale-cap request. It returns a structured clarification when an explicit value is missing and rejects unsupported assets; it does not plan or execute transactions.
- `POST /api/plan`: read-only preflight. Accepts `{ "address": "0x…", "intent": { "targetAsset": "USDG", "targetAmount": 3000, "restrictedAsset": "NVDA", "maxSellPercentage": 20 } }`, fetches live wallet/market/oracle state including raw Morpho market totals, and returns explicit blockers. It does not assert borrowable capacity, calculate a borrow amount, or produce transaction data.
- `GET /api/integrations/status`: makes live read-only RPC requests and reports what those requests actually establish. RPC reachability or contract bytecode alone does not establish that a protocol market is usable.
- `GET /api/quotes/nvda-to-usdg?sellAmountRaw=<base-units>&taker=<wallet>`: requests a live 0x Swap API v2 quote for the configured NVDA and USDG tokens. The amount must be a positive integer in token base units. Requires `ZEROX_API_KEY`; returning a quote does not validate or execute its transaction.
- `GET /api/prices/nvda-to-usdg?sellAmountRaw=<base-units>&taker=<wallet>`: requests live indicative pricing from 0x for the configured NVDA and USDG tokens. The amount must be a positive integer in token base units; `taker` is optional. Indicative pricing is not an executable quote.
- `GET /api/portfolio?address=<wallet>`: reads live balances, allowances, and the configured Morpho position for the supplied wallet.

Unimplemented financial endpoints are intentionally absent. An unavailable or unverified integration must not be replaced with sample data.
