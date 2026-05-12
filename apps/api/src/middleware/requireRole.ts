import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";

export type FastifyPreHandler = preHandlerAsyncHookHandler;

export function requireRole(...roles: string[]): FastifyPreHandler {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!roles.includes(request.user.role)) {
      throw reply.server.httpErrors.forbidden("Insufficient permissions");
    }
  };
}
