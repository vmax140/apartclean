import { randomId } from './id';

// Red za slanje koji preživljava gašenje aplikacije i nestanak mreže
// (SPEC sekcija 6, Izuzeci: „dolazak, checklista i slike rade offline").
//
// Logika je namerno odvojena od React Native-a: skladište je ubačeno spolja, pa
// se ponašanje reda — ponavljanje, pauze, redosled — testira bez telefona. To je
// jedini deo Faze 2D koji se inače proverava samo u režimu aviona.

export type QueueItem<T> = {
  id: string;
  payload: T;
  attempts: number;
  createdAt: string;
  nextAttemptAt: string;
  lastError?: string;
};

export type QueueStorage = {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
};

export type FlushResult = { sent: number; failed: number; remaining: number };

/** Pauze rastu, ali staju na 5 minuta: posle toga nema smisla čekati duže. */
const BACKOFF_MS = [0, 5_000, 15_000, 60_000, 300_000];
const MAX_ATTEMPTS = 8;

function backoffFor(attempts: number) {
  return BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length - 1)]!;
}

export class UploadQueue<T> {
  private flushing = false;

  constructor(
    private readonly storage: QueueStorage,
    private readonly key: string,
    private readonly send: (payload: T) => Promise<void>,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async items(): Promise<QueueItem<T>[]> {
    const raw = await this.storage.read(this.key);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as QueueItem<T>[]) : [];
    } catch {
      // Pokvaren zapis ne sme da zaključa red zauvek.
      return [];
    }
  }

  async size() {
    return (await this.items()).length;
  }

  async add(payload: T) {
    const item: QueueItem<T> = {
      id: randomId(),
      payload,
      attempts: 0,
      createdAt: new Date(this.now()).toISOString(),
      nextAttemptAt: new Date(this.now()).toISOString(),
    };
    await this.save([...(await this.items()), item]);
    return item.id;
  }

  async clear() {
    await this.save([]);
  }

  /**
   * Šalje sve što je na redu. Stavke idu redom kojim su nastale, jer slike
   * moraju da stignu pre predaje. Neuspela stavka ostaje u redu sa novom pauzom.
   */
  async flush(): Promise<FlushResult> {
    if (this.flushing) {
      return { sent: 0, failed: 0, remaining: await this.size() };
    }
    this.flushing = true;
    try {
      let queue = await this.items();
      let sent = 0;
      let failed = 0;

      for (const item of [...queue]) {
        if (new Date(item.nextAttemptAt).getTime() > this.now()) continue;

        try {
          await this.send(item.payload);
          queue = queue.filter((other) => other.id !== item.id);
          sent += 1;
        } catch (problem) {
          failed += 1;
          const attempts = item.attempts + 1;
          const message = problem instanceof Error ? problem.message : 'nepoznata greška';
          queue = queue.map((other) =>
            other.id === item.id
              ? {
                  ...other,
                  attempts,
                  lastError: message,
                  nextAttemptAt: new Date(this.now() + backoffFor(attempts)).toISOString(),
                }
              : other,
          );
          // Posle osam pokušaja stavka se odustaje: dalje ponavljanje samo troši
          // bateriju, a spremačica mora da zna da nešto nije prošlo.
          if (attempts >= MAX_ATTEMPTS) {
            queue = queue.filter((other) => other.id !== item.id);
          }
        }
        await this.save(queue);
      }

      return { sent, failed, remaining: queue.length };
    } finally {
      this.flushing = false;
    }
  }

  /** Stavke koje su odustale ili čekaju duže od očekivanog — za prikaz korisniku. */
  async stuck(): Promise<QueueItem<T>[]> {
    return (await this.items()).filter((item) => item.attempts >= 3);
  }

  private async save(items: QueueItem<T>[]) {
    await this.storage.write(this.key, JSON.stringify(items));
  }
}

/** Skladište u memoriji — za testove i za web, gde red ne mora da preživi gašenje. */
export function memoryStorage(): QueueStorage {
  const map = new Map<string, string>();
  return {
    read: async (key) => map.get(key) ?? null,
    write: async (key, value) => {
      map.set(key, value);
    },
  };
}
