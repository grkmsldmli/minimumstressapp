import { CommandScreen } from "@/components/admin/command/CommandScreen";

/** The founder home. Gated by the segment layout; data comes from the
 *  staff-gated /api/admin/command route. */
export default function AdminCommandPage() {
  return <CommandScreen />;
}
