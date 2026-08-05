import { notFound } from "next/navigation";

import { AdminDashboard } from "@/components/admin/dashboard";
import { isStaff } from "@/lib/admin/access";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * The staff queue.
 *
 * Rendered on the server and gated here as well as on the API route behind it.
 * Two checks rather than one because they fail differently: this one stops the
 * page being drawn at all, and the route stops the data being fetched by
 * anything else that asks. Losing either alone would still be safe; the point
 * is that losing one is not silent.
 *
 * `notFound()` rather than a redirect or a message. An admin page that says
 * "you are not an admin" has confirmed it exists.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Queue",
  // Nothing here should ever be indexed, quite apart from the fact that it is
  // unreachable without a session.
  robots: { index: false, follow: false },
};

export default async function AdminPage() {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();

  if (!isStaff(data.user?.email)) notFound();

  return <AdminDashboard />;
}
