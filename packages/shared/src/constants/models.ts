// Modeli za AI inspekciju (SPEC sekcija 8). Ne kucaj ova imena po kodu — uvezi ih odavde.
// Poziv ide isključivo iz Edge Function-a; ANTHROPIC_API_KEY nikad ne sme u klijenta.

export const AI_MODEL_PRIMARY = 'claude-haiku-5-5';
export const AI_MODEL_ESCALATION = 'claude-sonnet-5-5';

/** Verzija system prompta; upisuje se u ai_inspections.prompt_version. */
export const AI_PROMPT_VERSION = 'inspector-v1';

/** Eskalacija na jači model ispod ove sigurnosti (SPEC sekcija 8, korak 5). */
export const AI_CONFIDENCE_THRESHOLD = 0.7;
