import {
  importPKCS8,
  importSPKI,
  jwtVerify,
  SignJWT,
  type JWTPayload,
} from "jose";

const ISSUER = "lobbyn-api";
const AUDIENCE = "lobbyn-app";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const JWT_ACCESS_TOKEN_EXPIRY = requireEnv("JWT_ACCESS_TOKEN_EXPIRY");
const JWT_REFRESH_TOKEN_EXPIRY = requireEnv("JWT_REFRESH_TOKEN_EXPIRY");

const privateKeyPem = requireEnv("JWT_PRIVATE_KEY").replace(/\\n/g, "\n");
const publicKeyPem = requireEnv("JWT_PUBLIC_KEY").replace(/\\n/g, "\n");

const keyPairPromise = Promise.all([
  importPKCS8(privateKeyPem, "RS256"),
  importSPKI(publicKeyPem, "RS256"),
]).then(([privateKey, publicKey]) => ({ privateKey, publicKey }));

export interface JwtPayload {
  sub: string;
  email: string;
  orgId: string;
  buildingId: string;
  role: "resident" | "manager" | "org_admin";
  type: "access" | "refresh";
}

const ROLES: readonly JwtPayload["role"][] = [
  "resident",
  "manager",
  "org_admin",
] as const;

function assertString(value: unknown, field: string): string {
  if (typeof value !== "string" || value === "") {
    throw new Error(`Invalid token: missing or invalid claim "${field}"`);
  }
  return value;
}

/** String claim that may be empty (e.g. user not yet in a building). */
function assertStringClaim(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`Invalid token: missing or invalid claim "${field}"`);
  }
  return value;
}

function parseJwtPayload(payload: JWTPayload): JwtPayload {
  const sub = assertString(payload.sub, "sub");
  const email = assertString(payload.email, "email");
  const orgId = assertStringClaim(payload.orgId, "orgId");
  const buildingId = assertStringClaim(payload.buildingId, "buildingId");
  const roleRaw = assertString(payload.role, "role");
  const typeRaw = assertString(payload.type, "type");

  if (!ROLES.includes(roleRaw as JwtPayload["role"])) {
    throw new Error(`Invalid token: invalid claim "role"`);
  }

  if (typeRaw !== "access" && typeRaw !== "refresh") {
    throw new Error(`Invalid token: invalid claim "type"`);
  }

  return {
    sub,
    email,
    orgId,
    buildingId,
    role: roleRaw as JwtPayload["role"],
    type: typeRaw,
  };
}

async function getPrivateKey() {
  return (await keyPairPromise).privateKey;
}

async function getPublicKey() {
  return (await keyPairPromise).publicKey;
}

export async function signAccessToken(
  payload: Omit<JwtPayload, "type">,
): Promise<string> {
  const privateKey = await getPrivateKey();
  return await new SignJWT({
    sub: payload.sub,
    email: payload.email,
    orgId: payload.orgId,
    buildingId: payload.buildingId,
    role: payload.role,
    type: "access",
  })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime(JWT_ACCESS_TOKEN_EXPIRY)
    .sign(privateKey);
}

export async function signRefreshToken(
  payload: Omit<JwtPayload, "type">,
  options?: { jti?: string },
): Promise<string> {
  const privateKey = await getPrivateKey();
  let builder = new SignJWT({
    sub: payload.sub,
    email: payload.email,
    orgId: payload.orgId,
    buildingId: payload.buildingId,
    role: payload.role,
    type: "refresh",
  })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime(JWT_REFRESH_TOKEN_EXPIRY);

  if (options?.jti !== undefined && options.jti !== "") {
    builder = builder.setJti(options.jti);
  }

  return await builder.sign(privateKey);
}

export async function verifyAccessToken(token: string): Promise<JwtPayload> {
  const publicKey = await getPublicKey();
  const { payload } = await jwtVerify(token, publicKey, {
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithms: ["RS256"],
  });
  const parsed = parseJwtPayload(payload);
  if (parsed.type !== "access") {
    throw new Error("Invalid access token");
  }
  return parsed;
}

export async function verifyRefreshToken(token: string): Promise<JwtPayload> {
  const publicKey = await getPublicKey();
  const { payload } = await jwtVerify(token, publicKey, {
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithms: ["RS256"],
  });
  const parsed = parseJwtPayload(payload);
  if (parsed.type !== "refresh") {
    throw new Error("Invalid refresh token");
  }
  return parsed;
}
