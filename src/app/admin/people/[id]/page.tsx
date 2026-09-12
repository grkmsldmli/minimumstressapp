import { PersonDetailScreen } from "@/components/admin/detail/PersonDetailScreen";

export default async function AdminPersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PersonDetailScreen id={id} />;
}
