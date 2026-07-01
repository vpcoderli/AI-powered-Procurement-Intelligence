import type { Metadata } from "next";
import { SupplierWorkflowPage } from "../resource-pages";

export const metadata: Metadata = {
  title: "Supplier Pursuit Workflow | WinBids Resources",
  description: "A Match-to-Learn public-sector pursuit workflow for suppliers preparing bids with WinBids.",
};

export default function SupplierWorkflowResourcePage() {
  return <SupplierWorkflowPage />;
}
