export interface TransferRequest {
  toAccountId: string;
  amountHbar: string;
  memo?: string;
}

export interface TxAuditLog {
  txId: string;
  transactionHash: string;
  kmsKeyId: string;
  timestamp: string;
}

export interface TxHistoryItem {
  txId: string;
  fromAccountId: string;
  toAccountId: string;
  amountTinybar: number;
  amountHbar: string;
  status: string;
  consensusTimestamp?: string;
  transactionHash?: string;
  source: "mirror-node" | "local";
  createdAt: string;
}

export interface SystemInfo {
  accountId: string;
  topicId: string;
  publicKey: string;
  network: string;
  mirrorNodeBaseUrl: string;
}
