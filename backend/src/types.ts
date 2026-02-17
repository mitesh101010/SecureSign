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
  topicSequenceNumber?: string;
}

export interface TxHistoryItem {
  txId: string;
  toAccountId: string;
  amountHbar: string;
  status: string;
  consensusTimestamp?: string;
  transactionHash: string;
  createdAt: string;
}
