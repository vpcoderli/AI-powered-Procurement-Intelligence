import type { Metadata } from "next";
import { ResourceHubPage } from "./resource-pages";

export const metadata: Metadata = {
  title: "WinBids Resources | Public Procurement Guides",
  description: "Public procurement glossary, supplier workflow guides, and safe WinBids pursuit resources for U.S. suppliers.",
};

export default function ResourcesPage() {
  return <ResourceHubPage />;
}
