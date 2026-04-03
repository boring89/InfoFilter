export interface RSSItem {
  title?: string;
  link?: string;
  pubDate?: string;
  content?: string;
  contentSnippet?: string;
  summary?: string; // AI generated summary
  isSummarizing?: boolean;
}

export interface RSSFeed {
  title?: string;
  description?: string;
  items: RSSItem[];
}

export interface FeedConfig {
  id: string;
  url: string;
  name: string;
  type: "rss" | "webpage";
  category?: string;
}
