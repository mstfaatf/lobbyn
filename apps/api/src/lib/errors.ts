import type { FastifyReply } from "fastify";

export function createError(
  reply: FastifyReply,
  status: number,
  message: string,
): FastifyReply {
  return reply.status(status).send({ message });
}
