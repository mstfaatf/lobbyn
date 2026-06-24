import type { FastifyPluginAsync } from 'fastify';

import auditLogsRoutes from './audit-logs.js';
import inviteCodesRoutes from './invite-codes.js';
import membersRoutes from './members.js';

const adminPlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(auditLogsRoutes, { prefix: '/audit-logs' });
  await fastify.register(inviteCodesRoutes, { prefix: '/invite-codes' });
  await fastify.register(membersRoutes, { prefix: '/members' });
};

export default adminPlugin;
