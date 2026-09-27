# Purview backend

Node.js 20 or newer, TypeScript, Fastify, and viem. The TypeScript compiler targets ES2022 so the emitted service uses the same JavaScript target across supported Node versions. This service currently provides a process health endpoint and live RPC diagnostics only. It does not create portfolio values, quotes, plans, or transaction results.

## Run

```powershell
Copy-Item .env.example .env
npm install
npm run dev
```

`npm run dev` compiles and starts the service. Run it again after source changes. `npm run build` compiles the service and `npm start` runs the compiled output. The service does not require a wallet private key. Do not add one for the read-only framework.

## Endpoints

- `GET /api/health`: process health; does not imply that chain integrations are available.
- `GET /api/integrations/status`: makes live read-only RPC requests and reports what those requests actually establish. RPC reachability or contract bytecode alone does not establish that a protocol market is usable.

Unimplemented financial endpoints are intentionally absent. An unavailable or unverified integration must not be replaced with sample data.
