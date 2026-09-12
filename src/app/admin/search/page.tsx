import { Suspense } from "react";

import { SearchScreen } from "@/components/admin/sections/SearchScreen";

export default function AdminSearchPage() {
  // useSearchParams needs a Suspense boundary in the App Router.
  return (
    <Suspense fallback={null}>
      <SearchScreen />
    </Suspense>
  );
}
