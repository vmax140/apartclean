import { describe, expect, it } from 'vitest';
import { UploadQueue, memoryStorage, type QueueStorage } from './upload-queue';

// Red za slanje je jedini deo Faze 2D koji se inače proverava samo u režimu
// aviona. Ovde se proverava ovde, sa upravljivim satom i skladištem.

type Photo = { name: string };

function clock(start = 1_000_000) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

function failingSender(failUntilCall: number) {
  let calls = 0;
  const seen: string[] = [];
  return {
    seen,
    get calls() {
      return calls;
    },
    send: async (photo: Photo) => {
      calls += 1;
      if (calls <= failUntilCall) throw new Error('nema mreže');
      seen.push(photo.name);
    },
  };
}

describe('red preživljava nestanak mreže', () => {
  it('čuva stavke i šalje ih redom kojim su nastale', async () => {
    const storage = memoryStorage();
    const sender = failingSender(0);
    const queue = new UploadQueue<Photo>(storage, 'photos', sender.send);

    for (const name of ['a', 'b', 'c']) await queue.add({ name });
    expect(await queue.size()).toBe(3);

    const result = await queue.flush();
    expect(result).toEqual({ sent: 3, failed: 0, remaining: 0 });
    // Redosled je bitan: slike moraju da stignu pre predaje.
    expect(sender.seen).toEqual(['a', 'b', 'c']);
  });

  it('neuspela stavka ostaje u redu i čeka pauzu', async () => {
    const time = clock();
    const storage = memoryStorage();
    const sender = failingSender(1);
    const queue = new UploadQueue<Photo>(storage, 'photos', sender.send, time.now);

    await queue.add({ name: 'a' });
    expect(await queue.flush()).toEqual({ sent: 0, failed: 1, remaining: 1 });

    // Odmah posle neuspeha ne pokušava ponovo — pauza još traje.
    expect(await queue.flush()).toEqual({ sent: 0, failed: 0, remaining: 1 });
    expect(sender.calls).toBe(1);

    time.advance(6_000);
    expect(await queue.flush()).toEqual({ sent: 1, failed: 0, remaining: 0 });
    expect(sender.seen).toEqual(['a']);
  });

  it('pauza raste sa brojem pokušaja', async () => {
    const time = clock();
    const storage = memoryStorage();
    const queue = new UploadQueue<Photo>(
      storage,
      'photos',
      async () => {
        throw new Error('nema mreže');
      },
      time.now,
    );
    await queue.add({ name: 'a' });

    await queue.flush();
    const afterFirst = (await queue.items())[0]!;
    time.advance(6_000);
    await queue.flush();
    const afterSecond = (await queue.items())[0]!;

    const firstWait = new Date(afterFirst.nextAttemptAt).getTime() - 1_000_000;
    const secondWait = new Date(afterSecond.nextAttemptAt).getTime() - 1_006_000;
    expect(secondWait).toBeGreaterThan(firstWait);
    expect(afterSecond.attempts).toBe(2);
    expect(afterSecond.lastError).toBe('nema mreže');
  });

  it('posle osam pokušaja odustaje, da ne troši bateriju doveka', async () => {
    const time = clock();
    const queue = new UploadQueue<Photo>(
      memoryStorage(),
      'photos',
      async () => {
        throw new Error('nema mreže');
      },
      time.now,
    );
    await queue.add({ name: 'a' });

    for (let attempt = 0; attempt < 8; attempt++) {
      await queue.flush();
      time.advance(600_000);
    }
    expect(await queue.size()).toBe(0);
  });

  it('stavke koje se muče su izdvojene za prikaz', async () => {
    const time = clock();
    const queue = new UploadQueue<Photo>(
      memoryStorage(),
      'photos',
      async () => {
        throw new Error('nema mreže');
      },
      time.now,
    );
    await queue.add({ name: 'a' });
    for (let attempt = 0; attempt < 3; attempt++) {
      await queue.flush();
      time.advance(600_000);
    }
    expect((await queue.stuck()).length).toBe(1);
  });

  it('dva istovremena slanja ne šalju istu stavku dvaput', async () => {
    const storage = memoryStorage();
    let calls = 0;
    // Slanje se drži otvorenim dok se drugi flush ne pokrene — bez tajmera, da
    // ishod ne zavisi od brzine mašine.
    let release: () => void = () => {};
    const inFlight = new Promise<void>((resolve) => {
      release = resolve;
    });

    const queue = new UploadQueue<Photo>(storage, 'photos', async () => {
      calls += 1;
      await inFlight;
    });
    await queue.add({ name: 'a' });

    const both = Promise.all([queue.flush(), queue.flush()]);
    release();
    const [first, second] = await both;

    expect(calls).toBe(1);
    expect(first.sent + second.sent).toBe(1);
  });

  it('pokvaren zapis ne zaključava red', async () => {
    const broken: QueueStorage = {
      read: async () => '{ovo nije JSON',
      write: async () => {},
    };
    const queue = new UploadQueue<Photo>(broken, 'photos', async () => {});
    expect(await queue.size()).toBe(0);
    expect(await queue.flush()).toEqual({ sent: 0, failed: 0, remaining: 0 });
  });
});

describe('režim aviona (kriterijum završetka 2D)', () => {
  it('osam slika čeka bez mreže, pa sve stignu kada se mreža vrati', async () => {
    const time = clock();
    const storage = memoryStorage();
    let online = false;
    const arrived: string[] = [];

    const queue = new UploadQueue<Photo>(
      storage,
      'photos',
      async (photo) => {
        if (!online) throw new Error('nema mreže');
        arrived.push(photo.name);
      },
      time.now,
    );

    // Spremačica radi u režimu aviona.
    for (let index = 1; index <= 8; index++) await queue.add({ name: `soba-${index}.jpg` });
    const offline = await queue.flush();
    expect(offline.sent).toBe(0);
    expect(offline.remaining).toBe(8);
    expect(arrived).toEqual([]);

    // Red je preživeo i gašenje aplikacije: nova instanca čita isto skladište.
    const resumed = new UploadQueue<Photo>(
      storage,
      'photos',
      async (photo) => {
        if (!online) throw new Error('nema mreže');
        arrived.push(photo.name);
      },
      time.now,
    );
    expect(await resumed.size()).toBe(8);

    online = true;
    time.advance(10_000);
    const result = await resumed.flush();

    expect(result).toEqual({ sent: 8, failed: 0, remaining: 0 });
    expect(arrived).toHaveLength(8);
    expect(arrived[0]).toBe('soba-1.jpg');
    expect(arrived[7]).toBe('soba-8.jpg');
  });
});
