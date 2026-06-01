export function safeKnowledgeSourceUrl(value: string) {
  if (value.startsWith("/") && !value.startsWith("//")) return value;

  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:" ? value : "";
  } catch {
    return "";
  }
}
