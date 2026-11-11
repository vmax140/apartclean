import { z } from 'zod';
import { ROOM_TYPES } from '../constants/enums';

// Faza 1C: ulaz čarobnjaka za apartman (SPEC sekcija 7 — vlasnik).
// Granice su namerno šire nego što Kopaonik i Zlatibor traže, da se vlasnik ne
// bori sa validacijom; prave greške hvata baza.

const timeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'VREME_NEISPRAVNO')
  .transform((value) => value + ':00');

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : undefined));

const count = (max: number) => z.number().int().min(0).max(max).optional();

export const roomInputSchema = z.object({
  type: z.enum(ROOM_TYPES),
  name: z.string().trim().min(1).max(60),
  sort_order: z.number().int().min(0).max(99).default(0),
});

export const calendarInputSchema = z.object({
  source: z.enum(['booking', 'airbnb', 'other']),
  ical_url: z.string().trim().max(500).pipe(z.url()),
});

/** Korak 1: osnovni podaci i podrazumevane vrednosti zadatka. */
export const propertyBasicsSchema = z.object({
  name: z.string().trim().min(2).max(100),
  region_id: z.number().int().positive(),
  complex_name: optionalText(100),
  size_m2: z.number().int().min(1).max(2000).optional(),
  bedrooms: count(20),
  bathrooms: count(20),
  beds: count(40),
  max_guests: count(40),
  checkout_time: timeSchema.default('10:00'),
  checkin_time: timeSchema.default('14:00'),
  est_duration_min: z.number().int().min(15).max(600).default(120),
  default_price_rsd: z.number().int().min(0).max(1_000_000).optional(),
  cleaning_notes: optionalText(2000),
});

/** Korak 2: lokacija. Krug za proveru dolaska je u metrima (SPEC sekcija 6, korak 5). */
export const propertyLocationSchema = z.object({
  address: z.string().trim().min(3).max(200),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  geofence_m: z.number().int().min(30).max(2000).default(150),
});

/**
 * Korak 4: pristup. Šifra sefa i WiFi lozinka putuju u čistom obliku samo do
 * Edge Function-a property-access, koji ih šifruje pre upisa (odluka 4).
 */
export const propertyAccessSchema = z.object({
  key_instructions: optionalText(1000),
  lockbox_code: optionalText(50),
  wifi_name: optionalText(100),
  wifi_password: optionalText(100),
});

export const newPropertySchema = propertyBasicsSchema
  .extend(propertyLocationSchema.shape)
  .extend({
    rooms: z.array(roomInputSchema).min(1, 'SOBE_OBAVEZNE').max(30),
    calendars: z.array(calendarInputSchema).max(5).default([]),
  });

export type RoomInput = z.infer<typeof roomInputSchema>;
export type CalendarInput = z.infer<typeof calendarInputSchema>;
export type NewProperty = z.infer<typeof newPropertySchema>;
export type PropertyAccessInput = z.infer<typeof propertyAccessSchema>;

/** Sobe koje čarobnjak nudi kao polazne, u redosledu u kom se obično obilaze. */
export const DEFAULT_ROOMS: RoomInput[] = [
  { type: 'bedroom', name: 'Spavaća soba', sort_order: 0 },
  { type: 'bathroom', name: 'Kupatilo', sort_order: 1 },
  { type: 'kitchen', name: 'Kuhinja', sort_order: 2 },
  { type: 'living_room', name: 'Dnevna soba', sort_order: 3 },
];

export const SELECTABLE_ROOM_TYPES = ROOM_TYPES;
