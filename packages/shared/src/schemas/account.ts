import { z } from 'zod';

export const emailSchema = z.string().trim().max(254).pipe(z.email());
export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(72),
});
export const signUpSchema = signInSchema.extend({
  name: z.string().trim().min(2).max(100),
  password: z.string().min(8).refine((value) => utf8Length(value) <= 72),
  adult: z.literal(true),
});

function utf8Length(value: string) {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    bytes += codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4;
  }
  return bytes;
}
