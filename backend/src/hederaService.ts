import {
  AccountBalanceQuery,
  AccountCreateTransaction,
  AccountId,
  Client,
  Hbar,
  PrivateKey,
  PublicKey,
  Status,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  TopicId,
  Transaction,
  TransactionId,
  TransactionRecord,
  TransferTransaction
} from "@hashgraph/sdk";
import { createHash } from "crypto";
import { config } from "./config.js";
import { KmsHederaSigner } from "./kmsSigner.js";
import { SystemInfo, TxAuditLog, TxHistoryItem } from "./types.js";

interface MirrorNodeTransfer {
  account: string;
  amount: number;
}

interface MirrorNodeTx {
  transaction_id: string;
  result: string;
  consensus_timestamp: string;
  charged_tx_fee: number;
  transfers?: MirrorNodeTransfer[];
}

interface MirrorNodeResponse {
  transactions: MirrorNodeTx[];
}

export class HederaService {
  private readonly client: Client;
  private walletAccountId?: AccountId;
  private topicId?: TopicId;
  private readonly localHistory: TxHistoryItem[] = [];

  constructor(private readonly kmsSigner: KmsHederaSigner, private readonly kmsKeyId: string) {
    this.client = config.hederaNetwork === "mainnet" ? Client.forMainnet() : Client.forTestnet();
    this.client.setOperator(AccountId.fromString(config.hederaOperatorId), PrivateKey.fromStringED25519(config.hederaOperatorKey));
  }

  async initialize(): Promise<void> {
    const walletPublicKey = await this.kmsSigner.getHederaPublicKey();
    this.walletAccountId = await this.loadOrCreateWalletAccount(walletPublicKey);
    this.topicId = await this.loadOrCreateTopic();
  }

  getAccountId(): string {
    if (!this.walletAccountId) throw new Error("Wallet account is not initialized");
    return this.walletAccountId.toString();
  }

  async getBalance(): Promise<string> {
    if (!this.walletAccountId) throw new Error("Wallet account is not initialized");

    const result = await new AccountBalanceQuery().setAccountId(this.walletAccountId).execute(this.client);
    return result.hbars.toString();
  }

  async getTransactionHistory(limit = 20): Promise<TxHistoryItem[]> {
    if (!this.walletAccountId) throw new Error("Wallet account is not initialized");

    try {
      const mirrorItems = await this.fetchFromMirrorNode(this.walletAccountId.toString(), limit);
      if (mirrorItems.length > 0) {
        return mirrorItems;
      }
    } catch (error) {
      console.warn("Mirror node history unavailable, using local fallback:", (error as Error).message);
    }

    return [...this.localHistory].reverse();
  }

  async transfer(toAccountId: string, amountHbar: string, memo?: string): Promise<TxHistoryItem> {
    if (!this.walletAccountId) throw new Error("Wallet account is not initialized");

    const amount = Number(amountHbar);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("amountHbar must be a positive number");
    }

    const tx = new TransferTransaction()
      .setTransactionMemo(memo ?? "Keyless Hedera Wallet Transfer")
      .addHbarTransfer(this.walletAccountId, new Hbar(-amount))
      .addHbarTransfer(AccountId.fromString(toAccountId), new Hbar(amount))
      .setTransactionId(TransactionId.generate(this.walletAccountId));

    const { record, transactionBodyHashHex } = await this.executeWithKmsSignature(tx);

    const item: TxHistoryItem = {
      txId: record.transactionId.toString(),
      fromAccountId: this.walletAccountId.toString(),
      toAccountId,
      amountTinybar: Hbar.from(amount).toTinybars().toNumber(),
      amountHbar,
      status: record.receipt.status.toString(),
      consensusTimestamp: record.consensusTimestamp?.toString(),
      transactionHash: transactionBodyHashHex,
      source: "local",
      createdAt: new Date().toISOString()
    };

    this.localHistory.push(item);

