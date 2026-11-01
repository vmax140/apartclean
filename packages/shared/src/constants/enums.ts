// Ogledalo Postgres enum tipova iz docs/SPEC.md, sekcija 3.
// Ako se migracija promeni, promeni i ovde — testovi upoređuju ove liste sa SPEC-om.

export const APP_ROLES = ['owner', 'cleaner', 'admin'] as const;
export type AppRole = (typeof APP_ROLES)[number];

export const ACCOUNT_STATUSES = ['pending', 'active', 'suspended', 'deleted'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const VERIFICATION_STATUSES = ['unverified', 'pending', 'verified', 'rejected'] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const TASK_STATUSES = [
  'draft',
  'open',
  'offered',
  'accepted',
  'in_progress',
  'submitted',
  'needs_fixes',
  'ready',
  'completed',
  'disputed',
  'cancelled',
  'expired',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_TYPES = ['turnover', 'deep_clean', 'linen_only', 'inspection'] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const OFFER_STATUSES = ['offered', 'accepted', 'declined', 'expired', 'withdrawn'] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

export const PHOTO_KINDS = ['after', 'damage', 'fix'] as const;
export type PhotoKind = (typeof PHOTO_KINDS)[number];

export const ROOM_TYPES = [
  'bedroom',
  'bathroom',
  'kitchen',
  'living_room',
  'hallway',
  'balcony',
  'other',
] as const;
export type RoomType = (typeof ROOM_TYPES)[number];

export const AI_VERDICTS = ['pass', 'minor_issues', 'fail', 'unclear'] as const;
export type AiVerdict = (typeof AI_VERDICTS)[number];

export const REVIEW_DIRECTIONS = ['owner_to_cleaner', 'cleaner_to_owner'] as const;
export type ReviewDirection = (typeof REVIEW_DIRECTIONS)[number];

export const LEGAL_DOC_KINDS = [
  'terms',
  'privacy',
  'cleaner_rules',
  'owner_rules',
  'cancellation',
] as const;
export type LegalDocKind = (typeof LEGAL_DOC_KINDS)[number];

export const PAYMENT_STATUSES = ['unpaid', 'paid_offline', 'paid_online', 'refunded'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const REPORT_CATEGORIES = ['damage', 'missing_item', 'maintenance', 'supplies_low'] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];
