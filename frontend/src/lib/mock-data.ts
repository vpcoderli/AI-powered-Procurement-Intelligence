import { STATE_CRAWLER_SOURCES } from "./state-crawler-sources";

export type IssuerType = "federal" | "state";
export type SortOption = "relevance" | "newest" | "deadline";
export type DatePreset = "any" | "next7" | "next30" | "last24" | "last7";

export interface BidAttachment {
  name: string;
  size: string;
  url: string;
  archiveStatus?: string;
  archiveError?: string;
  storagePath?: string;
}

export interface Bid {
  id: string;
  title: string;
  source: string;
  stateCode: string;
  issuerName: string;
  issuerType: IssuerType;
  amount: string;
  deadlineDate: string;
  publishedDate: string;
  description: string;
  fullDescription: string;
  originalCategory: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  sourceUrl: string;
  attachments: BidAttachment[];
  tags: string[];
  isActive: boolean;
  saved: boolean;
}

const US_STATE_NAMES_BY_CODE: Record<string, string> = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
};

const STATE_FILTER_ORDER = [
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY",
];

const stateCrawlerSourceStates = new Set<string>(STATE_CRAWLER_SOURCES.map((source) => source.stateCode));

export const STATE_FILTERS = [
  { id: "sam", label: "Federal (SAM.gov)", stateCode: "US", issuerType: "federal" as const },
  ...STATE_FILTER_ORDER.filter((stateCode) => stateCrawlerSourceStates.has(stateCode)).map((stateCode) => ({
    id: stateCode.toLowerCase(),
    label: `${US_STATE_NAMES_BY_CODE[stateCode]} (${stateCode})`,
    stateCode,
    issuerType: "state" as const,
  })),
];

