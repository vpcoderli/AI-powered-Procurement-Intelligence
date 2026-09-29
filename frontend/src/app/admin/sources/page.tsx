"use client";

import { Suspense } from "react";
import { SourcesListView } from "@/components/admin/sources/SourcesListView";

// useSearchParams() in SourcesListView needs a Suspense boundary for the static prerender.
export default function AdminSourcesPage() {
  return (
    <Suspense fallback={null}>
      <SourcesListView />
    </Suspense>
  );
}
