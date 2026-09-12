import { AdminDashboard } from "@/components/admin/dashboard";

/**
 * Trust & Safety / Operations.
 *
 * The full existing operations console — refunds, claims, safety escalations,
 * listing/insurance/credential review, at-risk accounts, unpayable hosts, the
 * directories, money chart, funnel and activity — preserved verbatim and mounted
 * here so no operational capability is lost while the command center grows around
 * it. Its decisions now also write to the admin audit log (see the API route).
 */
export default function AdminTrustPage() {
  return <AdminDashboard />;
}
