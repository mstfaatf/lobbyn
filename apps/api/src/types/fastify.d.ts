import "fastify";

declare module 'fastify' {
  interface FastifyRequest {
    user: {
      id: string;
      email: string;
      orgId: string;
      buildingId: string;
      role: "resident" | "manager" | "org_admin";
    };
  }
}
