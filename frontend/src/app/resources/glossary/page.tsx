import type { Metadata } from "next";
import { ResourceGlossaryPage } from "../resource-pages";

export const metadata: Metadata = {
  title: "Public Bid Glossary | WinBids Resources",
  description: "Plain-language public procurement terms for suppliers using WinBids to understand bids, amendments, responsiveness, and awards.",
};

export default function GlossaryPage() {
  return <ResourceGlossaryPage />;
}
