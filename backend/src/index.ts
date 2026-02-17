import cors from "cors";
import express from "express";
import { KMSClient } from "@aws-sdk/client-kms";
import { config } from "./config.js";
import { HederaService } from "./hederaService.js";
import { KmsHederaSigner } from "./kmsSigner.js";
import { TransferRequest } from "./types.js";

const app = express();
app.use(cors());
app.use(express.json());

const kmsClient = new KMSClient({ region: config.awsRegion });
const kmsSigner = new KmsHederaSigner(kmsClient, config.kmsKeyId);
const hederaService = new HederaService(kmsSigner, config.kmsKeyId);

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/system", async (_req, res) => {
  try {
    const info = await hederaService.getSystemInfo();
    res.json(info);
  } catch (error) {
    res.status(500).json({ message: (error as Error).message });
  }
});

app.get("/balance", async (_req, res) => {
  try {
    const balance = await hederaService.getBalance();
    res.json({ accountId: hederaService.getAccountId(), balance });
  } catch (error) {
    res.status(500).json({ message: (error as Error).message });
  }
});

app.get("/transactions", (_req, res) => {
  res.json({ items: hederaService.getHistory() });
});

app.post("/transfer", async (req, res) => {
  const payload = req.body as TransferRequest;

  if (!payload.toAccountId || !payload.amountHbar) {
    res.status(400).json({ message: "toAccountId and amountHbar are required" });
    return;
  }

  try {
    const result = await hederaService.transfer(payload.toAccountId, payload.amountHbar, payload.memo);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: (error as Error).message });
  }
});

async function start(): Promise<void> {
  await hederaService.initialize();

  app.listen(config.port, () => {
    console.log(`Backend running on http://localhost:${config.port}`);
  });
}

start().catch((error) => {
  console.error("Failed to start server", error);
  process.exit(1);
});
