import type { FastifyPluginAsync } from "fastify";

import feedPostsRoutes from "./posts.js";

const feedRoutes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(feedPostsRoutes, { prefix: "/v1/feed" });
};

export default feedRoutes;
