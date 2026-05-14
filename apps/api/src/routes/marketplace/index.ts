import type { FastifyPluginAsync } from "fastify";

import marketplaceListingsRoutes from "./listings.js";

const marketplaceRoutes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(marketplaceListingsRoutes, {
    prefix: "/v1/marketplace",
  });
};

export default marketplaceRoutes;
