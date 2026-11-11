import { z } from 'zod';

// Faza 1D: profil spremačice i zahtev za verifikaciju (SPEC sekcija 6).

export const CLEANER_LANGUAGES = ['sr', 'en', 'ru', 'de'] as const;
export type CleanerLanguage = (typeof CLEANER_LANGUAGES)[number];

export const DOCUMENT_TYPES = ['licna_karta', 'pasos'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const cleanerProfileSchema = z.object({
  bio: z
    .string()
    .trim()
    .max(600)
    .optional()
    .transform((value) => (value ? value : undefined)),
  region_ids: z.array(z.number().int().positive()).min(1, 'REGION_OBAVEZAN').max(10),
  languages: z.array(z.enum(CLEANER_LANGUAGES)).min(1).max(4),
  base_price_rsd: z.number().int().min(0).max(100_000).optional(),
  has_car: z.boolean().default(false),
  brings_supplies: z.boolean().default(false),
  max_jobs_per_day: z.number().int().min(1).max(10).default(3),
});

export type CleanerProfileInput = z.infer<typeof cleanerProfileSchema>;

export const verificationDecisionSchema = z
  .object({
    requestId: z.string().uuid(),
    approve: z.boolean(),
    reason: z.string().trim().max(500).default(''),
  })
  // Odbijanje bez obrazloženja nema smisla: spremačica ne bi znala šta da popravi.
  .refine((value) => value.approve || value.reason.length > 0, {
    error: 'RAZLOG_OBAVEZAN',
    path: ['reason'],
  });

export type VerificationDecision = z.infer<typeof verificationDecisionSchema>;

/** Prioritet u timu vlasnika: 1 je glavni, 2 i dalje su rezervni (SPEC sekcija 5). */
export const teamMemberSchema = z.object({
  cleaner_id: z.string().uuid(),
  priority: z.number().int().min(1).max(9),
});
