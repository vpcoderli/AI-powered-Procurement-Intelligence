import {
  ArrowRight,
  BadgeCheck,
  BookOpenCheck,
  Boxes,
  Building2,
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  ClipboardCheck,
  FileCheck2,
  Gauge,
  GraduationCap,
  Landmark,
  LibraryBig,
  PackageCheck,
  Route,
  Search,
  ShieldCheck,
  Sparkles,
  Truck,
} from "lucide-react";
import styles from "./page.module.css";

const navItems = [
  { label: "Command Center", icon: Boxes, active: true },
  { label: "Bid Discovery", icon: Search },
  { label: "Supplier Profile", icon: BadgeCheck },
  { label: "Intent Workspace", icon: ClipboardCheck },
  { label: "Submission Path", icon: Route },
  { label: "Knowledge Station", icon: LibraryBig },
];

const highFitBids = [
  {
    title: "Citywide Facility Maintenance Services",
    agency: "City of Denver General Services",
    meta: "RFP · Due Jun 18, 2026 · $450K-$750K",
    score: 92,
    status: "New",
    tone: "good",
  },
  {
    title: "District Office Janitorial Services",
    agency: "Austin Independent School District",
    meta: "IFB · Due Jun 21, 2026 · Small business encouraged",
    score: 88,
    status: "Saved",
    tone: "blue",
  },
  {
    title: "Emergency Shelter Supply Kits",
    agency: "State of New York Emergency Management",
    meta: "RFQ · Due Jun 11, 2026 · Fast response window",
    score: 81,
    status: "Risk",
    tone: "warn",
  },
];

const moduleMap = [
  {
    kicker: "Product 1",
    title: "Bid Discovery",
    body: "Find, filter, compare, and explain matched opportunities.",
    icon: Search,
  },
  {
    kicker: "Core profile",
    title: "Supplier Profile",
    body: "Company capability, coverage, certifications, and preferences.",
    icon: Building2,
  },
  {
    kicker: "Products 3-5",
    title: "Pursuit Pipeline",
    body: "Response workspace, submission guidance, award tracking, learning.",
    icon: PackageCheck,
  },
  {
    kicker: "Support layer",
    title: "Knowledge Station",
    body: "Reusable answers, templates, snippets, and lessons memory.",
    icon: LibraryBig,
  },
];

const readinessItems = [
  "Review all solicitation documents and attachments",
  "Confirm insurance limits before submission",
  "Check addenda acknowledgement requirement",
  "Verify external portal registration",
  "Capture submission receipt after upload",
];

const pipeline = [
  {
    title: "Intent",
    count: "4",
    items: ["Facility Maintenance", "Shelter Supply Kits"],
  },
  {
    title: "Review",
    count: "3",
    items: ["Insurance check", "Q&A deadline"],
  },
  {
    title: "Prepare",
    count: "2",
    items: ["Pricing worksheet", "Capability statement"],
  },
  {
    title: "Submitted",
    count: "1",
    items: ["Transit Shelter Repair"],
  },
];

const metrics = [
  { label: "High-fit bids", value: "12", icon: Gauge },
  { label: "Active pursuits", value: "7", icon: ClipboardCheck },
  { label: "Submission risks", value: "3", icon: CircleAlert },
  { label: "Ready artifacts", value: "18", icon: FileCheck2 },
];

