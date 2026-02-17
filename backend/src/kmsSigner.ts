import { GetPublicKeyCommand, KMSClient, SignCommand, SigningAlgorithmSpec } from "@aws-sdk/client-kms";
import { createHash, createPublicKey } from "crypto";
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
  const keyObject = createPublicKey({ key: spkiDer, format: "der", type: "spki" });
  const jwk = keyObject.export({ format: "jwk" }) as { x?: string; y?: string };

  if (!jwk.x || !jwk.y) {
    throw new Error("KMS public key conversion failed (missing EC coordinates)");
  }

  const x = Buffer.from(jwk.x, "base64url");
  const y = Buffer.from(jwk.y, "base64url");

  if (x.length !== 32 || y.length !== 32) {
    throw new Error("Unexpected secp256k1 coordinate length from KMS key");
  }

  return new Uint8Array([0x04, ...x, ...y]);
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
