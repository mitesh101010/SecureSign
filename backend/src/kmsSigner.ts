import { GetPublicKeyCommand, KMSClient, SignCommand, SigningAlgorithmSpec } from "@aws-sdk/client-kms";
import { createHash } from "crypto";
import { PublicKey } from "@hashgraph/sdk";

export class KmsHederaSigner {
  constructor(private readonly kmsClient: KMSClient, private readonly keyId: string) {}

  async getHederaPublicKey(): Promise<PublicKey> {
    const response = await this.kmsClient.send(new GetPublicKeyCommand({ KeyId: this.keyId }));
    if (!response.PublicKey) {
      throw new Error("KMS getPublicKey response is empty");
    }

    const uncompressedPubKey = extractUncompressedSecp256k1Key(Buffer.from(response.PublicKey));
    return PublicKey.fromBytesECDSA(uncompressedPubKey);
  }

  async signTransactionBytes(transactionBytes: Uint8Array): Promise<Uint8Array> {
    const digest = createHash("sha256").update(transactionBytes).digest();

    const response = await this.kmsClient.send(
      new SignCommand({
        KeyId: this.keyId,
        Message: digest,
        MessageType: "DIGEST",
        SigningAlgorithm: SigningAlgorithmSpec.ECDSA_SHA_256
      })
    );

    if (!response.Signature) {
      throw new Error("KMS sign response has no signature");
    }

    return derToRS(Buffer.from(response.Signature));
  }
}

function extractUncompressedSecp256k1Key(spkiDer: Buffer): Uint8Array {
  // Basic DER parsing for SubjectPublicKeyInfo -> BIT STRING -> EC point (04 || X || Y)
  const bitStringTag = 0x03;
  const idx = spkiDer.indexOf(bitStringTag);
  if (idx < 0) {
    throw new Error("Invalid SPKI public key: missing BIT STRING");
  }
  const bitStringLength = readDerLength(spkiDer, idx + 1);
  const lengthBytes = bitStringLength.bytesRead;
  const valueStart = idx + 1 + lengthBytes;
  const unusedBits = spkiDer[valueStart];
  if (unusedBits !== 0) {
    throw new Error("Invalid SPKI key: unsupported unused bits");
  }
  const point = spkiDer.subarray(valueStart + 1, valueStart + bitStringLength.length);

  if (point.length !== 65 || point[0] !== 0x04) {
    throw new Error("Expected uncompressed secp256k1 point (65 bytes)");
  }

  return point;
}

function readDerLength(buf: Buffer, offset: number): { length: number; bytesRead: number } {
  const first = buf[offset];
  if ((first & 0x80) === 0) {
    return { length: first, bytesRead: 1 };
  }
  const bytesCount = first & 0x7f;
  let length = 0;
  for (let i = 0; i < bytesCount; i += 1) {
    length = (length << 8) | buf[offset + 1 + i];
  }
  return { length, bytesRead: 1 + bytesCount };
}

function derToRS(derSig: Buffer): Uint8Array {
  if (derSig[0] !== 0x30) {
    throw new Error("Invalid DER signature");
  }

  let offset = 2;
  if (derSig[1] & 0x80) {
    offset = 2 + (derSig[1] & 0x7f);
  }

  if (derSig[offset] !== 0x02) {
    throw new Error("Invalid DER signature (missing r)");
  }
  const rLen = derSig[offset + 1];
  const r = derSig.subarray(offset + 2, offset + 2 + rLen);

  const sTagOffset = offset + 2 + rLen;
  if (derSig[sTagOffset] !== 0x02) {
    throw new Error("Invalid DER signature (missing s)");
  }
  const sLen = derSig[sTagOffset + 1];
  const s = derSig.subarray(sTagOffset + 2, sTagOffset + 2 + sLen);

  return new Uint8Array([...leftPad32(r), ...leftPad32(s)]);
}

function leftPad32(input: Buffer): number[] {
  let bytes = [...input];
  while (bytes.length > 32 && bytes[0] === 0) {
    bytes = bytes.slice(1);
  }
  if (bytes.length > 32) {
    throw new Error("DER integer larger than 32 bytes");
  }
  return new Array(32 - bytes.length).fill(0).concat(bytes);
}
