import type { FastifyPluginAsync } from "fastify";

import ticketRoutes from "./tickets.js";

const ticketsPlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(ticketRoutes, { prefix: "/v1/tickets" });
};

export default ticketsPlugin;
