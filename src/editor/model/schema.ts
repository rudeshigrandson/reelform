import { z } from "zod";

/**
 * `.reelform` project document — schema v1 (see ENGINEERING_SPEC §4).
 * This is the M0 subset: enough structure to validate, migrate, and drive the
 * time-math layer. Feature tabs extend the sub-schemas in their own milestones.
 */

const ms = z.number().finite().nonnegative();

export const MediaSource = z.object({
  path: z.string(), // relative to the project dir
  durationMs: ms,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().positive(),
  codec: z.string(),
  hasAudio: z.boolean(),
});
export type MediaSource = z.infer<typeof MediaSource>;

/** A contiguous slice of the source placed on the timeline. */
export const Clip = z
  .object({
    id: z.string(),
    sourceStartMs: ms,
    sourceEndMs: ms,
    timelineStartMs: ms,
  })
  .refine((c) => c.sourceEndMs > c.sourceStartMs, {
    message: "clip sourceEndMs must be after sourceStartMs",
  });
export type Clip = z.infer<typeof Clip>;

export const SpeedRegion = z
  .object({
    id: z.string(),
    startMs: ms,
    endMs: ms,
    rate: z.number().min(0.25).max(8),
    keepPitch: z.boolean().default(true),
  })
  .refine((s) => s.endMs > s.startMs, { message: "speed region endMs must be after startMs" });
export type SpeedRegion = z.infer<typeof SpeedRegion>;

export const Timeline = z.object({
  durationMs: ms,
  clips: z.array(Clip),
  speeds: z.array(SpeedRegion).default([]),
});
export type Timeline = z.infer<typeof Timeline>;

export const Project = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  modifiedAt: z.string(),
  appVersion: z.string(),
  sources: z.object({ video: MediaSource }),
  timeline: Timeline,
});
export type Project = z.infer<typeof Project>;

/** Parse + validate an unknown value into a Project (throws on invalid). */
export function parseProject(raw: unknown): Project {
  return Project.parse(raw);
}
