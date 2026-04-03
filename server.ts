import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import Parser from "rss-parser";
import axios from "axios";
import * as cheerio from "cheerio";
import { decode } from "html-entities";

async function startServer() {
  const app = express();
  const PORT = 3000;
  const parser = new Parser();

  app.use(express.json());

  // API endpoint to fetch RSS feed
  app.get("/api/rss", async (req, res) => {
    const { url } = req.query;
    if (!url || typeof url !== "string") {
      return res.status(400).json({ error: "URL is required" });
    }

    try {
      const feed = await parser.parseURL(url);
      
      // Decode entities in feed items
      if (feed.items) {
        feed.items = feed.items.map(item => ({
          ...item,
          title: decode(item.title || ""),
          content: decode(item.content || ""),
          contentSnippet: decode(item.contentSnippet || "")
        }));
      }
      if (feed.title) feed.title = decode(feed.title);
      if (feed.description) feed.description = decode(feed.description);

      res.json(feed);
    } catch (error) {
      console.error("Error fetching RSS:", error);
      res.status(500).json({ error: "Failed to fetch RSS feed" });
    }
  });

  // Helper function to scrape recursively
  async function scrapePage(url: string, visited: Set<string>, depth: number, maxDepth: number): Promise<{content: string, title: string, description: string}> {
    if (depth > maxDepth || visited.has(url)) return { content: "", title: "", description: "" };
    visited.add(url);
    
    try {
      const response = await axios.get(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          "Accept-Language": "zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7"
        },
        timeout: 10000
      });
      const $ = cheerio.load(response.data);
      
      const title = decode($("title").text() || "Untitled Webpage");
      const description = decode($('meta[name="description"]').attr("content") || "");

      // Find next page link BEFORE removing nav/footer
      let nextUrl = "";
      $("a").each((_, el) => {
        if (nextUrl) return;
        const href = $(el).attr("href");
        if (!href || href.startsWith("javascript:") || href.startsWith("#")) return;
        
        const text = $(el).text().toLowerCase().trim();
        const className = ($(el).attr("class") || "").toLowerCase();
        const rel = ($(el).attr("rel") || "").toLowerCase();
        
        if (
          rel === "next" ||
          text === "next" || text === "next page" || text === "下一頁" || text === "更早" || text === "older" || text === "older posts" || text === "more" || text === "載入更多" || text === "下一页" || text === "»" || text === ">" ||
          className.includes("next") || className.includes("pagination-next")
        ) {
          try {
            nextUrl = new URL(href, url).href;
          } catch (e) {}
        }
      });

      // Remove noise
      $("script, style, nav, footer, iframe, noscript, header, aside, .ad, .advertisement").remove();
      
      // Try to find the main content
      const contentRoot = $("article").length ? $("article") : ($("main").length ? $("main") : $("body"));
      
      // Extract text with block separation
      let content = `\n--- Page: ${url} ---\n`;
      contentRoot.find("p, h1, h2, h3, h4, h5, h6, li, div").each((_, el) => {
        const text = $(el).text().trim();
        if (text) content += text + "\n";
      });

      // If no structured content found, fallback to raw text
      if (content.trim() === `--- Page: ${url} ---`) {
        content += contentRoot.text();
      }
      
      // Clean up content (remove extra whitespace)
      content = content.replace(/\n\s*\n/g, "\n").trim();

      let nextContent = "";
      if (nextUrl && nextUrl !== url && !visited.has(nextUrl)) {
        const nextResult = await scrapePage(nextUrl, visited, depth + 1, maxDepth);
        nextContent = nextResult.content;
      }
      
      return {
        title,
        description,
        content: content + "\n\n" + nextContent
      };
    } catch (error) {
      console.error(`Error scraping ${url}:`, error instanceof Error ? error.message : String(error));
      return { content: "", title: "", description: "" };
    }
  }

  // API endpoint to scrape single webpage
  app.get("/api/scrape", async (req, res) => {
    const { url } = req.query;
    if (!url || typeof url !== "string") {
      return res.status(400).json({ error: "URL is required" });
    }

    try {
      const visited = new Set<string>();
      // Scrape up to 5 pages deep to gather more articles
      const result = await scrapePage(url, visited, 1, 5);
      
      // Limit total content length to avoid massive payloads (e.g. 100k chars)
      const finalContent = result.content.substring(0, 100000);

      res.json({
        title: result.title,
        description: result.description,
        items: [{
          title: result.title,
          content: decode(finalContent),
          contentSnippet: decode(finalContent.substring(0, 500)) + "...",
          link: url,
          pubDate: new Date().toISOString()
        }]
      });
    } catch (error) {
      console.error("Error scraping webpage:", error);
      res.status(500).json({ error: "Failed to scrape webpage" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
