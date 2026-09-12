import { BookingDetailScreen } from "@/components/admin/detail/BookingDetailScreen";

export default async function AdminBookingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BookingDetailScreen id={id} />;
}
