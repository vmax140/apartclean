'use client';

import { useEffect, useState } from 'react';
import { t, type TranslationKey } from '@apartclean/shared';
import { getReviews, submitReview, type Review } from '@apartclean/shared/closing';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';

// Ocene u oba smera, dvostruko slepe (SPEC sekcija 6, korak 10).
// Dok obe strane ne ocene, RLS propušta samo sopstvenu ocenu — zato se tuđa
// ovde i ne traži: ako je vidljiva, znači da je objavljena.

const SCORES = [1, 2, 3, 4, 5] as const;

function Stars({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="grid gap-1">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex gap-1">
        {SCORES.map((score) => (
          <button
            key={score}
            type="button"
            aria-label={`${label}: ${score}`}
            aria-pressed={value === score}
            onClick={() => onChange(score)}
            className={`min-h-touch min-w-touch rounded-md border text-lg ${
              score <= value ? 'border-accent bg-accent/10 text-accent' : 'text-muted-foreground'
            }`}
          >
            ★
          </button>
        ))}
      </div>
    </div>
  );
}

export function TaskReview({ taskId, userId }: { taskId: string; userId: string | null }) {
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [rating, setRating] = useState(0);
  const [quality, setQuality] = useState(0);
  const [punctuality, setPunctuality] = useState(0);
  const [communication, setCommunication] = useState(0);
  const [comment, setComment] = useState('');
  const [message, setMessage] = useState<TranslationKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    let active = true;
    void getReviews(client, taskId)
      .then((data) => active && setReviews(data))
      .catch(() => active && setReviews([]));
    return () => {
      active = false;
    };
  }, [taskId, reloadToken]);

  if (!reviews) return <p role="status">{t('common.loading')}</p>;

  const mine = reviews.find((review) => review.reviewer_id === userId);
  const published = reviews.filter((review) => review.published_at !== null);

  return (
    <section className="grid gap-4">
      <h2 className="text-lg font-medium">{t('review.title')}</h2>

      {message && (
        <p role="status" className={message === 'review.sent' ? 'text-accent' : 'text-destructive'}>
          {t(message)}
        </p>
      )}

      {mine ? (
        <p className="text-sm text-muted-foreground">
          {published.length >= 2 ? t('review.published') : t('review.waiting')}
        </p>
      ) : (
        <div className="grid gap-4 rounded-lg border p-4">
          <Stars label={t('review.rating')} value={rating} onChange={setRating} />
          <Stars label={t('review.quality')} value={quality} onChange={setQuality} />
          <Stars label={t('review.punctuality')} value={punctuality} onChange={setPunctuality} />
          <Stars
            label={t('review.communication')}
            value={communication}
            onChange={setCommunication}
          />
          <label className="grid gap-1 text-sm">
            {t('review.comment')}
            <textarea
              className="min-h-20 w-full rounded-md border bg-background p-3"
              value={comment}
              onChange={(event) => setComment(event.target.value)}
            />
          </label>
          <Button
            disabled={rating === 0 || busy}
            onClick={() => {
              const client = supabase;
              if (!client) return;
              setBusy(true);
              setMessage(null);
              void submitReview(client, taskId, {
                rating,
                quality: quality || undefined,
                punctuality: punctuality || undefined,
                communication: communication || undefined,
                comment: comment || undefined,
              })
                .then(() => {
                  setMessage('review.sent');
                  setReloadToken((value) => value + 1);
                })
                .catch((problem: Error) => {
                  setMessage(
                    problem.message === 'VEC_OCENJENO'
                      ? 'review.already'
                      : problem.message === 'POGRESAN_STATUS'
                        ? 'review.onlyCompleted'
                        : 'review.failed',
                  );
                })
                .finally(() => setBusy(false));
            }}
          >
            {t('review.send')}
          </Button>
        </div>
      )}

      {published.map((review) => (
        <article key={review.id} className="grid gap-1 rounded-lg border p-4">
          <p className="font-medium">{'★'.repeat(review.rating)}</p>
          {review.comment && <p className="text-sm">{review.comment}</p>}
          <p className="text-xs text-muted-foreground">
            {t(`role.${review.direction === 'owner_to_cleaner' ? 'owner' : 'cleaner'}`)}
          </p>
        </article>
      ))}
    </section>
  );
}