    if (record.receipt.status === Status.Success) {
      await this.publishAuditLog({
        txId: item.txId,
        transactionHash: item.transactionHash ?? "",
        kmsKeyId: this.kmsKeyId,
        timestamp: item.createdAt
      });
    }

    return item;
  }

  private async executeWithKmsSignature<T extends Transaction>(transaction: T): Promise<{ record: TransactionRecord; transactionBodyHashHex: string }> {
    const publicKey = await this.kmsSigner.getHederaPublicKey();
    const frozen = await transaction.freezeWith(this.client);

    const transactionBodyHashHex = createHash("sha256").update(Buffer.from(frozen.toBytes())).digest("hex");

    const signedTx = await frozen.signWithSigner(publicKey, async (bodyBytes) => {
      return this.kmsSigner.signTransactionBytes(bodyBytes);
    });

    const response = await signedTx.execute(this.client);
    const record = await response.getRecord(this.client);

    return { record, transactionBodyHashHex };
  }

  private async publishAuditLog(payload: TxAuditLog): Promise<void> {
    if (!this.topicId) throw new Error("HCS topic is not initialized");

    const submit = await new TopicMessageSubmitTransaction()
      .setTopicId(this.topicId)
      .setMessage(JSON.stringify(payload))
      .execute(this.client);

    await submit.getReceipt(this.client);
  }

  private async loadOrCreateWalletAccount(publicKey: PublicKey): Promise<AccountId> {
    if (config.hederaAccountId) return AccountId.fromString(config.hederaAccountId);

    const tx = await new AccountCreateTransaction()
      .setKey(publicKey)
      .setInitialBalance(new Hbar(config.initialBalanceHbar))
      .execute(this.client);

    const receipt = await tx.getReceipt(this.client);
    if (!receipt.accountId) throw new Error("Failed to create Hedera account for KMS key");

    return receipt.accountId;
  }

  private async loadOrCreateTopic(): Promise<TopicId> {
    if (config.hcsTopicId) return TopicId.fromString(config.hcsTopicId);

    const tx = await new TopicCreateTransaction().setTopicMemo("Keyless wallet signing audit log").execute(this.client);
    const receipt = await tx.getReceipt(this.client);

    if (!receipt.topicId) throw new Error("Failed to create HCS topic");

    return receipt.topicId;
  }

  async getSystemInfo(): Promise<SystemInfo> {
    const publicKey = await this.kmsSigner.getHederaPublicKey();
    return {
      accountId: this.getAccountId(),
      topicId: this.topicId?.toString() ?? "",
      publicKey: publicKey.toStringRaw(),
      network: config.hederaNetwork,
      mirrorNodeBaseUrl: config.mirrorNodeBaseUrl
    };
  }

  private async fetchFromMirrorNode(accountId: string, limit: number): Promise<TxHistoryItem[]> {
    const url = `${config.mirrorNodeBaseUrl}/api/v1/transactions?account.id=${accountId}&limit=${limit}&order=desc&transactiontype=cryptotransfer`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Mirror node request failed: ${response.status} ${response.statusText}`);
    }

    const payload = (await response.json()) as MirrorNodeResponse;

    return payload.transactions.map((tx) => {
      const from = tx.transfers?.find((t) => t.account === accountId && t.amount < 0);
      const to = tx.transfers?.find((t) => t.account !== accountId && t.amount > 0);

      const amountTinybar = Math.abs(from?.amount ?? to?.amount ?? 0);
      const amountHbar = (amountTinybar / 100_000_000).toString();

      return {
        txId: tx.transaction_id,
        fromAccountId: accountId,
        toAccountId: to?.account ?? "unknown",
        amountTinybar,
        amountHbar,
        status: tx.result,
        consensusTimestamp: tx.consensus_timestamp,
        source: "mirror-node",
        createdAt: new Date(Number(tx.consensus_timestamp.split(".")[0]) * 1000).toISOString()
      };
    });
  }
}
