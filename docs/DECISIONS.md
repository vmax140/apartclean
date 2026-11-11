# Odluke uz specifikaciju

`docs/SPEC.md` je izvor istine. Ovaj fajl rešava mesta na kojima je specifikacija
nejasna ili sama sebi protivreči. Odluke je vlasnik projekta prihvatio 1. 11. 2026.

Ako odluka i SPEC budu u sukobu, važi SPEC — osim tamo gde je ovde izričito
navedeno da SPEC protivreči sam sebi.

---

## Blokiraju Fazu 1

### 1. Kada nalog postaje `active`

SPEC daje `profiles.status` podrazumevano `pending`, ali nigde ne kaže kada prelazi u `active`.

**Odluka:** trigger `handle_new_user()` pravi red sa `pending`. Edge Function `accept-legal`
prebacuje nalog u `active` kada korisnik prihvati sve aktivne dokumente za svoju ulogu.
RLS politike traže `active` za sve osim čitanja svog profila i prihvatanja uslova.

**Tiče se:** 1A (trigger), 1B (accept-legal).

### 2. Dvostruko stanje verifikacije

`cleaner_profiles.verification` i `verification_requests.status` čuvaju istu informaciju.

**Odluka:** `verification_requests` je evidencija zahteva, `cleaner_profiles.verification`
je trenutno stanje. Menja ga isključivo Edge Function `verify-decision`. Klijent nema
UPDATE ni na jedno od ta dva.

**Tiče se:** 1A (RLS), 1D (verify-decision).

### 3. Ko upisuje uloge

SPEC sekcija 6 kaže „izbor uloge upisuje `user_roles`". Ako to radi klijent, svako
ko se registruje može sam sebi da upiše `admin`.

**Odluka:** nikakva INSERT politika na `user_roles` za klijente. RPC
`set_initial_roles(roles app_role[])` prima **samo** `owner` i `cleaner`, i radi samo
ako korisnik još nema nijednu ulogu. `admin` se dodeljuje isključivo kroz SQL ili seed.

**Tiče se:** 1A (RLS, RPC), 1B (registracija).

### 4. Čime se šifruju pristupni podaci

SPEC kaže da se šifre sefa i WiFi lozinke šifruju u Edge Function, ali ne kaže čime.

**Odluka:** AES-256-GCM. Ključ `PROPERTY_SECRET_KEY` u Supabase secrets.
Format zapisa: `base64(iv).base64(ciphertext).base64(tag)`. Bez `pgsodium` i Vault-a —
manje pokretnih delova u pilotu.

**Tiče se:** 1C (property-access).

### 5. Putanje u storage-u

SPEC daje putanju samo za `task-photos`.

**Odluka:**

| Bucket | Putanja |
| --- | --- |
| `task-photos` | `{task_id}/{photo_id}.jpg` (iz SPEC-a) |
| `reference-photos` | `{property_id}/{room_id}/{photo_id}.jpg` |
| `verification-docs` | `{user_id}/{request_id}-front.jpg`, `{user_id}/{request_id}-selfie.jpg` |
| `avatars` | `{user_id}.jpg` |

**Tiče se:** 1A (politike storage-a), 1C, 1D.

### 6. Jezik u rutama

Rute su na srpskom (`/app/apartmani`), a aplikacija ima i engleski.

**Odluka:** rute ostaju srpske kako SPEC kaže. i18n se tiče samo tekstova u interfejsu.
Bez `[locale]` segmenta u MVP-u.

**Tiče se:** 1B i dalje.

### 7. Email u Fazi 1B

Magic link treba u 1B, a Resend je tek u 2C.

**Odluka:** lokalno Mailpit (dolazi uz `supabase start`); na Supabase projektu
podrazumevani SMTP za 1B. Resend se povezuje u 2C. Kriterijum završetka 1B
proverava se na Mailpit-u.

**Tiče se:** 1B, 2C.

### 8. Kamera u Expo Go

Faza 1D traži kameru, a razvojni build je planiran tek u 2C.

**Odluka:** 1D se prvo proba u Expo Go. Ako `expo-camera` ili
`expo-image-manipulator` ne rade, EAS development build se pravi već u 1D.

**Tiče se:** 1D.

---

## Menjaju šemu i RPC-ove, pa se odlučuju pre 1A

### 9. `open` nedostaje u glavnom putu

SPEC sekcija 5 opisuje glavni put bez statusa `open`, ali ga tabela prelaza i
sekcija 6 sadrže.

**Odluka:** dva ravnopravna puta — `draft → offered` kada vlasnik ima glavnog spremača,
`draft → open` kada nema tima. Oba kroz isti RPC `offer_task`.

**Tiče se:** 2A.

### 10. Istek nema RPC

U tabeli prelaza `open → expired` ima mehanizam „—", dok svi ostali prelazi imaju RPC.

**Odluka:** RPC `expire_tasks()` koji poziva cron, da i istek upiše `audit_log`
kao svaki drugi prelaz.

**Tiče se:** 2A, 2B.

### 11. Automatsko zatvaranje protivreči samo sebi

SPEC kaže „12 h posle `ready`, a najkasnije u vreme prijave gosta". Ako `ready`
padne u 11:00 a prijava je u 14:00, 12 h je 23:00 — posle prijave.

**Odluka:** `completed_at = min(ready_at + 12h, prijava gosta)`. Ako nema rezervacije,
`ready_at + 12h`.

