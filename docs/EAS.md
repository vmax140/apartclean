# Razvojni build (EAS)

Push obaveštenja **ne rade u Expo Go** — Expo Go nema sopstveni push ključ ni
`projectId` tvoje aplikacije. Za probu push-a treba razvojni build, koji se
instalira na telefon kao prava aplikacija i prihvata izmene koda preko mreže kao
i Expo Go.

Ovo je uputstvo za Fazu 2C (SPEC sekcija 10). Objava u prodavnicama je Faza 4.

## Jednom, priprema

1. Napravi nalog na `expo.dev`.
2. U korenu projekta:

```
pnpm --filter @apartclean/mobile exec eas login
pnpm --filter @apartclean/mobile exec eas init
```

   `eas init` upiše `extra.eas.projectId` u `app.config.ts`. **Taj upis je
   obavezan** — bez njega `lib/push.ts` vraća `unsupported` i token se ne dobija.

3. Potvrdi da je zapisan:

```
pnpm --filter @apartclean/mobile exec expo config --type public
```

## Android

```
pnpm --filter @apartclean/mobile exec eas build --profile development --platform android
```

Build traje 10–20 minuta. Na kraju dobiješ `.apk` koji se skida QR kodom ili
linkom. Na telefonu dozvoli instalaciju iz nepoznatih izvora.

## iPhone

```
pnpm --filter @apartclean/mobile exec eas build --profile development --platform ios
```

Za iOS treba Apple Developer nalog (99 USD godišnje) i registrovan uređaj:

```
pnpm --filter @apartclean/mobile exec eas device:create
```

Bez Apple naloga iOS build nije moguć. Android je dovoljan da se push proveri.

## Pokretanje

```
pnpm --filter @apartclean/mobile exec expo start --dev-client
```

Otvori aplikaciju na telefonu i skeniraj QR.

## Provera push-a

1. U aplikaciji otvori **Obaveštenja** i pritisni **Uključi obaveštenja**.
   Treba da piše „Obaveštenja su uključena."
2. Proveri da je uređaj zapisan:

```sql
select platform, last_seen_at from push_devices;
```

3. Sa drugog naloga napravi zadatak i pošalji ga toj spremačici. Push treba da
   stigne za manje od 30 sekundi (kriterijum iz SPEC sekcije 10).

Ako push ne stigne, pogledaj šta je zapisano uz obaveštenje:

```sql
select type, data -> 'delivery' from notifications order by created_at desc limit 5;
```

- `"push": "no_devices"` — uređaj nije prijavljen ili token nije u Expo obliku
- `"push": {"sent": 0, "of": 1}` — Expo je odbio token; najčešće je build
  napravljen sa drugim `projectId`
- nema polja `delivery` — Edge Function nije ni pozvana; proveri vault tajne
  `edge_functions_url` i `service_role_key`

## Mejl (Resend)

Mejl se šalje samo za ponude, spremne apartmane, nedolaske, otkazivanja i
rešene sporove. Ostalo ide samo kao push i spisak u aplikaciji — besplatni nivo
Resend-a je ograničen, a previše mejlova navede ljude da ih isključe.

```
supabase secrets set RESEND_API_KEY=...
supabase secrets set RESEND_FROM="ApartClean <obavestenja@tvoj-domen.rs>"
```

Dok ovih tajni nema, uz obaveštenje stoji `"email": "not_configured"` i ništa
se ne šalje — push i spisak rade normalno.