export const MOCK_BIDS: Bid[] = [
  {
    id: "1",
    title: "Enterprise Cloud Migration Services",
    source: "SAM.gov",
    stateCode: "US",
    issuerName: "Department of Defense",
    issuerType: "federal",
    amount: "$5M - $10M",
    deadlineDate: "2026-06-15",
    publishedDate: "2026-05-01",
    description: "Seeking contractors to provide comprehensive cloud migration services for legacy on-premise infrastructure. Requires secure cloud delivery experience.",
    fullDescription: `## Overview\nThe Department of Defense is seeking qualified contractors to migrate legacy on-premise data centers to a secure cloud environment.\n\n## Scope of Work\n1. Assessment of current infrastructure\n2. Design of cloud architecture for government workloads\n3. Migration of 500+ applications\n4. Security compliance and authority-to-operate support\n\n## Requirements\n- Previous experience with federal cloud migrations.\n- FedRAMP High implementation experience.\n- Strong migration planning and documentation practices.`,
    originalCategory: "Information Technology",
    contactName: "Jordan Miller",
    contactEmail: "cloud-procurement@example.gov",
    contactPhone: "+1 (202) 555-0144",
    sourceUrl: "https://sam.gov/opp/12345",
    attachments: [
      { name: "Statement_of_Work_v2.pdf", size: "2.4 MB", url: "https://sam.gov/opp/12345/sow.pdf" },
      { name: "Pricing_Matrix_Template.xlsx", size: "156 KB", url: "https://sam.gov/opp/12345/pricing.xlsx" },
    ],
    tags: ["IT Services", "Cloud", "Federal"],
    isActive: true,
    saved: false,
  },
  {
    id: "2",
    title: "Statewide Broadband Infrastructure Upgrade",
    source: "Cal eProcure",
    stateCode: "CA",
    issuerName: "California Department of Technology",
    issuerType: "state",
    amount: "$15M - $25M",
    deadlineDate: "2026-05-22",
    publishedDate: "2026-05-18",
    description: "Implementation of high-speed broadband infrastructure across rural counties in Northern California, including fiber deployment and regional network hubs.",
    fullDescription: `## Overview\nThe State of California is launching a major initiative to bring high-speed internet to underserved rural communities in northern counties.\n\n## Project Goals\n- Lay more than 1,000 miles of new fiber optic cable.\n- Establish 50+ network distribution hubs.\n- Provide gigabit-capable connections to rural households and public facilities.\n\n## Vendor Expectations\nRespondents should demonstrate experience with permitting, right-of-way coordination, and public-sector infrastructure delivery.`,
    originalCategory: "Telecommunications",
    contactName: "Avery Chen",
    contactEmail: "broadband.procurement@example.ca.gov",
    contactPhone: "+1 (916) 555-0188",
    sourceUrl: "https://caleprocure.ca.gov/event/67890",
    attachments: [
      { name: "Project_Map_Northern_CA.pdf", size: "8.1 MB", url: "https://caleprocure.ca.gov/event/67890/project-map.pdf" },
      { name: "Environmental_Impact_Report.pdf", size: "12.5 MB", url: "https://caleprocure.ca.gov/event/67890/environmental-report.pdf" },
    ],
    tags: ["Telecommunications", "Infrastructure", "State"],
    isActive: true,
    saved: true,
  },
  {
    id: "3",
    title: "Cybersecurity Audit and Compliance",
    source: "Texas SmartBuy",
    stateCode: "TX",
    issuerName: "Texas Education Agency",
    issuerType: "state",
    amount: "$500K - $1M",
    deadlineDate: "2026-06-12",
    publishedDate: "2026-05-05",
    description: "Annual independent cybersecurity audit of state educational data systems with assessment coverage for privacy, access controls, and incident response readiness.",
    fullDescription: `## Objective\nConduct a comprehensive, independent cybersecurity audit of the Texas Education Agency's student data systems.\n\n## Tasks\n1. Penetration testing of public-facing portals.\n2. Review of identity and access management controls.\n3. Compliance assessment against FERPA and state privacy requirements.\n4. Delivery of a prioritized remediation roadmap.\n\n## Qualifications\nThe selected vendor should have public-sector audit experience and certified security professionals assigned to the engagement.`,
    originalCategory: "Cybersecurity",
    contactName: "Morgan Patel",
    contactEmail: "security.solicitations@example.tx.gov",
    contactPhone: "+1 (512) 555-0109",
    sourceUrl: "https://www.txsmartbuy.com/esbd/112233",
    attachments: [
      { name: "Audit_Requirements_Checklist.docx", size: "45 KB", url: "https://www.txsmartbuy.com/esbd/112233/checklist.docx" },
    ],
    tags: ["Cybersecurity", "Audit", "State"],
    isActive: true,
    saved: false,
  },
  {
    id: "4",
    title: "Healthcare Data Analytics Platform",
    source: "New York State Contract Reporter",
    stateCode: "NY",
    issuerName: "New York Department of Health",
    issuerType: "state",
    amount: "$2M - $4M",
    deadlineDate: "2026-07-10",
    publishedDate: "2026-05-10",
    description: "Development of a centralized data analytics platform to track public health metrics and forecast resource needs across state hospitals.",
    fullDescription: `## Background\nThe New York Department of Health requires a modern data analytics platform to replace legacy siloed reporting tools.\n\n## Deliverables\n- Centralized data lake for public health metrics.\n- Real-time dashboards for hospital capacity and supply tracking.\n- Predictive modeling for resource planning.\n- Secure API layer for authorized data exchange.\n\n## Technology Preferences\nThe department prefers scalable, cloud-agnostic architecture and strong documentation for long-term state operations.`,
    originalCategory: "Software Development",
    contactName: "Taylor Robinson",
    contactEmail: "health.analytics@example.ny.gov",
    contactPhone: "+1 (518) 555-0132",
    sourceUrl: "https://nyscr.ny.gov/opportunity/445566",
    attachments: [
      { name: "System_Architecture_Diagram.pdf", size: "1.2 MB", url: "https://nyscr.ny.gov/opportunity/445566/architecture.pdf" },
      { name: "Data_Governance_Addendum.pdf", size: "320 KB", url: "https://nyscr.ny.gov/opportunity/445566/governance.pdf" },
    ],
    tags: ["Software Development", "Healthcare", "Data Analytics"],
    isActive: true,
    saved: false,
  },
  {
    id: "5",
    title: "Emergency Response Logistics Modernization",
    source: "MyFloridaMarketPlace",
    stateCode: "FL",
    issuerName: "Florida Division of Emergency Management",
    issuerType: "state",
    amount: "$1M - $2.5M",
    deadlineDate: "2026-06-22",
    publishedDate: "2026-05-11",
    description: "Modernization of emergency response logistics software for statewide inventory visibility, supplier coordination, and disaster deployment planning.",
    fullDescription: `## Summary\nThe Florida Division of Emergency Management is seeking a partner to modernize logistics coordination for emergency response operations.\n\n## Scope\n- Replace spreadsheet-based inventory tracking.\n- Integrate supplier status updates and shipment milestones.\n- Support role-based access for state and county teams.\n- Provide implementation, training, and operational documentation.\n\n## Desired Outcomes\nThe solution should improve response speed, reduce manual coordination, and provide reliable reporting during hurricane and flood events.`,
    originalCategory: "Emergency Management",
    contactName: "Casey Nguyen",
    contactEmail: "logistics.rfp@example.fl.gov",
    contactPhone: "+1 (850) 555-0167",
    sourceUrl: "https://vendor.myfloridamarketplace.com/bids/998877",
    attachments: [],
    tags: ["Logistics", "Emergency Management", "Software"],
    isActive: true,
    saved: false,
  },
  {
    id: "6",
    title: "Public Transit Fare Collection Upgrade",
    source: "Illinois Procurement Bulletin",
    stateCode: "IL",
    issuerName: "Illinois Department of Transportation",
    issuerType: "state",
    amount: "$3M - $6M",
    deadlineDate: "2026-07-01",
    publishedDate: "2026-05-12",
    description: "Upgrade of regional public transit fare collection systems, including mobile ticketing, account-based payments, and reporting integrations.",
    fullDescription: `## Program Need\nThe Illinois Department of Transportation is coordinating a fare collection upgrade for regional transit partners.\n\n## Required Capabilities\n1. Mobile ticketing and account-based fare payment.\n2. Integration with existing vehicle validators and back-office systems.\n3. Reporting tools for ridership, revenue, and reconciliation.\n4. Accessibility-focused user experience for riders and agency staff.\n\n## Implementation\nThe vendor will provide deployment planning, system configuration, data migration, testing, and post-launch support.`,
    originalCategory: "Transportation Technology",
    contactName: "Riley Johnson",
    contactEmail: "transit.procurement@example.il.gov",
    contactPhone: "+1 (217) 555-0155",
    sourceUrl: "https://www.bidbuy.illinois.gov/bso/external/bidDetail.sdo?docId=556677",
    attachments: [
      { name: "Fare_System_Functional_Requirements.pdf", size: "980 KB", url: "https://www.bidbuy.illinois.gov/docs/556677/requirements.pdf" },
    ],
    tags: ["Transportation", "Payments", "State"],
    isActive: true,
    saved: false,
  },
];
