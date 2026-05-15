import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { generatePresignedUploadUrl, validateImageFile } from "../../lib/media.js";
import { authenticate } from "../../middleware/authenticate.js";

const presignBodySchema = z.object({
  resourceType: z.enum(["post", "listing", "ticket", "avatar"]),
  fileExtension: z.enum(["jpg", "jpeg", "png", "webp"]),
  fileSizeBytes: z.number().int().min(1).max(10_485_760),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
});

function hasBuildingId(buildingId: string): boolean {
  return buildingId !== "";
}

const mediaUploadRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    "/presign",
    {
      preHandler: [
        authenticate,
        fastify.rateLimit({
          max: 30,
          timeWindow: "1 minute",
          keyGenerator: (request) => request.user.id,
        }),
      ],
    },
    async (request, reply) => {
      const parsed = presignBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ errors: parsed.error.flatten() });
      }

      const { resourceType, fileExtension, fileSizeBytes, mimeType } =
        parsed.data;

      if (!hasBuildingId(request.user.buildingId) && resourceType !== "avatar") {
        return reply.status(403).send({
          message: "You must join a building to upload media",
        });
      }

      const validation = validateImageFile({ mimeType, fileSizeBytes });
      if (!validation.valid) {
        return reply.status(400).send({ message: validation.error });
      }

      const extForStorage =
        fileExtension === "jpeg" ? "jpg" : fileExtension.toLowerCase();

      const { uploadUrl, objectKey, publicUrl } =
        await generatePresignedUploadUrl({
          orgId: request.user.orgId,
          buildingId: request.user.buildingId || "global",
          resourceType,
          fileExtension: extForStorage,
        });

      return reply.status(200).send({
        uploadUrl,
        objectKey,
        publicUrl,
        expiresIn: 300,
      });
    },
  );
};

export default mediaUploadRoutes;
