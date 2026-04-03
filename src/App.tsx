import { useState, useEffect, useCallback } from "react";
import { GoogleGenAI } from "@google/genai";
import { 
  Plus, 
  Trash2, 
  RefreshCw, 
  ExternalLink, 
  Settings, 
  BookOpen, 
  CheckCircle2,
  AlertCircle,
  Loader2,
  ChevronRight,
  Languages,
  Filter,
  LogOut,
  LogIn,
  Menu,
  X
} from "lucide-react";
import { decode } from "html-entities";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "@/src/lib/utils";
import { RSSItem, RSSFeed, FeedConfig } from "./types";
import { 
  auth, 
  db, 
  googleProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged, 
  doc, 
  getDoc, 
  setDoc, 
  serverTimestamp,
  handleFirestoreError,
  OperationType,
  User
} from "./firebase";

const DEFAULT_FEEDS: FeedConfig[] = [
  { id: "1", name: "TechCrunch", url: "https://techcrunch.com/feed/", type: "rss" },
  { id: "2", name: "The Verge", url: "https://www.theverge.com/rss/index.xml", type: "rss" },
];

const INITIAL_LABELS: Record<string, string> = {
  mySources: "我的來源",
  addSource: "新增來源",
  status: "狀態",
  aiReady: "AI 摘要員就緒",
  refresh: "重新整理",
  removeSource: "移除來源",
  aiSummaryTitle: "AI 精華摘要",
  summarizing: "正在摘要...",
  analyzing: "正在分析網頁...",
  regenerateSummary: "重新生成摘要",
  analyzePage: "智慧分析並拆分網頁",
  clickToSummarize: "點擊按鈕讓 AI 為你整理今日重點",
  clickToAnalyze: "點擊按鈕讓 AI 辨識網頁內容並自動拆分新聞",
  latestArticles: "最新文章",
  noSources: "尚未選擇來源",
  addFirstSource: "新增你的第一個來源",
  loginTitle: "歡迎使用 InfoFilter",
  loginDesc: "請登入以同步您的訂閱來源與偏好設定",
  loginButton: "使用 Google 帳號登入",
  logoutButton: "登出",
  syncing: "同步中...",
  sourceName: "來源名稱",
  rssUrl: "網址 (URL)",
  sourceType: "來源類型",
  rssFeed: "RSS 訂閱源",
  webpage: "單一網頁/文章",
  language: "語言",
  translateUI: "使用 AI 翻譯介面",
  settings: "設定",
  close: "關閉",
  personalApiKey: "個人 Gemini API 金鑰",
  apiKeyPlaceholder: "在此輸入您的 API 金鑰",
  trialRemaining: "剩餘試用次數",
  noTrialLeft: "試用次數已用完，請輸入個人 API 金鑰",
  saveApiKey: "儲存金鑰",
  apiKeySaved: "金鑰已儲存",
  howToGetApiKey: "如何取得金鑰？",
  apiKeyInfo: "您可以前往 Google AI Studio 免費取得 API 金鑰。",
  displayMode: "顯示模式",
  compact: "緊湊模式",
  comfortable: "舒適模式",
  auto: "自動（依裝置）",
  addSourceTitle: "新增訂閱來源",
  category: "分類偏好",
  allCategories: "全部",
  tech: "科技",
  humanities: "人文",
  business: "商業",
  entertainment: "娛樂",
  general: "綜合"
};

