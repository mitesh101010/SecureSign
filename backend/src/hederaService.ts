import {
  AccountBalanceQuery,
  AccountCreateTransaction,
  AccountId,
  Client,
  Hbar,
  PrivateKey,
  PublicKey,
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
import { TxAuditLog, TxHistoryItem } from "./types.js";

export class HederaService {
  private readonly client: Client;
  private walletAccountId?: AccountId;
  private topicId?: TopicId;
  private readonly history: TxHistoryItem[] = [];

  constructor(private readonly kmsSigner: KmsHederaSigner, private readonly kmsKeyId: string) {
    this.client = Client.forTestnet();
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

  getHistory(): TxHistoryItem[] {
    return [...this.history].reverse();
  }

  async getBalance(): Promise<string> {
    if (!this.walletAccountId) throw new Error("Wallet account is not initialized");

    const result = await new AccountBalanceQuery().setAccountId(this.walletAccountId).execute(this.client);
    return result.hbars.toString();
  }

  async transfer(toAccountId: string, amountHbar: string, memo?: string): Promise<TxHistoryItem> {
    if (!this.walletAccountId) throw new Error("Wallet account is not initialized");

    const tx = new TransferTransaction()
      .setTransactionMemo(memo ?? "Keyless Hedera Wallet Transfer")
      .addHbarTransfer(this.walletAccountId, new Hbar(-Number(amountHbar)))
      .addHbarTransfer(AccountId.fromString(toAccountId), new Hbar(Number(amountHbar)))
      .setTransactionId(TransactionId.generate(this.walletAccountId));

    const { record, transactionBodyHashHex } = await this.executeWithKmsSignature(tx);

    const item: TxHistoryItem = {
      txId: record.transactionId.toString(),
      toAccountId,
      amountHbar,
      status: record.receipt.status.toString(),
      consensusTimestamp: record.consensusTimestamp?.toString(),
      transactionHash: transactionBodyHashHex,
      createdAt: new Date().toISOString()
    };

    this.history.push(item);

    await this.publishAuditLog({
      txId: item.txId,
      transactionHash: item.transactionHash,
      kmsKeyId: this.kmsKeyId,
      timestamp: item.createdAt
    });

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

  async getSystemInfo(): Promise<{ accountId: string; topicId: string; publicKey: string }> {
    const publicKey = await this.kmsSigner.getHederaPublicKey();
    return {
      accountId: this.getAccountId(),
      topicId: this.topicId?.toString() ?? "",
      publicKey: publicKey.toStringRaw()
    };
  }
}