export default function WinBidsDemoPage() {
  return (
    <main className={styles.demoShell}>
      <aside className={styles.sidebar} aria-label="WinBids demo navigation">
        <a className={styles.brand} href="#overview" aria-label="WinBids demo home">
          <span className={styles.brandMark}>WB</span>
          <span>
            <strong>WinBids</strong>
            <small>MVP UX Prototype v2</small>
          </span>
        </a>

        <nav className={styles.navList} aria-label="Prototype modules">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <a
                key={item.label}
                className={`${styles.navItem} ${item.active ? styles.navItemActive : ""}`}
                href={item.label === "Submission Path" ? "#submission" : "#overview"}
              >
                <Icon size={18} aria-hidden="true" />
                <span>{item.label}</span>
              </a>
            );
          })}
        </nav>

        <section className={styles.sidebarPanel} aria-label="Prototype coverage">
          <p>Prototype includes</p>
          <div className={styles.checkLine}>
            <CheckCircle2 size={15} aria-hidden="true" />
            Bid Match
          </div>
          <div className={styles.checkLine}>
            <CheckCircle2 size={15} aria-hidden="true" />
            AI summary
          </div>
          <div className={styles.checkLine}>
            <CheckCircle2 size={15} aria-hidden="true" />
            Submission Path
          </div>
        </section>
      </aside>

      <section className={styles.workspace}>
        <header className={styles.topbar}>
          <div>
            <p className={styles.kicker}>American Public Supply Intelligence LLC</p>
            <h1>WinBids MVP UX Prototype v2</h1>
          </div>
          <div className={styles.topActions}>
            <span className={styles.languageToggle}>EN / 中文</span>
            <a href="#submission" className={styles.primaryAction}>
              <Route size={16} aria-hidden="true" />
              Submission preview
            </a>
          </div>
        </header>

        <section id="overview" className={styles.heroGrid} aria-label="Demo overview">
          <article className={styles.heroPanel}>
            <div className={styles.panelHeader}>
              <div>
                <p className={styles.kicker}>Recommended next action</p>
                <h2>Evaluate Citywide Facility Maintenance Services</h2>
              </div>
              <div className={styles.scoreBadge}>
                <strong>92</strong>
                <span>match</span>
              </div>
            </div>
            <p className={styles.leadText}>
              Supplier Profile has matching service area, NAICS, and past performance. Insurance
              details should be checked before submission guidance.
            </p>
            <div className={styles.actionRow}>
              <button type="button" className={styles.primaryButton}>
                <Sparkles size={16} aria-hidden="true" />
                Open decision view
              </button>
              <button type="button" className={styles.secondaryButton}>
                Start pursuit
                <ArrowRight size={16} aria-hidden="true" />
              </button>
            </div>
          </article>

          <div className={styles.metricGrid} aria-label="Demo metrics">
            {metrics.map((metric) => {
              const Icon = metric.icon;
              return (
                <article key={metric.label} className={styles.metricCard}>
                  <Icon size={18} aria-hidden="true" />
                  <strong>{metric.value}</strong>
                  <span>{metric.label}</span>
                </article>
              );
            })}
          </div>
        </section>

        <section className={styles.contentGrid}>
          <section className={styles.mainColumn} aria-labelledby="high-fit-title">
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.kicker}>Discovery-first queue</p>
                <h2 id="high-fit-title">New high-fit bids</h2>
              </div>
              <span className={styles.softPill}>Supplier Profile used for fit</span>
            </div>

            <div className={styles.bidList}>
              {highFitBids.map((bid) => (
                <article key={bid.title} className={styles.bidRow}>
                  <div>
                    <div className={styles.rowMeta}>
                      <span className={`${styles.statusPill} ${styles[bid.tone]}`}>{bid.status}</span>
                      <span>{bid.meta}</span>
                    </div>
                    <h3>{bid.title}</h3>
                    <p>{bid.agency}</p>
                  </div>
                  <div className={styles.compactScore}>
                    <strong>{bid.score}</strong>
                    <span>fit</span>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <aside className={styles.modulePanel} aria-labelledby="module-map-title">
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.kicker}>Primary areas</p>
                <h2 id="module-map-title">Module map</h2>
              </div>
            </div>
            <div className={styles.moduleList}>
              {moduleMap.map((module) => {
                const Icon = module.icon;
                return (
                  <article key={module.title} className={styles.moduleItem}>
                    <Icon size={18} aria-hidden="true" />
                    <div>
                      <span>{module.kicker}</span>
                      <strong>{module.title}</strong>
                      <p>{module.body}</p>
                    </div>
                  </article>
                );
              })}
            </div>
          </aside>
        </section>

        <section className={styles.intentGrid} aria-label="Intent Workspace">
          <article className={styles.briefPanel}>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.kicker}>Intent Workspace</p>
                <h2>AI summary</h2>
              </div>
              <span className={styles.softPill}>Low-risk pursuit</span>
            </div>
            <p>
              Facility maintenance services for municipal buildings across Denver. Scope includes
              preventive maintenance, emergency repair response, janitorial coordination, and
              monthly performance reporting.
            </p>
            <div className={styles.summaryGrid}>
              <div>
                <CalendarClock size={18} aria-hidden="true" />
                <strong>Key dates</strong>
                <span>Q&A Jun 03 · Due Jun 18</span>
              </div>
              <div>
                <ShieldCheck size={18} aria-hidden="true" />
                <strong>Risk flags</strong>
                <span>Insurance limits need confirmation</span>
              </div>
              <div>
                <BookOpenCheck size={18} aria-hidden="true" />
                <strong>Required documents</strong>
                <span>Forms, pricing sheet, capability statement</span>
              </div>
            </div>
          </article>

          <article id="submission" className={styles.submissionPanel}>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.kicker}>Next phase preview</p>
                <h2>Submission Path</h2>
              </div>
              <div className={styles.complexityBadge}>Medium complexity</div>
            </div>
            <div className={styles.pathLine}>
              <Landmark size={18} aria-hidden="true" />
              <span>External city procurement portal</span>
              <ArrowRight size={16} aria-hidden="true" />
              <GraduationCap size={18} aria-hidden="true" />
              <span>Registration check</span>
              <ArrowRight size={16} aria-hidden="true" />
              <Truck size={18} aria-hidden="true" />
              <span>Receipt capture</span>
            </div>
            <ul className={styles.checklist}>
              {readinessItems.map((item) => (
                <li key={item}>
                  <CheckCircle2 size={16} aria-hidden="true" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </article>
        </section>

        <section className={styles.kanban} aria-label="Pursuit pipeline">
          {pipeline.map((lane) => (
            <article key={lane.title} className={styles.lane}>
              <div className={styles.laneHeader}>
                <strong>{lane.title}</strong>
                <span>{lane.count}</span>
              </div>
              {lane.items.map((item) => (
                <div key={item} className={styles.laneItem}>
                  {item}
                </div>
              ))}
            </article>
          ))}
        </section>
      </section>
    </main>
  );
}