export default function App() {
  const [feeds, setFeeds] = useState<FeedConfig[]>(() => {
    const saved = localStorage.getItem("rss_feeds");
    return saved ? JSON.parse(saved) : DEFAULT_FEEDS;
  });
  const [language, setLanguage] = useState(() => localStorage.getItem("app_lang") || "zh-tw");
  const [uiLabels, setUiLabels] = useState<Record<string, string>>(() => {
    const saved = localStorage.getItem("ui_labels");
    return saved ? JSON.parse(saved) : INITIAL_LABELS;
  });
  
  const [activeFeedId, setActiveFeedId] = useState<string | null>(null);
  const [feedData, setFeedData] = useState<Record<string, RSSFeed>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [summarizing, setSummarizing] = useState<Record<string, boolean>>({});
  const [translatingUI, setTranslatingUI] = useState(false);
  const [newFeedUrl, setNewFeedUrl] = useState("");
  const [newFeedName, setNewFeedName] = useState("");
  const [newFeedType, setNewFeedType] = useState<"rss" | "webpage">("rss");
  const [newFeedCategory, setNewFeedCategory] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [showAddSource, setShowAddSource] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [userApiKey, setUserApiKey] = useState("");
  const [trialCount, setTrialCount] = useState(5);
  const [isUnlimited, setIsUnlimited] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [displayMode, setDisplayMode] = useState<"compact" | "comfortable" | "auto">("auto");

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setAuthReady(true);
      
      if (currentUser) {
        const userDocRef = doc(db, "users", currentUser.uid);
        try {
          const userDoc = await getDoc(userDocRef);
          if (userDoc.exists()) {
            const data = userDoc.data();
            if (data.feeds) setFeeds(data.feeds);
            if (data.language) setLanguage(data.language);
            if (data.displayMode) setDisplayMode(data.displayMode);
            if (data.userApiKey) {
              setUserApiKey(data.userApiKey);
              setApiKeyInput(data.userApiKey);
            }
            if (data.trialCount !== undefined) setTrialCount(data.trialCount);
            if (data.isUnlimited !== undefined) setIsUnlimited(data.isUnlimited);
          } else {
            await setDoc(userDocRef, {
              email: currentUser.email,
              feeds: feeds,
              language: language,
              trialCount: 5,
              isUnlimited: false,
              updatedAt: serverTimestamp()
            });
          }
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, `users/${currentUser.uid}`);
        }
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user || !authReady || isSyncing) return;

    const syncData = async () => {
      setIsSyncing(true);
      const userDocRef = doc(db, "users", user.uid);
      try {
        await setDoc(userDocRef, {
          email: user.email,
          feeds: feeds,
          language: language,
          displayMode: displayMode,
          userApiKey: userApiKey,
          trialCount: trialCount,
          updatedAt: serverTimestamp()
        }, { merge: true });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
      } finally {
        setIsSyncing(false);
      }
    };

    const timeoutId = setTimeout(syncData, 2000);
    return () => clearTimeout(timeoutId);
  }, [feeds, language, user, authReady]);

  const fetchFeed = useCallback(async (feed: FeedConfig) => {
    setLoading(prev => ({ ...prev, [feed.id]: true }));
    try {
      const endpoint = feed.type === "webpage" ? "/api/scrape" : "/api/rss";
      const response = await fetch(`${endpoint}?url=${encodeURIComponent(feed.url)}`);
      const data = await response.json();
      if (data.error) throw new Error(data.error);
      setFeedData(prev => ({ ...prev, [feed.id]: data }));
      if (!activeFeedId) setActiveFeedId(feed.id);
    } catch (error) {
      console.error("Failed to fetch feed:", error);
    } finally {
      setLoading(prev => ({ ...prev, [feed.id]: false }));
    }
  }, [activeFeedId]);

  useEffect(() => {
    feeds.forEach(feed => {
      if (!feedData[feed.id]) {
        fetchFeed(feed);
      }
    });
  }, [feeds, fetchFeed, feedData]);

  const translateUI = async () => {
    if (!userApiKey && trialCount <= 0 && !isUnlimited) {
      alert(uiLabels.noTrialLeft);
      return;
    }
    setTranslatingUI(true);
    try {
      const apiKey = userApiKey || process.env.GEMINI_API_KEY;
      const ai = new GoogleGenAI({ apiKey });
      const model = "gemini-3-flash-preview";
      
      const prompt = `
        Translate the following UI labels into the language: "${language}".
        Return ONLY a JSON object with the same keys.
        
        Labels:
        ${JSON.stringify(INITIAL_LABELS, null, 2)}
      `;

      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { responseMimeType: "application/json" }
      });

      const translated = JSON.parse(response.text);
      setUiLabels(translated);
      
      if (!userApiKey && !isUnlimited) {
        setTrialCount(prev => Math.max(0, prev - 1));
      }
    } catch (error) {
      console.error("UI Translation failed:", error);
    } finally {
      setTranslatingUI(false);
    }
  };

  const summarizeFeed = async (feedId: string) => {
    if (!userApiKey && trialCount <= 0 && !isUnlimited) {
      alert(uiLabels.noTrialLeft);
      return;
    }
    const feed = feedData[feedId];
    const config = feeds.find(f => f.id === feedId);
    if (!feed || !feed.items.length || !config) return;

    setSummarizing(prev => ({ ...prev, [feedId]: true }));
    
    try {
      const apiKey = userApiKey || process.env.GEMINI_API_KEY;
      const ai = new GoogleGenAI({ apiKey });
      const model = "gemini-3-flash-preview";
      
      if (config.type === "webpage") {
        const rawContent = feed.items[0].content || "";
        const prompt = `
          你是一位專業的網頁內容分析師。請分析以下網頁的原始文字內容。
          
          任務：
          1. 判斷這是一個「單一文章」還是「新聞入口網站/列表」。
          2. **過濾雜訊**：徹底過濾掉導覽列、廣告、側欄、版權聲明、瀏覽器版本過低提示、登入提示等無關內容。
          3. **智慧拆分**：如果原始內容中多個新聞標題被連在一起（例如「標題A標題B標題C」），請憑藉你的知識將其拆分為獨立的條目。
          4. **內容提取與翻譯**：
             - 如果是單一文章：提供深度摘要，並翻譯為 ${language}。
             - 如果是入口網站：從中提取出盡可能多的「文章標題」與「簡短摘要」（最多 50 個），並全部翻譯為 ${language}。
          
          規則：
          - 語言：必須完全使用 ${language}，包含標題。
          - 嚴禁任何開場白或結語。
          - 必須返回 JSON 格式。
          
          JSON 格式範例：
          {
            "summary": "對整個網頁或主文章的精煉總結（使用 Markdown 格式，包含 ### **標題**）",
            "extractedItems": [
              { "title": "文章標題", "contentSnippet": "簡短摘要", "link": "${config.url}" }
            ]
          }
          
          原始內容：
          ${rawContent.substring(0, 100000)}
        `;

        const response = await ai.models.generateContent({
          model,
          contents: prompt,
          config: { responseMimeType: "application/json" }
        });

        const result = JSON.parse(response.text);
        
        setFeedData(prev => ({
          ...prev,
          [feedId]: {
            ...prev[feedId],
            aiSummary: result.summary,
            items: result.extractedItems && result.extractedItems.length > 0 
              ? result.extractedItems.map((item: any) => ({
                  ...item,
                  pubDate: new Date().toISOString(),
                  link: item.link || config.url
                }))
              : prev[feedId].items
          }
        }));

        if (!userApiKey && !isUnlimited) {
          setTrialCount(prev => Math.max(0, prev - 1));
        }
      } else {
        const itemsToSummarize = feed.items.slice(0, 5);
        const prompt = `
          你是一位專業的資訊摘要員。請針對以下 RSS 新聞列表進行摘要。
          
          規則：
          1. 語言必須完全使用：${language}，包含新聞標題也必須翻譯。
          2. 嚴禁任何開場白或結語。
          3. 嚴禁使用「標題：」或「核心觀點：」等標籤。
          4. 每則新聞的格式如下：
             ### **[翻譯後的標題]**
             [翻譯後的摘要]
          
          新聞列表：
          ${itemsToSummarize.map((item, i) => `${i+1}. 標題: ${item.title}\n內容: ${item.contentSnippet || item.content || ""}`).join("\n\n")}
        `;

        const response = await ai.models.generateContent({
          model,
          contents: prompt,
        });

        const summaryText = decode(response.text);
        
        setFeedData(prev => ({
          ...prev,
          [feedId]: {
            ...prev[feedId],
            aiSummary: summaryText
          }
        }));

        if (!userApiKey && !isUnlimited) {
          setTrialCount(prev => Math.max(0, prev - 1));
        }
      }
    } catch (error) {
      console.error("Summarization failed:", error);
    } finally {
      setSummarizing(prev => ({ ...prev, [feedId]: false }));
    }
  };

  const addFeed = () => {
    if (!newFeedUrl || !newFeedName) return;
    const newFeed: FeedConfig = {
      id: Math.random().toString(36).substr(2, 9),
      name: newFeedName,
      url: newFeedUrl,
      type: newFeedType,
      category: newFeedCategory || ""
    };
    setFeeds([...feeds, newFeed]);
    setNewFeedUrl("");
    setNewFeedName("");
    setNewFeedType("rss");
    setNewFeedCategory("");
  };

  const removeFeed = (id: string) => {
    setFeeds(feeds.filter(f => f.id !== id));
    if (activeFeedId === id) setActiveFeedId(feeds[0]?.id || null);
  };

  const activeFeed = feeds.find(f => f.id === activeFeedId);
  const activeData = activeFeedId ? feedData[activeFeedId] : null;

  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#E4E3E0] flex items-center justify-center">
        <Loader2 className="animate-spin text-[#141414]" size={32} />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#E4E3E0] flex items-center justify-center p-6">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-white p-12 rounded-[32px] shadow-2xl text-center space-y-8"
        >
          <div className="w-20 h-20 bg-[#141414] rounded-full flex items-center justify-center mx-auto">
            <Filter className="text-white" size={40} />
          </div>
          <div className="space-y-2">
            <h1 className="text-4xl font-bold tracking-tighter text-[#141414]">{uiLabels.loginTitle}</h1>
            <p className="text-[#141414]/60">{uiLabels.loginDesc}</p>
          </div>
          <button
            onClick={() => signInWithPopup(auth, googleProvider)}
            className="w-full py-4 bg-[#141414] text-white rounded-full font-medium hover:scale-[1.02] transition-transform flex items-center justify-center gap-3"
          >
            <LogIn size={20} />
            {uiLabels.loginButton}
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#E4E3E0] text-[#141414] font-sans selection:bg-[#141414] selection:text-[#E4E3E0]">
      {/* Mobile Header */}
      <div className="md:hidden sticky top-0 left-0 right-0 bg-[#E4E3E0]/80 backdrop-blur-md border-b border-[#141414]/10 p-4 flex items-center justify-between z-30">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-[#141414] rounded-full flex items-center justify-center text-[#E4E3E0]">
            <Filter size={16} />
          </div>
          <h1 className="font-display italic text-lg">InfoFilter</h1>
        </div>
        <div className="flex items-center gap-2">
          {isSyncing && <Loader2 size={14} className="animate-spin opacity-40" />}
          <button 
            onClick={() => setIsSidebarOpen(true)}
            className="p-2 hover:bg-[#141414]/5 rounded-full transition-colors"
          >
            <Menu size={20} />
          </button>
        </div>
      </div>

      {/* Sidebar / Navigation (Desktop & Mobile Drawer) */}
      <AnimatePresence>
        {(isSidebarOpen || window.innerWidth >= 768) && (
          <motion.div 
            initial={{ x: -260 }}
            animate={{ x: 0 }}
            exit={{ x: -260 }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className={cn(
              "fixed left-0 top-0 bottom-0 w-64 border-r border-[#141414] p-6 flex flex-col gap-8 bg-[#E4E3E0] z-40",
              !isSidebarOpen && "hidden md:flex"
            )}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-[#141414] rounded-full flex items-center justify-center text-[#E4E3E0]">
                  <Filter size={18} />
                </div>
                <h1 className="font-display italic text-xl">InfoFilter</h1>
              </div>
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => setIsSidebarOpen(false)}
                  className="md:hidden p-2 hover:bg-[#141414]/5 rounded-full transition-colors"
                >
                  <X size={18} />
                </button>
                <button 
                  onClick={() => signOut(auth)}
                  className="p-2 hover:bg-[#141414]/5 rounded-full transition-colors"
                  title={uiLabels.logoutButton}
                >
                  <LogOut size={16} />
                </button>
              </div>
            </div>

            <nav className="flex-1 flex flex-col gap-2 overflow-y-auto">
              <div className="text-[10px] uppercase tracking-widest opacity-50 mb-2 font-mono">{uiLabels.mySources}</div>
              
              <select 
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="w-full bg-transparent border border-[#141414]/20 rounded-lg py-1.5 px-2 text-xs focus:outline-none focus:border-[#141414] transition-all mb-2 appearance-none cursor-pointer"
              >
                <option value="">{uiLabels.allCategories}</option>
                <option value="tech">{uiLabels.tech}</option>
                <option value="humanities">{uiLabels.humanities}</option>
                <option value="business">{uiLabels.business}</option>
                <option value="entertainment">{uiLabels.entertainment}</option>
                <option value="general">{uiLabels.general}</option>
              </select>

              {feeds.filter(feed => !selectedCategory || feed.category === selectedCategory).map(feed => (
                <button
                  key={feed.id}
                  onClick={() => {
                    setActiveFeedId(feed.id);
                    setIsSidebarOpen(false);
                  }}
                  className={cn(
                    "flex items-center justify-between group px-3 py-2 rounded-lg transition-all text-sm",
                    activeFeedId === feed.id 
                      ? "bg-[#141414] text-[#E4E3E0]" 
                      : "hover:bg-[#141414]/5"
                  )}
                >
                  <div className="flex items-center gap-2 truncate">
                    <span className="opacity-40">{feed.type === "webpage" ? "📄" : "📻"}</span>
                    <span className="truncate">{feed.name}</span>
                  </div>
                  {loading[feed.id] && <Loader2 size={14} className="animate-spin opacity-50" />}
                </button>
              ))}
            </nav>

            <div className="pt-6 border-t border-[#141414]/10 space-y-4">
              <div className="flex flex-col gap-2">
                <button 
                  onClick={() => {
                    setShowAddSource(true);
                    setIsSidebarOpen(false);
                  }}
                  className="flex items-center gap-2 text-sm opacity-60 hover:opacity-100 transition-opacity"
                >
                  <Plus size={16} />
                  <span>{uiLabels.addSource}</span>
                </button>
                <button 
                  onClick={() => {
                    setShowSettings(true);
                    setIsSidebarOpen(false);
                  }}
                  className="flex items-center gap-2 text-sm opacity-60 hover:opacity-100 transition-opacity"
                >
                  <Settings size={16} />
                  <span>{uiLabels.settings}</span>
                </button>
              </div>
              
              <div className="pt-4 border-t border-[#141414]/10">
                <div className="text-[10px] uppercase tracking-widest opacity-50 mb-4 font-mono">{uiLabels.status}</div>
                <div className="flex items-center gap-2 text-xs">
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  <span>{uiLabels.aiReady}</span>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile Overlay */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-[#141414]/40 backdrop-blur-[2px] z-30 md:hidden"
          />
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="md:ml-64 p-4 sm:p-6 md:p-12 max-w-5xl">
        <AnimatePresence mode="wait">
          {activeFeed ? (
            <motion.div
              key={activeFeedId}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-8 md:space-y-12"
            >
              <header className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="font-mono text-[10px] sm:text-xs uppercase tracking-widest opacity-50 flex items-center gap-2 overflow-hidden">
                    <span className="whitespace-nowrap">{activeFeed.type === "webpage" ? "Webpage" : "RSS Feed"}</span>
                    <span>•</span>
                    <span className="truncate max-w-[150px] sm:max-w-[300px]">{activeFeed.url}</span>
                  </div>
                  <div className="flex gap-2 sm:gap-4">
                    <button 
                      onClick={() => fetchFeed(activeFeed)}
                      className="p-2 hover:bg-[#141414]/5 rounded-full transition-colors"
                      title={uiLabels.refresh}
                    >
                      <RefreshCw size={18} className={cn(loading[activeFeed.id] && "animate-spin")} />
                    </button>
                    <button 
                      onClick={() => removeFeed(activeFeed.id)}
                      className="p-2 hover:bg-red-500/10 text-red-600 rounded-full transition-colors"
                      title={uiLabels.removeSource}
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
                <h2 className={cn(
                  "font-display italic leading-tight break-words",
                  displayMode === "compact" ? "text-3xl sm:text-5xl" : 
                  displayMode === "comfortable" ? "text-5xl sm:text-7xl md:text-9xl" : 
                  "text-4xl sm:text-6xl md:text-8xl"
                )}>
                  {activeFeed.name}
                </h2>
              </header>

              {/* AI Summary Section */}
              <section className="bg-[#141414] text-[#E4E3E0] p-6 sm:p-8 md:p-12 rounded-2xl sm:rounded-3xl space-y-6 sm:space-y-8 relative overflow-hidden">
                <div className="absolute top-0 right-0 p-12 opacity-5 pointer-events-none hidden sm:block">
                  <BookOpen size={200} />
                </div>
                
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 relative z-10">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="text-green-400" size={20} />
                    <h3 className="text-xl sm:text-2xl font-display italic">{uiLabels.aiSummaryTitle}</h3>
                  </div>
                  <button 
                    onClick={() => summarizeFeed(activeFeed.id)}
                    disabled={summarizing[activeFeed.id] || loading[activeFeed.id]}
                    className="w-full sm:w-auto px-6 py-2 bg-[#E4E3E0] text-[#141414] rounded-full text-sm font-medium hover:scale-105 transition-transform disabled:opacity-50 disabled:scale-100 flex items-center justify-center gap-2"
                  >
                    {summarizing[activeFeed.id] ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        <span>{activeFeed.type === "webpage" ? uiLabels.analyzing : uiLabels.summarizing}</span>
                      </>
                    ) : (
                      <>
                        <RefreshCw size={16} />
                        <span>{activeFeed.type === "webpage" ? uiLabels.analyzePage : uiLabels.regenerateSummary}</span>
                      </>
                    )}
                  </button>
                </div>

                <div className="prose prose-invert max-w-none relative z-10">
                  {summarizing[activeFeed.id] ? (
                    <div className="space-y-4 animate-pulse">
                      <div className="h-4 bg-[#E4E3E0]/10 rounded w-3/4" />
                      <div className="h-4 bg-[#E4E3E0]/10 rounded w-1/2" />
                      <div className="h-4 bg-[#E4E3E0]/10 rounded w-2/3" />
                    </div>
                  ) : activeData?.aiSummary ? (
                    <div className={cn(
                      "whitespace-pre-wrap font-sans leading-relaxed opacity-90",
                      displayMode === "compact" ? "text-sm sm:text-base" :
                      displayMode === "comfortable" ? "text-lg sm:text-xl md:text-2xl" :
                      "text-base sm:text-lg"
                    )}>
                      {activeData.aiSummary.split('\n').map((line, idx) => {
                        if (line.startsWith('###')) {
                          return (
                            <h4 key={idx} className={cn(
                              "font-bold mt-6 mb-2 text-white",
                              displayMode === "compact" ? "text-lg sm:text-xl" :
                              displayMode === "comfortable" ? "text-2xl sm:text-3xl" :
                              "text-xl sm:text-2xl"
                            )}>
                              {line.replace(/###\s*\*\*|\*\*/g, '')}
                            </h4>
                          );
                        }
                        return <p key={idx} className="mb-4">{line}</p>;
                      })}
                    </div>
                  ) : (
                    <div className="text-center py-8 sm:py-12 border border-[#E4E3E0]/10 rounded-2xl">
                      <p className="opacity-50 italic text-sm sm:text-base px-4">
                        {activeFeed.type === "webpage" ? uiLabels.clickToAnalyze : uiLabels.clickToSummarize}
                      </p>
                    </div>
                  )}
                </div>
              </section>

              {/* Raw Feed Items */}
              {activeData?.aiSummary && (
                <section className="space-y-6 sm:space-y-8">
                  <div className="flex items-center justify-between border-b border-[#141414] pb-4">
                    <h3 className="font-mono text-[10px] uppercase tracking-widest">{uiLabels.latestArticles}</h3>
                    <span className="font-mono text-[10px] opacity-50">{activeData?.items.length || 0} items</span>
                  </div>
                  
                  <div className="grid gap-1">
                    {activeData?.items.map((item, i) => (
                      <a 
                        key={i}
                        href={item.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={cn(
                          "group flex flex-col sm:flex-row sm:items-center justify-between border-b border-[#141414]/10 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all",
                          displayMode === "compact" ? "p-2 sm:p-3" :
                          displayMode === "comfortable" ? "p-6 sm:p-10" :
                          "p-4 sm:p-6"
                        )}
                      >
                        <div className="space-y-2 flex-1 sm:pr-8">
                          <div className="flex items-start sm:items-center gap-3">
                            <span className="font-mono text-[10px] opacity-40 group-hover:opacity-60 mt-1 sm:mt-0">
                              {(i + 1).toString().padStart(2, '0')}
                            </span>
                            <h4 className={cn(
                              "font-medium leading-tight group-hover:translate-x-1 transition-transform",
                              displayMode === "compact" ? "text-base" :
                              displayMode === "comfortable" ? "text-xl sm:text-2xl" :
                              "text-lg sm:text-xl"
                            )}>
                              {item.title}
                            </h4>
                          </div>
                          <p className={cn(
                            "opacity-60 line-clamp-2 pl-8",
                            displayMode === "compact" ? "text-[10px]" :
                            displayMode === "comfortable" ? "text-sm sm:text-base" :
                            "text-xs sm:text-sm"
                          )}>
                            {item.contentSnippet || "..."}
                          </p>
                        </div>
                        <div className="mt-4 sm:mt-0 flex items-center gap-4 text-[10px] font-mono opacity-40 group-hover:opacity-100 pl-8 sm:pl-0">
                          <span>{item.pubDate ? new Date(item.pubDate).toLocaleDateString() : "..."}</span>
                          <ExternalLink size={12} />
                        </div>
                      </a>
                    ))}
                  </div>
                </section>
              )}
            </motion.div>
          ) : (
            <div className="h-[60vh] sm:h-[80vh] flex flex-col items-center justify-center text-center space-y-6 px-4">
              <div className="w-20 h-20 sm:w-24 sm:h-24 bg-[#141414]/5 rounded-full flex items-center justify-center">
                <AlertCircle size={40} className="opacity-20" />
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl sm:text-3xl font-display italic">{uiLabels.noSources}</h2>
                <p className="text-sm sm:text-base opacity-50">{uiLabels.addFirstSource}</p>
              </div>
              <button 
                onClick={() => setShowAddSource(true)}
                className="px-8 py-3 bg-[#141414] text-[#E4E3E0] rounded-full hover:scale-105 transition-transform text-sm sm:text-base"
              >
                {uiLabels.addFirstSource}
              </button>
            </div>
          )}
        </AnimatePresence>
      </main>

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-[#141414]/80 backdrop-blur-sm z-50 flex items-center justify-center p-6"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-[#E4E3E0] w-full max-w-md rounded-3xl p-8 space-y-8 max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-2xl font-display italic">{uiLabels.settings}</h3>
                <button onClick={() => setShowSettings(false)} className="opacity-50 hover:opacity-100">
                  <Plus size={24} className="rotate-45" />
                </button>
              </div>

              {/* Language Setting */}
              <div className="space-y-4 pt-4 border-t border-[#141414]/10">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <label className="font-mono text-[10px] uppercase tracking-widest opacity-50">{uiLabels.language}</label>
                    <select 
                      value={language}
                      onChange={(e) => setLanguage(e.target.value)}
                      className="bg-transparent border-b border-[#141414] py-1 focus:outline-none block w-full"
                    >
                      <option value="zh-tw">繁體中文 (zh-tw)</option>
                      <option value="en">English</option>
                      <option value="ja">日本語</option>
                      <option value="ko">한국어</option>
                    </select>
                  </div>
                  <button 
                    onClick={translateUI}
                    disabled={translatingUI}
                    className="flex items-center gap-2 text-xs font-medium bg-[#141414] text-[#E4E3E0] px-3 py-2 rounded-lg hover:opacity-80 transition-opacity disabled:opacity-50"
                  >
                    {translatingUI ? <Loader2 size={14} className="animate-spin" /> : <Languages size={14} />}
                    <span>{uiLabels.translateUI}</span>
                  </button>
                </div>
              </div>

              {/* API Key Setting */}
              <div className="space-y-4 pt-4 border-t border-[#141414]/10">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="font-mono text-[10px] uppercase tracking-widest opacity-50">{uiLabels.personalApiKey}</label>
                    {!userApiKey && (
                      <span className={cn(
                        "text-[10px] font-mono px-2 py-0.5 rounded-full",
                        isUnlimited ? "bg-purple-500/10 text-purple-600" : (trialCount > 0 ? "bg-green-500/10 text-green-600" : "bg-red-500/10 text-red-600")
                      )}>
                        {isUnlimited ? "無限額度" : `${uiLabels.trialRemaining}: ${trialCount}`}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <input 
                      type="password" 
                      value={apiKeyInput}
                      onChange={(e) => setApiKeyInput(e.target.value)}
                      placeholder={uiLabels.apiKeyPlaceholder}
                      className="flex-1 bg-transparent border-b border-[#141414] py-2 focus:outline-none focus:border-b-2 transition-all text-sm"
                    />
                    <button 
                      onClick={() => {
                        setUserApiKey(apiKeyInput);
                        alert(uiLabels.apiKeySaved);
                      }}
                      className="px-4 py-2 bg-[#141414] text-[#E4E3E0] rounded-lg text-xs font-medium hover:opacity-80 transition-opacity"
                    >
                      {uiLabels.saveApiKey}
                    </button>
                  </div>
                  <div className="flex items-center gap-1 text-[10px] opacity-40">
                    <AlertCircle size={10} />
                    <span>{uiLabels.apiKeyInfo}</span>
                    <a 
                      href="https://ai.google.dev/" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="underline flex items-center gap-0.5"
                    >
                      {uiLabels.howToGetApiKey} <ExternalLink size={8} />
                    </a>
                  </div>
                </div>
              </div>

              <div className="space-y-4 pt-4 border-t border-[#141414]/10">
                <div className="space-y-2">
                  <label className="font-mono text-[10px] uppercase tracking-widest opacity-50">{uiLabels.displayMode}</label>
                  <div className="flex gap-2">
                    {(["auto", "compact", "comfortable"] as const).map((mode) => (
                      <button 
                        key={mode}
                        onClick={() => setDisplayMode(mode)}
                        className={cn(
                          "flex-1 py-2 rounded-lg text-[10px] font-medium border border-[#141414] transition-all",
                          displayMode === mode ? "bg-[#141414] text-[#E4E3E0]" : "hover:bg-[#141414]/5"
                        )}
                      >
                        {uiLabels[mode]}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <button 
                onClick={() => setShowSettings(false)}
                className="w-full py-4 bg-[#141414] text-[#E4E3E0] rounded-xl font-medium hover:scale-[1.02] transition-transform"
              >
                {uiLabels.close}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Add Source Modal */}
      <AnimatePresence>
        {showAddSource && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-[#141414]/80 backdrop-blur-sm z-50 flex items-center justify-center p-6"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-[#E4E3E0] w-full max-w-md rounded-3xl p-8 space-y-8 max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-2xl font-display italic">{uiLabels.addSourceTitle}</h3>
                <button onClick={() => setShowAddSource(false)} className="opacity-50 hover:opacity-100">
                  <Plus size={24} className="rotate-45" />
                </button>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="font-mono text-[10px] uppercase tracking-widest opacity-50">{uiLabels.sourceType}</label>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => setNewFeedType("rss")}
                      className={cn(
                        "flex-1 py-2 rounded-lg text-xs font-medium border border-[#141414] transition-all",
                        newFeedType === "rss" ? "bg-[#141414] text-[#E4E3E0]" : "hover:bg-[#141414]/5"
                      )}
                    >
                      {uiLabels.rssFeed}
                    </button>
                    <button 
                      onClick={() => setNewFeedType("webpage")}
                      className={cn(
                        "flex-1 py-2 rounded-lg text-xs font-medium border border-[#141414] transition-all",
                        newFeedType === "webpage" ? "bg-[#141414] text-[#E4E3E0]" : "hover:bg-[#141414]/5"
                      )}
                    >
                      {uiLabels.webpage}
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="font-mono text-[10px] uppercase tracking-widest opacity-50">{uiLabels.sourceName}</label>
                  <input 
                    type="text" 
                    value={newFeedName}
                    onChange={(e) => setNewFeedName(e.target.value)}
                    placeholder="e.g. TechCrunch"
                    className="w-full bg-transparent border-b border-[#141414] py-2 focus:outline-none focus:border-b-2 transition-all"
                  />
                </div>
                <div className="space-y-2">
                  <label className="font-mono text-[10px] uppercase tracking-widest opacity-50">{uiLabels.rssUrl}</label>
                  <input 
                    type="url" 
                    value={newFeedUrl}
                    onChange={(e) => setNewFeedUrl(e.target.value)}
                    placeholder={newFeedType === "rss" ? "https://example.com/feed" : "https://example.com/article"}
                    className="w-full bg-transparent border-b border-[#141414] py-2 focus:outline-none focus:border-b-2 transition-all"
                  />
                </div>
                <div className="space-y-2">
                  <label className="font-mono text-[10px] uppercase tracking-widest opacity-50">{uiLabels.category}</label>
                  <select
                    value={newFeedCategory}
                    onChange={(e) => setNewFeedCategory(e.target.value)}
                    className="w-full bg-transparent border-b border-[#141414] py-2 focus:outline-none focus:border-b-2 transition-all appearance-none cursor-pointer"
                  >
                    <option value="">{uiLabels.allCategories}</option>
                    <option value="tech">{uiLabels.tech}</option>
                    <option value="humanities">{uiLabels.humanities}</option>
                    <option value="business">{uiLabels.business}</option>
                    <option value="entertainment">{uiLabels.entertainment}</option>
                    <option value="general">{uiLabels.general}</option>
                  </select>
                </div>
              </div>

              <button 
                onClick={() => {
                  addFeed();
                  setShowAddSource(false);
                }}
                disabled={!newFeedUrl || !newFeedName}
                className="w-full py-4 bg-[#141414] text-[#E4E3E0] rounded-xl font-medium hover:scale-[1.02] transition-transform disabled:opacity-50 disabled:scale-100"
              >
                {uiLabels.addSource}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile Nav Toggle */}
      <button 
        onClick={() => setShowAddSource(true)}
        className="fixed bottom-8 right-8 w-14 h-14 bg-[#141414] text-[#E4E3E0] rounded-full shadow-2xl md:hidden flex items-center justify-center z-40"
      >
        <Plus size={24} />
      </button>
    </div>
  );
}
