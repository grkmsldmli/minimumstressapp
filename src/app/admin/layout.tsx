import { AdminShell } from "@/components/admin/layout/AdminShell";
import { assertStaffPage } from "@/lib/admin/page-guard";

/**
 * The admin command center frame. Gated here on the server for the whole
 * /admin/* segment — a non-staff request never renders any admin page — and each
 * API route behind these screens re-checks staff independently. Nothing here is
 * ever indexed or reachable without a session.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Command center",
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await assertStaffPage();
  return <AdminShell>{children}</AdminShell>;
}
