export const MOCK_BIDS = [
  {
    id: "1",
    title: "Enterprise Cloud Migration Services",
    source: "SAM.gov",
    agency: "Department of Defense",
    amount: "$5M - $10M",
    deadline: "2024-05-15",
    posted: "2024-04-10",
    description: "Seeking contractors to provide comprehensive cloud migration services for legacy on-premise infrastructure. Requires Top Secret clearance.",
    fullDescription: `## Overview\nThe Department of Defense is seeking qualified contractors to migrate legacy on-premise data centers to a secure cloud environment.\n\n## Scope of Work\n1. Assessment of current infrastructure\n2. Design of cloud architecture (AWS GovCloud or Azure Government)\n3. Migration of 500+ applications\n4. Security compliance and ATO (Authority to Operate) preparation\n\n## Requirements\n- Must possess Top Secret facility clearance.\n- Previous experience with DoD cloud migrations.\n- ISO 27001 and FedRAMP High compliance.`,
    tags: ["IT Services", "Cloud", "Federal"],
    saved: false,
    sourceUrl: "https://sam.gov/opp/12345",
    attachments: [
      { name: "Statement_of_Work_v2.pdf", size: "2.4 MB", url: "#" },
      { name: "Pricing_Matrix_Template.xlsx", size: "156 KB", url: "#" }
    ]
  },
  {
    id: "2",
    title: "Statewide Broadband Infrastructure Upgrade",
    source: "State of CA",
    agency: "California Dept of Technology",
    amount: "$15M - $25M",
    deadline: "2024-06-01",
    posted: "2024-04-15",
    description: "Implementation of high-speed broadband infrastructure across rural counties in Northern California. Includes laying fiber optic cables and establishing network hubs.",
    fullDescription: `## Overview\nThe State of California is launching a major initiative to bring high-speed internet to underserved rural communities in the northern counties.\n\n## Project Goals\n- Lay over 1,000 miles of new fiber optic cable.\n- Establish 50+ new network distribution hubs.\n- Provide gigabit-capable connections to at least 100,000 rural households.\n\n## Timeline\n- Phase 1: Environmental assessment (Months 1-3)\n- Phase 2: Trenching and cable laying (Months 4-12)\n- Phase 3: Hub construction and testing (Months 13-18)`,
    tags: ["Telecommunications", "Infrastructure", "State"],
    saved: true,
    sourceUrl: "https://caleprocure.ca.gov/event/67890",
    attachments: [
      { name: "Project_Map_Northern_CA.pdf", size: "8.1 MB", url: "#" },
      { name: "Environmental_Impact_Report.pdf", size: "12.5 MB", url: "#" }
    ]
  },
  {
    id: "3",
    title: "Cybersecurity Audit and Compliance",
    source: "State of TX",
    agency: "Texas Education Agency",
    amount: "$500K - $1M",
    deadline: "2024-05-20",
    posted: "2024-04-18",
    description: "Annual independent cybersecurity audit of state educational data systems. Must comply with FERPA and state privacy regulations.",
    fullDescription: `## Objective\nConduct a comprehensive, independent cybersecurity audit of the Texas Education Agency's student data systems.\n\n## Tasks\n1. Penetration testing of public-facing portals.\n2. Code review of custom authentication modules.\n3. Compliance check against FERPA and Texas state privacy laws.\n4. Delivery of a prioritized remediation report.\n\n## Qualifications\n- Certified Information Systems Security Professional (CISSP) required for lead auditor.\n- Firm must have 5+ years experience auditing state-level government systems.`,
    tags: ["Cybersecurity", "Audit", "State"],
    saved: false,
    sourceUrl: "https://www.txsmartbuy.com/esbd/112233",
    attachments: [
      { name: "Audit_Requirements_Checklist.docx", size: "45 KB", url: "#" }
    ]
  },
  {
    id: "4",
    title: "Healthcare Data Analytics Platform",
    source: "State of NY",
    agency: "Department of Health",
    amount: "$2M - $4M",
    deadline: "2024-06-15",
    posted: "2024-04-20",
    description: "Development of a centralized data analytics platform to track public health metrics and predict resource needs across state hospitals.",
    fullDescription: `## Background\nThe NY Department of Health requires a modern, scalable data analytics platform to replace legacy siloed databases.\n\n## Deliverables\n- Centralized Data Lake (HIPAA compliant).\n- Real-time dashboard for tracking hospital bed capacity, ventilator usage, and supply levels.\n- Predictive modeling module for epidemic outbreaks.\n- API layer for secure data sharing with authorized research institutions.\n\n## Technology Preferences\n- Preference for open-source big data tools (e.g., Apache Spark, Kafka).\n- Cloud-agnostic deployment architecture (Kubernetes/Docker).`,
    tags: ["Software Development", "Healthcare", "Data Analytics"],
    saved: false,
    sourceUrl: "https://nyspro.ogs.ny.gov/contract/445566",
    attachments: [
      { name: "System_Architecture_Diagram.pdf", size: "1.2 MB", url: "#" },
      { name: "HIPAA_Compliance_Addendum.pdf", size: "320 KB", url: "#" }
    ]
  }
];
