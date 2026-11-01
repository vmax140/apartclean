import { Text, View } from 'react-native';
import { DEFAULT_LOCALE, TASK_STATUS_TONE, t, type TaskStatus } from '@apartclean/shared';

// Tamni režim prati sistemsku temu telefona (SPEC sekcija 7).
const TONE_CLASS = {
  ready: 'bg-ready-surface dark:bg-ready-surfaceDark',
  pending: 'bg-pending-surface dark:bg-pending-surfaceDark',
  problem: 'bg-problem-surface dark:bg-problem-surfaceDark',
  neutral: 'bg-neutral-100 dark:bg-neutral-800',
} as const;

const TONE_TEXT = {
  ready: 'text-ready-light dark:text-ready-dark',
  pending: 'text-pending-light dark:text-pending-dark',
  problem: 'text-problem-light dark:text-problem-dark',
  neutral: 'text-neutral-700 dark:text-neutral-200',
} as const;

const SHOWCASE: TaskStatus[] = ['ready', 'in_progress', 'needs_fixes'];

export default function Home() {
  return (
    <View className="flex-1 justify-center gap-6 bg-neutral-0 px-6 dark:bg-neutral-950">
      <View>
        <Text className="text-4xl font-bold text-neutral-900 dark:text-neutral-50">
          {t('app.name', DEFAULT_LOCALE)}
        </Text>
        <Text className="mt-2 text-lg text-accent-600 dark:text-accent-400">
          {t('app.tagline', DEFAULT_LOCALE)}
        </Text>
      </View>

      <Text className="text-neutral-600 dark:text-neutral-400">
        {t('app.description', DEFAULT_LOCALE)}
      </Text>

      <View className="flex-row flex-wrap gap-2">
        {SHOWCASE.map((status) => {
          const tone = TASK_STATUS_TONE[status];
          return (
            <View key={status} className={`rounded-full px-3 py-2 ${TONE_CLASS[tone]}`}>
              <Text className={`text-sm font-medium ${TONE_TEXT[tone]}`}>
                {t(`taskStatus.${status}`, DEFAULT_LOCALE)}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}
