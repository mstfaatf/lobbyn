import type { FastifyPluginAsync } from "fastify";

import mediaUploadRoutes from "./upload.js";

const mediaRoutes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(mediaUploadRoutes, { prefix: "/v1/media" });
};

export default mediaRoutes;
