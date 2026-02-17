# Keyless Hedera Wallet using AWS KMS

Production-style fullstack demo where users never hold private keys. All Hedera signatures are generated inside **AWS KMS** (`ECC_SECG_P256K1` + `ECDSA_SHA_256`) and each successful transfer is logged to **Hedera Consensus Service (HCS)** for tamper-proof auditing.

## Architecture

- **Frontend (`/frontend`)**: React + Vite dashboard for account details, balance, transfer form, and transaction history.
- **Backend (`/backend`)**: Node.js TypeScript + Express API.
- **Signing**: Custom signer uses AWS KMS `Sign` API and converts DER signatures to Hedera-compatible `r|s` bytes.
- **Audit**: On successful transfer, backend writes an event to HCS containing:
  - `txId`
  - `hash(transactionBytes)`
  - `kmsKeyId`
  - `timestamp`
- **History**: `GET /transactions` pulls recent transfers from Hedera Mirror Node (falls back to local memory if unavailable).

## AWS KMS setup

1. Open AWS Console → KMS → **Create key**.
2. Choose:
   - Key type: **Asymmetric**
   - Key usage: **Sign and verify**
   - Key spec: **ECC_SECG_P256K1**
   - Signing algorithm: **ECDSA_SHA_256**
3. Save the key ARN as `AWS_KMS_KEY_ID`.
4. Ensure the IAM principal used by this app can call:
   - `kms:GetPublicKey`
   - `kms:Sign`

## Hedera testnet setup

1. Create a Hedera Testnet operator account in the [Hedera Portal](https://portal.hedera.com/).
2. Put operator credentials in `.env`:
   - `HEDERA_OPERATOR_ID`
   - `HEDERA_OPERATOR_KEY` (ED25519 private key)
3. The backend will:
   - Fetch the KMS public key
   - Create a Hedera wallet account with that key if `HEDERA_ACCOUNT_ID` is empty
   - Create an HCS topic if `HEDERA_HCS_TOPIC_ID` is empty

## Local run

1. Copy env file:
   ```bash
   cp .env.example .env
   ```
2. Install dependencies:
   ```bash
   cd backend && npm install
   cd ../frontend && npm install
   ```
3. Start backend:
   ```bash
   cd backend
   npm run dev
   ```
4. Start frontend in another terminal:
   ```bash
   cd frontend
   npm run dev
   ```
5. Open `http://localhost:5173`.

## API overview

- `GET /health` → liveness + network
- `GET /system` → account + topic + public key + mirror node
- `GET /balance` → current HBAR balance
- `GET /transactions?limit=20` → recent transfers from mirror node
- `POST /transfer` → signed transfer via AWS KMS + HCS audit log

### Transfer payload

```json
{
  "toAccountId": "0.0.5678",
  "amountHbar": "1",
  "memo": "optional"
}
```

## Security notes

- Private key is never exported from AWS KMS.
- Signature operation is delegated to `kms:Sign` only.
- Every successful transfer is anchored on HCS for immutable audit records.
- Transfer recipient/account format is validated server-side before submission.
