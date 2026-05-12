import { generateKeyPairSync } from "node:crypto";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const escapePemForEnv = (pem: string) => pem.replace(/\r?\n/g, "\\n");

console.log(`JWT_PRIVATE_KEY="${escapePemForEnv(privateKey)}"`);
console.log(`JWT_PUBLIC_KEY="${escapePemForEnv(publicKey)}"`);
