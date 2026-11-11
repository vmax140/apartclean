import { PropertyDetails } from '@/components/property-details';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PropertyDetails id={id} />;
}