**Tiče se:** 2A, 2B.

### 12. Spor nad zatvorenim zadatkom

Spor se otvara 24 h od `ready_at`, a zadatak se sam zatvara posle 12 h.

**Odluka:** namerno je i ostaje tako — tabela prelaza i dozvoljava `ready / completed → disputed`.
`resolve_dispute` vraća zadatak u `completed`, ili u `cancelled` ako posao nije odrađen.
`disputes.status` beleži ko je dobio (`resolved_owner` / `resolved_cleaner` / `split`).
SPEC koristi dva rečnika za isti ishod; ovo ih spaja.

**Tiče se:** 2A, 3B.

### 13. Neverifikovan spremač

Sekcija 6 dozvoljava vlasniku da angažuje spremača kog je lično pozvao;
sekcija 5 za `open → accepted` traži „Verifikovan".

**Odluka:** `accept_offer` proverava verifikaciju **samo** kada je zadatak došao sa tržišta
(status `open`). Direktna ponuda (`offered`) prolazi i bez verifikacije, uz oznaku
„Nije verifikovan" svuda u interfejsu.

**Tiče se:** 1D, 2A, 2C.

### 14. Kada se objavljuju ocene

Sekcije 4 i 6 kažu „kad obe strane ocene **ili** posle 7 dana"; kriterijum završetka 2E
kaže „tek kad obe strane pošalju".

**Odluka:** oba pravila. Objavi kada obe strane pošalju, ili 7 dana posle prve ocene
(dnevni cron). Test u 2E proverava prvi slučaj.

**Tiče se:** 2E.

### 15. Ping protiv pauziranja ne može iznutra

SPEC planira dnevni `pg_cron` ping da Supabase Free ne pauzira projekat. To ne radi:
ako je projekat pauziran, njegov `pg_cron` ne radi.

**Odluka:** ping dolazi spolja — zakazani GitHub Actions workflow jednom dnevno
poziva `health` Edge Function.

**Tiče se:** 2B, 4.

### 16. Ponovljene slike

SPEC kaže „isti `sha256` dva puta = sumnja", ali nema unique ograničenja.

**Odluka:** bez unique ograničenja u bazi — legitimni duplikati između različitih
apartmana su mogući. Provera se radi u `ai-inspect`, u okviru istog apartmana,
i upisuje u `fraud_flags`.

**Tiče se:** 1A (šema), 3A.

### 17. Brisanje slika posle 30 dana

Dnevni posao bi mogao da ostavi `property_reports.photo_ids` da pokazuje u prazno.

**Odluka:** posao preskače slike vezane za prijavu štete koja nije `resolved`.
Referentne slike se nikad ne brišu po roku — SPEC govori samo o slikama zadataka.

**Tiče se:** 2B, 2E.

### 18. Jezik AI odgovora

System prompt (koji SPEC traži doslovno) uvek odgovara na srpskom, a aplikacija ima engleski.

**Odluka:** u MVP-u ostaje srpski, prompt se ne menja. Engleski interfejs prikazuje
srpski AI tekst. Prevod AI poruka je i tako u SPEC sekciji 11 kao van opsega.

**Tiče se:** 3A, 3B.

---

## Dve napomene uz šemu

- `ai_inspections.status`, `disputes.status` i `property_reports.status` su `text`
  dok je sve ostalo enum. Dobijaju `CHECK` ograničenje sa dozvoljenim vrednostima;
  šema se inače ne menja.
- `subscriptions.properties_limit` se nigde ne primenjuje. U pilotu ostaje samo
  podatak za admina, bez provere pri dodavanju apartmana.

---

## Dopuna posle Faze 1D

### 19. Dokumenti zahteva o kom se nikad ne odluči

SPEC sekcija 9 traži da se slika dokumenta i selfi brišu „odmah posle odluke
administratora", ali ne kaže šta biva ako odluke nema: spremačica odustane,
administrator ne otvori red čekanja, ili stigne nov zahtev pre nego što je stari
rešen. Bez pravila lični dokumenti ostaju u storage-u zauvek, suprotno politici
privatnosti.

**Odluka:** dnevni posao `purge-verification-docs` (pg_cron, 3:15) briše:

1. fajlove zahteva koji su na čekanju duže od **7 dana** — zahtev se označava kao
   odbijen sa objašnjenjem da je istekao, da administrator ne gleda prazne okvire;
2. fajlove zahteva o kojima je odlučeno a brisanje nije prošlo;
3. fajlove koji u storage-u stoje bez ijednog zahteva.

Uz to, triger `verification_requests_supersede` odmah poništava stari zahtev na
čekanju kada stigne nov od iste spremačice, pa dnevni posao pokupi njegove fajlove.

**Tiče se:** 1D, 2B (tabela cron poslova).

**Podešavanje na pravom projektu.** Posao zove Edge Function preko pg_net, a
adresu i ključ čita iz vault-a — ne iz koda. Pre prvog pokretanja treba jednom
izvršiti, sa svojim vrednostima:

```sql
select vault.create_secret('https://<ref>.supabase.co/functions/v1', 'edge_functions_url');
select vault.create_secret('<service_role_key>', 'service_role_key');
```

Lokalno se to ne radi: testovi zovu funkciju direktno, pa ključ nigde ne ulazi u git.
