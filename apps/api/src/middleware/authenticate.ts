import type { FastifyReply, FastifyRequest } from "fastify";

import { verifyAccessToken } from "../auth/jwt.js";

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const authHeader = request.headers.authorization;
  if (authHeader === undefined || !/^Bearer\s+/i.test(authHeader)) {
    throw reply.server.httpErrors.unauthorized("Missing authentication token");
  }

  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (token === "") {
    throw reply.server.httpErrors.unauthorized("Missing authentication token");
  }

  try {
    const payload = await verifyAccessToken(token);
    request.user = {
      id: payload.sub,
      email: payload.email,
      orgId: payload.orgId,
      buildingId: payload.buildingId,
      role: payload.role,
    };
  } catch {
    throw reply.server.httpErrors.unauthorized("Invalid or expired token");
  }
}
