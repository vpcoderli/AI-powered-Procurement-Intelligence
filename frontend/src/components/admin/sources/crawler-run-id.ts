import { stateCrawlerSourceIdForAdminSource } from "@/lib/state-crawler-sources";

export interface CrawlerRunSource {
  id: string;
  issuerType: string;
  stateCode: string;
  crawlerSourceId: string | null;
}

/** The id POST /api/crawler/state/run accepts for a source; null when it has none (SAM.gov runs through its own route). */
export function crawlerRunIdFor(source: CrawlerRunSource): string | null {
  // County/city/special-district registry rows have no legacy per-state crawler metadata;
  // since the data_sources migration they run through /api/crawler/state/run by their own row
  // id (the route resolves every non-federal data_sources id — see listAllSources).
  const subStateSourceId = source.issuerType !== "state" && source.issuerType !== "federal" ? source.id : null;
  return source.crawlerSourceId ?? stateCrawlerSourceIdForAdminSource(source) ?? subStateSourceId;
}
