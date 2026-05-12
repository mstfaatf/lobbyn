import * as argon2 from "argon2";

const hashOptions: argon2.Options & { type: typeof argon2.argon2id } = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
};

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, hashOptions);
}

export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}
