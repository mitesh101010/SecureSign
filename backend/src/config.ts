import dotenv from "dotenv";

dotenv.config();

const required = [
  "AWS_REGION",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_KMS_KEY_ID",
  "HEDERA_OPERATOR_ID",
  "HEDERA_OPERATOR_KEY"
] as const;

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required env var: ${key}`);
  }
}

export const config = {
  port: Number(process.env.PORT ?? 3001),
  awsRegion: process.env.AWS_REGION as string,
  kmsKeyId: process.env.AWS_KMS_KEY_ID as string,
  hederaOperatorId: process.env.HEDERA_OPERATOR_ID as string,
  hederaOperatorKey: process.env.HEDERA_OPERATOR_KEY as string,
  hederaAccountId: process.env.HEDERA_ACCOUNT_ID,
  initialBalanceHbar: Number(process.env.HEDERA_INITIAL_BALANCE_HBAR ?? 10),
  hcsTopicId: process.env.HEDERA_HCS_TOPIC_ID
};
