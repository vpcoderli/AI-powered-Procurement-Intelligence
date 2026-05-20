import {
  ArrowUpRight,
  BellRing,
  BookMarked,
  Boxes,
  BrainCircuit,
  CheckCircle2,
  Command,
  DatabaseZap,
  Gauge,
  Globe2,
  Layers3,
  Search,
  ShieldCheck,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import styles from "./page.module.css";

const styleFilters = ["All", "Federal", "State", "Saved", "Alerts", "Crawler"];

const previews = [
  { title: "Bid Signal Canvas", label: "CA + TX", accent: "magenta" },
  { title: "Deadline Weather", label: "14 day heat", accent: "cyan" },
  { title: "Saved Cluster", label: "42 watched", accent: "lime" },
  { title: "Source Pulse", label: "5 runners", accent: "yellow" },
];

const galleryCards = [
  {
    title: "Search Intelligence",
    body: "A high-contrast discovery surface for federal and state opportunities, tuned for fast scanning by US operators.",
    meta: "Query -> Match -> Explain",
    icon: Search,
  },
  {
    title: "Saved Opportunity Board",
    body: "Static card language for shortlist review, owner handoff, status tags, and deadline pressure.",
    meta: "Save -> Compare -> Act",
    icon: BookMarked,
  },
  {
    title: "Crawler Command Center",
    body: "State-by-state run controls visualized as production operations, not hidden admin plumbing.",
    meta: "CA / TX / NY / FL / IL",
    icon: DatabaseZap,
  },
  {
    title: "Alert Matching Lab",
    body: "Keyword, NAICS, and fit-score signals become a visible notification composition instead of a plain list.",
    meta: "Rules -> Score -> Notify",
    icon: BellRing,
  },
  {
    title: "Source Health Map",
    body: "Feed freshness, fallback data, and parser confidence are presented as inspectable system health.",
    meta: "Freshness -> Trust -> Coverage",
    icon: ShieldCheck,
  },
];

const toolCards = [
  {
    title: "State Runner Controls",
    description: "Run all states or a single state with clear status, duration, and fallback visibility.",
    color: "magenta",
    icon: Command,
  },
  {
    title: "Fit Score Layers",
    description: "Rank opportunities by relevance, date pressure, agency match, and source confidence.",
    color: "cyan",
    icon: BrainCircuit,
  },
  {
    title: "Bilingual Product Shell",
    description: "Keep English-first UX for US users while preserving a visible Chinese toggle path.",
    color: "lime",
    icon: Globe2,
  },
  {
    title: "Static Review Mode",
    description: "This page is a static UI/UE artifact, so it never triggers crawler jobs or reads live data.",
    color: "yellow",
    icon: Layers3,
  },
];

const flowSteps = [
  {
    number: "01",
    title: "Discover",
    description: "Search across procurement sources with one command-style entry point.",
  },
  {
    number: "02",
    title: "Qualify",
    description: "Surface match logic, due dates, and crawler provenance before the user saves.",
  },
  {
    number: "03",
    title: "Save",
    description: "Move promising bids into a persistent review workspace with owner-ready context.",
  },
  {
    number: "04",
    title: "Monitor",
    description: "Watch source health, alert triggers, and state crawler coverage from one system view.",
  },
];

export default function GenerativeArtStaticPage() {
  return (
    <main className={styles.page}>
      <div className={styles.ambientMesh} aria-hidden="true" />

      <nav className={styles.glassNav} aria-label="Static generative procurement navigation">
        <a className={styles.brand} href="#studio" aria-label="APSi static studio home">
          <span className={styles.brandMark}>
            <Boxes size={20} aria-hidden="true" />
          </span>
          <span>APSi Studio</span>
        </a>
        <div className={styles.navLinks} aria-label="Static page sections">
          <a href="#generate">Generate</a>
          <a href="#gallery">Gallery</a>
          <a href="#tools">Tools</a>
          <a href="#flow">Flow</a>
        </div>
        <div className={styles.languageSwitch} aria-label="Static language switch preview">
          <span>EN</span>
          <span>中文</span>
        </div>
      </nav>

      <section id="studio" className={styles.hero} aria-labelledby="generative-art-title">
        <div className={styles.heroCopy}>
          <p className={styles.badge}>Source reference: UI UX Pro Max Generative Art Platform</p>
          <h1 id="generative-art-title" aria-label="APSi Generative Procurement Studio">
            APSi Generative Procurement <span>Studio</span>
          </h1>
          <p className={styles.heroText}>
            A static UI/UE remix of the existing procurement intelligence system, rebuilt with the
            dark generative-art platform language: glass navigation, high-voltage accents, bento
            gallery cards, and command-first workflows.
          </p>
          <div className={styles.heroActions} aria-label="Static concept actions">
            <a className={styles.primaryButton} href="#generate">
              Start static review
              <ArrowUpRight size={17} aria-hidden="true" />
            </a>
            <a className={styles.secondaryButton} href="#gallery">
              Explore UI map
            </a>
          </div>
        </div>

        <section id="generate" className={styles.generatorCard} aria-label="Static procurement generator preview">
          <div className={styles.commandRow}>
            <div className={styles.commandInput}>
              <WandSparkles size={18} aria-hidden="true" />
              <span>Generate a procurement signal map for AI infrastructure bids in CA/TX/NY</span>
            </div>
            <button className={styles.accentButton} type="button">
              Generate
            </button>
          </div>
          <div className={styles.previewGrid}>
            {previews.map((preview) => (
              <article key={preview.title} className={`${styles.previewTile} ${styles[preview.accent]}`}>
                <span>{preview.label}</span>
                <strong>{preview.title}</strong>
              </article>
            ))}
          </div>
          <div className={styles.statusBar}>
            <span>
              <Gauge size={15} aria-hidden="true" />
              Static generation time: 0s
            </span>
            <span>
              <CheckCircle2 size={15} aria-hidden="true" />
              No API, no crawler run
            </span>
          </div>
        </section>
      </section>

      <section id="gallery" className={styles.gallery} aria-labelledby="gallery-title">
        <div className={styles.sectionHeader}>
          <p className={styles.badge}>Live UI/UE Map</p>
          <h2 id="gallery-title">
            Procurement workflows as a <span>generative gallery</span>
          </h2>
        </div>
        <div className={styles.filterRow} aria-label="Static gallery filters">
          {styleFilters.map((filter, index) => (
            <span key={filter} className={index === 0 ? styles.activeFilter : undefined}>
              {filter}
            </span>
          ))}
        </div>
        <div className={styles.bentoGrid}>
          {galleryCards.map((card, index) => {
            const Icon = card.icon;
            return (
              <article key={card.title} className={`${styles.bentoCard} ${index === 0 ? styles.featuredCard : ""}`}>
                <div className={styles.cardTopline}>
                  <span className={styles.cardIcon}>
                    <Icon size={21} aria-hidden="true" />
                  </span>
                  <span>{card.meta}</span>
                </div>
                <h3>{card.title}</h3>
                <p>{card.body}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section id="tools" className={styles.tools} aria-labelledby="tools-title">
        <div className={styles.sectionHeader}>
          <p className={styles.badge}>Pro feature surface</p>
          <h2 id="tools-title">
            Existing functions, <span>new interaction texture</span>
          </h2>
        </div>
        <div className={styles.toolGrid}>
          {toolCards.map((tool) => {
            const Icon = tool.icon;
            return (
              <article key={tool.title} className={styles.toolCard}>
                <span className={`${styles.toolIcon} ${styles[tool.color]}`}>
                  <Icon size={24} aria-hidden="true" />
                </span>
                <h3>{tool.title}</h3>
                <p>{tool.description}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section id="flow" className={styles.flow} aria-labelledby="flow-title">
        <div className={styles.flowCopy}>
          <p className={styles.badge}>Operator journey</p>
          <h2 id="flow-title">
            From crawler signal to saved opportunity <span>without visual dead ends</span>
          </h2>
          <p>
            The page is intentionally static and isolated from production screens. It is a visual target for
            how APSi can feel after the current system UI/UE is reworked.
          </p>
        </div>
        <div className={styles.stepList}>
          {flowSteps.map((step) => (
            <article key={step.number} className={styles.stepCard}>
              <span>{step.number}</span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.description}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <footer className={styles.footer}>
        <span>
          <Sparkles size={16} aria-hidden="true" />
          Static APSi UI/UE artifact
        </span>
        <span>Built for review only. Existing product routes remain unchanged.</span>
      </footer>
    </main>
  );
}
