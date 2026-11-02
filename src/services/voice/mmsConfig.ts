import "server-only";
import { z } from "zod";

const booleanSchema = z.enum(["on", "true", "1", "yes"]).transform(() => true).catch(false);
const urlSchema = z.string().url().refine((value) => value.startsWith("http://") || value.startsWith("https://"), "MMS service URL must use HTTP or HTTPS.");

const mmsEnvironmentSchema = z.object({
  enabled: booleanSchema,
  serviceUrl: urlSchema.default("http://127.0.0.1:8001"),
  timeoutMs: z.coerce.number().int().positive().max(120_000).default(120_000),
}).strict();

export type MmsEnvironment = z.infer<typeof mmsEnvironmentSchema>;

export function getMmsEnvironment(): MmsEnvironment {
  const parsed = mmsEnvironmentSchema.safeParse({
    enabled: process.env.META_MMS_ENABLED,
    serviceUrl: process.env.META_MMS_SERVICE_URL || undefined,
    timeoutMs: process.env.META_MMS_REQUEST_TIMEOUT_MS || undefined,
  });
  if (!parsed.success) {
    console.error("[VoiceNav MMS] Invalid configuration; MMS remains disabled.", parsed.error.flatten().fieldErrors);
    return { enabled: false, serviceUrl: "http://127.0.0.1:8001", timeoutMs: 120_000 };
  }
  return parsed.data;
}
