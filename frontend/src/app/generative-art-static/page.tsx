import {
  ArrowUpRight,
  BadgeDollarSign,
  GalleryHorizontalEnd,
  Layers3,
  Paintbrush2,
  Radar,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import styles from "./page.module.css";

const promptChips = [
  "turn stale RFPs into living moodboards",
  "map deadlines as neon weather",
  "rank fit with a tastefully chaotic lens",
  "translate procurement into visual signals",
];

const galleryCards = [
  {
    eyebrow: "Signal collage",
    title: "AI infrastructure bids, remixed by risk and timing",
    body: "A static concept tile showing how solicitations could become generative canvases for fast scanning.",
    tone: "pink",
  },
  {
    eyebrow: "Canvas frame",
    title: "Federal + state streams in one visual wall",
    body: "Minimal framing keeps dense procurement data readable while sticker layers add orientation cues.",
    tone: "blue",
  },
  {
    eyebrow: "Prompt output",
    title: "What changed overnight?",
    body: "A chaos strip highlights new, updated, and fading opportunities without touching live APIs.",
    tone: "green",
  },
];

const signalModules = [
  { label: "Fit score", value: "92", detail: "High relevance cluster" },
  { label: "Deadline heat", value: "14d", detail: "Fast-response window" },
  { label: "Source blend", value: "5", detail: "State + federal feeds" },
];

export default function GenerativeArtStaticPage() {
  return (
    <main className={styles.page}>
      <section className={styles.hero} aria-labelledby="generative-art-title">
        <div className={styles.frame}>
          <div className={styles.topline}>
            <span className={styles.logoMark}>
              <Sparkles size={18} aria-hidden="true" />
            </span>
            <span>APSi static concept</span>
            <span className={styles.systemTag}>Minimalism + Gen Z Chaos</span>
          </div>

          <div className={styles.heroGrid}>
            <div className={styles.heroCopy}>
              <p className={styles.kicker}>Generative Art Platform</p>
              <h1 id="generative-art-title">Generative Bid Lab</h1>
              <p className={styles.heroText}>
                A standalone visual prototype for procurement intelligence: calm canvas, loud signals,
                and collage-like outputs for people who need to see opportunity patterns fast.
              </p>
              <div className={styles.actions} aria-label="Static concept actions">
                <a href="#gallery" className={styles.primaryAction}>
                  View gallery
                  <ArrowUpRight size={18} aria-hidden="true" />
                </a>
                <a href="#signals" className={styles.secondaryAction}>
                  Read signals
                </a>
              </div>
            </div>

            <div className={styles.artBoard} aria-label="Static generative procurement artwork preview">
              <div className={styles.marquee} aria-hidden="true">
                <span>OPEN BIDS / SIGNALS / INTEL / DEADLINES /</span>
              </div>
              <div className={styles.orbitOne} />
              <div className={styles.orbitTwo} />
              <div className={styles.pixelPatch}>SAM.gov</div>
              <div className={styles.stickerPink}>hot lead</div>
              <div className={styles.stickerYellow}>due soon</div>
              <div className={styles.stickerGreen}>state feed</div>
              <div className={styles.canvasCard}>
                <WandSparkles size={26} aria-hidden="true" />
                <span>Prompt-to-opportunity canvas</span>
              </div>
            </div>
          </div>
        </div>

        <div className={styles.promptStrip} aria-label="Static prompt examples">
          {promptChips.map((chip) => (
            <span key={chip}>{chip}</span>
          ))}
        </div>
      </section>

      <section id="gallery" className={styles.gallery} aria-labelledby="gallery-title">
        <div className={styles.sectionHeader}>
          <p>Generated intelligence wall</p>
          <h2 id="gallery-title">Minimal frame, chaotic artifacts</h2>
        </div>
        <div className={styles.galleryGrid}>
          {galleryCards.map((card, index) => (
            <article key={card.title} className={`${styles.galleryCard} ${styles[card.tone]}`}>
              <div className={styles.cardIcon}>
                {index === 0 ? (
                  <Radar size={22} aria-hidden="true" />
                ) : index === 1 ? (
                  <GalleryHorizontalEnd size={22} aria-hidden="true" />
                ) : (
                  <Layers3 size={22} aria-hidden="true" />
                )}
              </div>
              <span className={styles.cardEyebrow}>{card.eyebrow}</span>
              <h3>{card.title}</h3>
              <p>{card.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="signals" className={styles.signals} aria-labelledby="signals-title">
        <div>
          <p className={styles.kicker}>Static workflow study</p>
          <h2 id="signals-title">A procurement console wearing an art-school jacket</h2>
        </div>
        <div className={styles.signalGrid}>
          {signalModules.map((module) => (
            <article key={module.label} className={styles.signalCard}>
              <span>{module.label}</span>
              <strong>{module.value}</strong>
              <p>{module.detail}</p>
            </article>
          ))}
        </div>
        <div className={styles.footerPanel}>
          <Paintbrush2 size={22} aria-hidden="true" />
          <p>
            This page is intentionally static and isolated: no live crawler runs, no API reads, and no changes to
            existing APSi product screens.
          </p>
          <BadgeDollarSign size={22} aria-hidden="true" />
        </div>
      </section>
    </main>
  );
}
