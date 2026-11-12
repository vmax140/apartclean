import { TaskDetails } from '@/components/task-details';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TaskDetails id={id} />;
}
