import type { FastifyPluginAsync } from "fastify";

import joinBuildingAuthRoutes from "./join-building.js";
import loginAuthRoutes from "./login.js";
import logoutAuthRoutes from "./logout.js";
import refreshAuthRoutes from "./refresh.js";
import registerAuthRoutes from "./register.js";
import verifyEmailRoutes from "./verify-email.js";

const authRoutes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(registerAuthRoutes);
  await fastify.register(loginAuthRoutes);
  await fastify.register(refreshAuthRoutes);
  await fastify.register(logoutAuthRoutes);
  await fastify.register(joinBuildingAuthRoutes);
  await fastify.register(verifyEmailRoutes);
};

export default authRoutes;
