import { handled, jsonError, requireUser } from "@/lib/api/session";
import { oneSignalExternalId } from "@/lib/onesignal/identity";

/** Return only the signed-in person's unguessable OneSignal alias. */
export async function GET(): Promise<Response> {
  return handled(async () => {
    const auth = await requireUser();
    if ("response" in auth) return auth.response;

    const externalId = oneSignalExternalId(auth.user.id);
    if (!externalId) return jsonError("Push notifications are not configured", 503);

    return Response.json(
      { externalId },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  });
}
