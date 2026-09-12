import "server-only";

import { notFound } from "next/navigation";

import { supabaseServer } from "@/lib/supabase/server";

import { isStaff } from "./access";

/**
 * The page-side half of the admin gate (the API routes gate themselves via
 * adminGet). notFound() rather than a redirect or a message: an admin page that
 * says "you are not an admin" has confirmed it exists.
 */
export async function assertStaffPage(): Promise<void> {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!isStaff(data.user?.email)) notFound();
}
