# ZeroWaste AI

A food-rescue marketplace that connects local businesses with citizens through discounted surplus-food offers. The application uses React and Vite, an Express API, Supabase PostgreSQL, and Avalanche Fuji for on-chain subscriptions and purchases.

## Features

- Business and citizen accounts, including social-support citizen profiles.
- Monthly business subscriptions paid on Avalanche Fuji.
- Business offers require administrator approval before appearing publicly.
- Citizens can purchase offers with MetaMask and view purchase tickets with QR codes.
- PostgreSQL stores accounts, offers, purchase intents, and reservations.

## Requirements

- Node.js 20.19+ or 22.12+.
- A Supabase project with the database schema applied.
- MetaMask configured for Avalanche Fuji to test blockchain features.

## Database setup

1. Create a Supabase project.
2. Open **SQL Editor** in the Supabase dashboard.
3. Run the SQL in `supabase/schema.sql` to create the application tables.
4. Copy the PostgreSQL connection URI from **Connect → Direct connection string → Shared pooler**. Keep it private.

## Run locally on Windows

1. Create a local `.env` file beside `package.json` using `.env.example` as a template. Set `DATABASE_URL` to the Supabase PostgreSQL URI. Set a strong `JWT_SECRET`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD`. The admin password must contain at least 12 characters.
2. Open PowerShell in this project directory and run:

```powershell
npm install
npm run dev:full
```

3. Open the local Vite URL printed in the terminal. The API health endpoint is `http://127.0.0.1:3001/api/health` and should report that the database is connected.

Never commit `.env`, database passwords, MetaMask seed phrases, or private keys. `.gitignore` excludes `.env` and local build/dependency folders.

## Deploy the smart contract to Avalanche Fuji

The contract source is `contracts/ZeroWasteMarketplace.sol`.

1. Compile it with `npm run contract:compile` or open it in Remix.
2. In Remix, choose Solidity compiler `0.8.38`, optimizer with 200 runs, and EVM version `cancun`.
3. Under **Deploy & Run Transactions**, choose **Injected Provider - MetaMask** and connect MetaMask to Avalanche Fuji (chain ID `43113`). Ensure the deploying wallet has Fuji test AVAX for gas.
4. Deploy the contract and copy its deployed address.
5. Set that address as both `MARKETPLACE_ADDRESS` and `VITE_MARKETPLACE_ADDRESS` in the local environment and the hosting environment. The application expects the V3 contract.

Businesses pay the monthly subscription once per subscription period. Each offer is signed with MetaMask and waits for administrator approval. Citizens pay for each purchase with a Fuji transaction.

## Deploy on Render with GitHub

The `render.yaml` Blueprint builds the Vite frontend and runs the Express server, which serves the frontend and API from one public Render service.

1. Push this project to a GitHub repository. Keep the repository private or public as you prefer; make sure `.env` is not committed.
2. In Render, choose **New → Blueprint** and connect the GitHub repository containing this `render.yaml` at its root.
3. Provide the requested environment values in Render:
   - `DATABASE_URL`: the Supabase PostgreSQL connection URI.
   - `ADMIN_EMAIL` and `ADMIN_PASSWORD`: administrator credentials.
   - `MARKETPLACE_ADDRESS` and `VITE_MARKETPLACE_ADDRESS`: the deployed Fuji V3 contract address.
   - `JWT_SECRET`: Render can generate this value from the Blueprint configuration.
4. Deploy the Blueprint. When the service is **Live**, open its `onrender.com` URL and check `/api/health`.
5. Register a test account and confirm it appears in the Supabase `accounts` table.

The Render free instance may spin down during inactivity, which can make its first request slower.

## Administrator account

Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in the local `.env` file or Render environment settings. When the API connects to the database, it creates or updates the administrator account. Sign in through the regular login form to access the administrator dashboard.

## Project commands

```powershell
npm run dev:full       # Run the API and Vite development server
npm run build          # Build the frontend
npm start              # Start the production API and serve the built frontend
npm run contract:compile # Compile the Solidity contract
```
