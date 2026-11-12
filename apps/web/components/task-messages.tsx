'use client';

import { useEffect, useRef, useState } from 'react';
import { t, type TranslationKey } from '@apartclean/shared';
import {
  listMessages,
  sendMessage,
  subscribeToMessages,
  type Message,
} from '@apartclean/shared/closing';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';

// Poruke po zadatku preko Realtime-a (SPEC sekcija 2 i 7).
// RLS važi i na Realtime kanalu, pa red stiže samo učesnicima zadatka.

export function TaskMessages({ taskId, userId }: { taskId: string; userId: string | null }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState<TranslationKey | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    let active = true;

    void listMessages(client, taskId)
      .then((data) => active && setMessages(data))
      .catch(() => active && setProblem('messages.failed'));

    const channel = subscribeToMessages(client, taskId, (message) => {
      // Ista poruka ume da stigne i kroz odgovor na upis i kroz kanal.
      setMessages((current) =>
        current.some((other) => other.id === message.id) ? current : [...current, message],
      );
    });

    return () => {
      active = false;
      void client.removeChannel(channel);
    };
  }, [taskId]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  return (
    <section className="grid gap-3">
      <h2 className="text-lg font-medium">{t('messages.title')}</h2>

      {problem && (
        <p role="alert" className="text-destructive">
          {t(problem)}
        </p>
      )}

      <div className="grid max-h-80 gap-2 overflow-y-auto rounded-lg border p-3">
        {messages.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('messages.none')}</p>
        )}
        {messages.map((message) => {
          const mine = message.sender_id === userId;
          return (
            <p
              key={message.id}
              className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                mine ? 'ml-auto bg-primary text-primary-foreground' : 'bg-secondary'
              }`}
            >
              {message.body}
              <span className={`block text-xs ${mine ? 'opacity-70' : 'text-muted-foreground'}`}>
                {new Date(message.created_at).toLocaleTimeString('sr-Latn-RS', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </p>
          );
        })}
        <div ref={bottom} />
      </div>

      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const client = supabase;
          if (!client || draft.trim() === '') return;
          const text = draft;
          setDraft('');
          void sendMessage(client, taskId, text).catch(() => {
            setProblem('messages.failed');
            setDraft(text);
          });
        }}
      >
        <input
          className="min-h-touch flex-1 rounded-md border bg-background px-3"
          placeholder={t('messages.placeholder')}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <Button type="submit" disabled={draft.trim() === ''}>
          {t('messages.send')}
        </Button>
      </form>
    </section>
  );
}
