import { SpaceDetailScreen } from "@/components/admin/detail/SpaceDetailScreen";

export default async function AdminSpacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SpaceDetailScreen id={id} />;
}
