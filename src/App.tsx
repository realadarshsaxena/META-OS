/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Search, 
  Sparkles, 
  History, 
  Bookmark, 
  User, 
  LogOut, 
  ArrowRight, 
  X, 
  ChevronRight,
  Github,
  Twitter,
  Instagram,
  ExternalLink,
  Plus,
  Image as ImageIcon,
  Upload,
  Camera,
  Loader2
} from 'lucide-react';
import { GoogleGenAI } from "@google/genai";
import { 
  auth, 
  db, 
  googleProvider, 
  signInWithPopup, 
  onAuthStateChanged, 
  FirebaseUser 
} from './firebase';
import { 
  collection, 
  addDoc, 
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  serverTimestamp, 
  deleteDoc, 
  doc,
  getDocFromServer,
  Timestamp
} from 'firebase/firestore';

// Types
interface SearchResult {
  id: string;
  title: string;
  url: string;
  snippet: string;
  source: string;
}

interface HistoryItem {
  id: string;
  query: string;
  timestamp: Timestamp;
  aiInsight?: string;
}

interface BookmarkItem {
  id: string;
  title: string;
  url: string;
  snippet: string;
  timestamp: Timestamp;
}

// AI Service
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [aiInsight, setAiInsight] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([]);
  const [activeTab, setActiveTab] = useState<'search' | 'history' | 'bookmarks'>('search');
  const [showProfile, setShowProfile] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [isAnalyzingImage, setIsAnalyzingImage] = useState(false);
  const [imageAnalysis, setImageAnalysis] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isAiLoading, setIsAiLoading] = useState(false);
  const [firestoreError, setFirestoreError] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);

  // Connection Test
  useEffect(() => {
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error: any) {
        if (error.message?.includes('the client is offline')) {
          setFirestoreError("Firebase is offline. Please check your configuration or authorized domains.");
        }
      }
    };
    testConnection();
  }, []);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // Data Listeners
  useEffect(() => {
    if (!user) return;

    const historyQuery = query(
      collection(db, `users/${user.uid}/history`),
      orderBy('timestamp', 'desc')
    );
    const unsubscribeHistory = onSnapshot(historyQuery, (snapshot) => {
      setHistory(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as HistoryItem)));
    });

    const bookmarksQuery = query(
      collection(db, `users/${user.uid}/bookmarks`),
      orderBy('timestamp', 'desc')
    );
    const unsubscribeBookmarks = onSnapshot(bookmarksQuery, (snapshot) => {
      setBookmarks(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as BookmarkItem)));
    });

    return () => {
      unsubscribeHistory();
      unsubscribeBookmarks();
    };
  }, [user]);

  const handleLogin = async () => {
    setLoginError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error: any) {
      console.error("Login failed", error);
      if (error.code === 'auth/popup-blocked') {
        setLoginError("Popup was blocked by your browser. Please allow popups for this site.");
      } else if (error.code === 'auth/cancelled-popup-request') {
        // Ignore if user closed it
      } else {
        setLoginError(`Login failed: ${error.message}. Try opening the app in a new tab.`);
      }
    }
  };

  const handleLogout = () => auth.signOut();

  const performSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    setIsAiLoading(true);
    setAiInsight(null);
    setActiveTab('search');

    try {
      // 1. Simulate Meta Search Results (Instant)
      const mockResults: SearchResult[] = [
        {
          id: '1',
          title: `${searchQuery} - Wikipedia`,
          url: `https://en.wikipedia.org/wiki/${encodeURIComponent(searchQuery)}`,
          snippet: `Comprehensive information about ${searchQuery} including history, key concepts, and cultural impact.`,
          source: 'Wikipedia'
        },
        {
          id: '2',
          title: `Latest news on ${searchQuery}`,
          url: `https://news.google.com/search?q=${encodeURIComponent(searchQuery)}`,
          snippet: `Stay updated with the most recent developments and trending stories regarding ${searchQuery}.`,
          source: 'Google News'
        },
        {
          id: '3',
          title: `Reddit: What people say about ${searchQuery}`,
          url: `https://www.reddit.com/search/?q=${encodeURIComponent(searchQuery)}`,
          snippet: `Join the discussion and see community perspectives on ${searchQuery} from various subreddits.`,
          source: 'Reddit'
        }
      ];
      setResults(mockResults);
      setIsSearching(false); // Stop main loading as results are ready

      // 2. Get AI Insights (Async)
      try {
        const result = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          tools: [{ googleSearch: {} }] as any,
          toolConfig: { includeServerSideToolInvocations: true } as any,
          contents: [{ role: "user", parts: [{ text: `Provide a punchy, Gen Z style summary and insight about "${searchQuery}" using the latest information. Keep it under 100 words. Use emojis.` }] }]
        } as any);
        
        const insight = result?.text || "The multiverse is quiet on this one. 🌌";
        setAiInsight(insight);

        // 3. Save to History
        if (user) {
          await addDoc(collection(db, `users/${user.uid}/history`), {
            uid: user.uid,
            query: searchQuery,
            timestamp: serverTimestamp(),
            aiInsight: insight
          });
        }
      } catch (aiError) {
        console.error("AI Insight failed", aiError);
        setAiInsight("AI is currently vibing elsewhere. Check back in a bit! 🛸");
      } finally {
        setIsAiLoading(false);
      }
    } catch (error) {
      console.error("Search failed", error);
      setIsSearching(false);
      setIsAiLoading(false);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setSelectedImage(reader.result as string);
        analyzeImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const analyzeImage = async (base64Image: string) => {
    setIsAnalyzingImage(true);
    setImageAnalysis(null);
    setActiveTab('search');
    setResults([]); // Clear search results when analyzing image

    try {
      const base64Data = base64Image.split(',')[1];
      
      const result = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: [{
          role: "user",
          parts: [
            { text: "Analyze this image in a Gen Z, punchy style. What's the vibe? What's in it? Keep it short and shareable. Use emojis." },
            { inlineData: { data: base64Data, mimeType: "image/jpeg" } }
          ]
        }]
      });
      
      setImageAnalysis(result.text);
    } catch (error) {
      console.error("Image analysis failed", error);
      setImageAnalysis("Failed to analyze image. The multiverse is glitching. 💀");
    } finally {
      setIsAnalyzingImage(false);
    }
  };

  const toggleBookmark = async (result: SearchResult) => {
    if (!user) return;
    
    const existing = bookmarks.find(b => b.url === result.url);
    if (existing) {
      await deleteDoc(doc(db, `users/${user.uid}/bookmarks`, existing.id));
    } else {
      await addDoc(collection(db, `users/${user.uid}/bookmarks`), {
        uid: user.uid,
        title: result.title,
        url: result.url,
        snippet: result.snippet,
        timestamp: serverTimestamp()
      });
    }
  };

  if (!isAuthReady) return null;

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-10 bg-[#050505] selection:bg-accent/30">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-xl w-full text-center space-y-12"
        >
          <div className="space-y-6">
            <h1 className="hero-title">
              VIBE<br /><span className="neon-text">SEARCH.</span>
            </h1>
            <p className="text-xl text-muted font-bold uppercase tracking-widest">
              Authentication Required to Access the Multiverse
            </p>
          </div>

          <div className="glass p-12 rounded-[40px] border border-white/10 relative overflow-hidden group">
            <div className="relative z-10 space-y-8">
              <div className="w-20 h-20 bg-secondary rounded-3xl mx-auto flex items-center justify-center neon-glow mb-8">
                <User className="text-white w-10 h-10" />
              </div>
              <h2 className="text-3xl font-black uppercase tracking-tighter">Welcome Back</h2>
              <p className="text-zinc-400 font-medium">Sign in with Google to sync your history, bookmarks, and AI insights across timelines.</p>
              
              {loginError && (
                <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm font-medium">
                  {loginError}
                </div>
              )}

              <button 
                onClick={handleLogin}
                className="w-full py-6 bg-white text-black font-black text-lg rounded-2xl hover:bg-zinc-200 transition-all flex items-center justify-center gap-4 group/btn uppercase tracking-tighter"
              >
                Continue with Google
                <ArrowRight className="group-hover/btn:translate-x-2 transition-transform" size={24} />
              </button>

              <div className="pt-4 border-t border-white/5">
                <p className="text-xs text-muted mb-4 uppercase tracking-widest font-bold">Login issues?</p>
                <a 
                  href={window.location.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-accent hover:underline text-sm font-bold uppercase tracking-tighter"
                >
                  Open in New Tab <ExternalLink size={14} />
                </a>
              </div>
            </div>
            
            {/* Decor */}
            <div className="absolute -top-24 -left-24 w-48 h-48 bg-accent/10 blur-[60px] rounded-full" />
            <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-secondary/10 blur-[60px] rounded-full" />
          </div>

          <div className="text-[10px] font-black text-muted uppercase tracking-[0.3em]">
            Engineered by Adarsh Saxena // 2026
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col selection:bg-accent/30 p-10">
      {/* Header */}
      <header className="flex items-center justify-between mb-16">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-black tracking-tighter uppercase">
            Meta // OS
          </h1>
        </div>

        <div className="flex items-center gap-4">
          {user ? (
            <div className="relative">
              <button 
                onClick={() => setShowProfile(!showProfile)}
                className="w-10 h-10 rounded-full border-2 border-accent overflow-hidden hover:scale-105 transition-transform"
              >
                <img src={user.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.email}`} alt="Profile" referrerPolicy="no-referrer" />
              </button>
              
              <AnimatePresence>
                {showProfile && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    className="absolute right-0 mt-2 w-64 glass rounded-2xl p-4 shadow-2xl z-50"
                  >
                    <div className="flex flex-col gap-3">
                      <div className="flex items-center gap-3 pb-3 border-b border-white/10">
                        <img src={user.photoURL || ''} className="w-10 h-10 rounded-full" referrerPolicy="no-referrer" />
                        <div className="overflow-hidden">
                          <p className="font-semibold truncate">{user.displayName}</p>
                          <p className="text-xs text-zinc-400 truncate">{user.email}</p>
                        </div>
                      </div>
                      <button 
                        onClick={() => { setActiveTab('history'); setShowProfile(false); }}
                        className="flex items-center gap-2 p-2 hover:bg-white/5 rounded-lg transition-colors text-sm font-semibold uppercase tracking-wider"
                      >
                        <History size={16} /> History
                      </button>
                      <button 
                        onClick={() => { setActiveTab('bookmarks'); setShowProfile(false); }}
                        className="flex items-center gap-2 p-2 hover:bg-white/5 rounded-lg transition-colors text-sm font-semibold uppercase tracking-wider"
                      >
                        <Bookmark size={16} /> Bookmarks
                      </button>
                      <button 
                        onClick={handleLogout}
                        className="flex items-center gap-2 p-2 hover:bg-red-500/10 text-red-400 rounded-lg transition-colors text-sm font-semibold uppercase tracking-wider"
                      >
                        <LogOut size={16} /> Logout
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ) : (
            <button 
              onClick={handleLogin}
              className="px-6 py-2 bg-white text-black font-bold rounded-full hover:bg-zinc-200 transition-colors flex items-center gap-2 text-sm uppercase tracking-wider"
            >
              Google Login <ArrowRight size={16} />
            </button>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-5xl mx-auto w-full">
        {activeTab === 'search' && (
          <div className="space-y-12">
            {/* Hero Section */}
            {!results.length && !isSearching && (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-12"
              >
                <h2 className="hero-title mb-6">
                  SEARCH<br /><span className="neon-text">BEYOND.</span>
                </h2>
                <p className="text-xl text-muted font-medium">The meta-engine for the next generation.</p>
              </motion.div>
            )}

            {/* Error Messages */}
            {firestoreError && (
              <motion.div 
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-8 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-400 text-center font-bold uppercase tracking-tighter"
              >
                {firestoreError}
              </motion.div>
            )}

            {/* Search Bar */}
            <motion.div 
              layout
              className="relative group max-w-3xl flex gap-4"
            >
              <div className="relative flex-1">
                <form onSubmit={performSearch}>
                  <input 
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search the multiverse..."
                    className="search-input-theme pr-32"
                  />
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2">
                    <button 
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="w-10 h-10 rounded-lg flex items-center justify-center hover:bg-white/5 text-muted transition-colors"
                      title="Analyze Image"
                    >
                      <Camera size={20} />
                    </button>
                    <button 
                      type="submit"
                      disabled={isSearching}
                      className="w-12 h-12 bg-secondary rounded-xl flex items-center justify-center hover:bg-secondary/80 transition-colors disabled:opacity-50 neon-glow"
                    >
                      <Search className="text-white" size={24} />
                    </button>
                  </div>
                </form>
                <input 
                  type="file"
                  ref={fileInputRef}
                  onChange={handleImageUpload}
                  accept="image/*"
                  className="hidden"
                />
              </div>
            </motion.div>

            {/* Image Preview */}
            <AnimatePresence>
              {selectedImage && (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="relative w-48 h-48 rounded-2xl overflow-hidden border-2 border-accent group"
                >
                  <img src={selectedImage} className="w-full h-full object-cover" alt="Selected" />
                  <button 
                    onClick={() => setSelectedImage(null)}
                    className="absolute top-2 right-2 p-1 bg-black/50 rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X size={16} />
                  </button>
                  {isAnalyzingImage && (
                    <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                      <Loader2 className="text-accent animate-spin" size={32} />
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Results Grid */}
            <AnimatePresence mode="wait">
              {isSearching || isAnalyzingImage ? (
                <motion.div 
                  key="loading"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-col items-center justify-center py-20 gap-4"
                >
                  <div className="w-12 h-12 border-4 border-accent border-t-transparent rounded-full animate-spin" />
                  <p className="text-muted font-black uppercase tracking-widest animate-pulse">
                    {isAnalyzingImage ? 'ANALYZING VIBES...' : 'CRAWLING MULTIVERSE...'}
                  </p>
                </motion.div>
              ) : (results.length > 0 || imageAnalysis) ? (
                <motion.div 
                  key="results"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="space-y-8 mt-12"
                >
                  {/* AI Insight Section (Full Width at Top) */}
                  {(aiInsight || isAiLoading) && (
                    <motion.div 
                      initial={{ scale: 0.95, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      className="glass p-8 rounded-3xl relative overflow-hidden group border border-white/10 w-full"
                    >
                      <div className="ai-badge-theme">AI Synthetic Insight</div>
                      <h3 className="text-2xl font-bold mb-4 neon-text">Multiverse Context</h3>
                      {isAiLoading ? (
                        <div className="space-y-4">
                          <div className="h-4 bg-white/10 rounded w-full animate-pulse" />
                          <div className="h-4 bg-white/10 rounded w-5/6 animate-pulse" />
                          <div className="h-4 bg-white/10 rounded w-4/6 animate-pulse" />
                        </div>
                      ) : (
                        <p className="text-zinc-300 leading-relaxed font-medium">
                          {aiInsight}
                        </p>
                      )}
                      {/* Decor */}
                      <div className="absolute -bottom-20 -right-20 w-64 h-64 bg-secondary/20 blur-[80px] rounded-full pointer-events-none" />
                    </motion.div>
                  )}

                  <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-8">
                    {/* Web Results Column or Image Analysis */}
                    <div className="space-y-6">
                      {imageAnalysis && (
                        <motion.div 
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="border-2 border-accent p-8 rounded-3xl bg-accent/5 relative overflow-hidden"
                        >
                          <div className="flex items-center gap-2 mb-6">
                            <Camera className="text-accent" size={24} />
                            <span className="text-xs font-black text-accent uppercase tracking-[0.2em]">Visual Analysis</span>
                          </div>
                          <p className="text-2xl font-bold leading-relaxed">
                            {imageAnalysis}
                          </p>
                          <div className="absolute -bottom-10 -right-10 w-40 h-40 bg-accent/20 blur-[60px] rounded-full pointer-events-none" />
                        </motion.div>
                      )}

                      {results.map((result, idx) => (
                        <motion.div 
                          key={result.id}
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: idx * 0.1 }}
                          className="border border-muted p-6 rounded-2xl hover:border-secondary transition-colors group relative"
                        >
                          <div className="flex justify-between items-start mb-4">
                            <span className="text-[10px] font-black text-muted uppercase tracking-[0.2em]">{result.source}</span>
                            <button 
                              onClick={() => toggleBookmark(result)}
                              className={`p-2 rounded-lg transition-colors ${bookmarks.some(b => b.url === result.url) ? 'bg-accent text-black' : 'hover:bg-white/5 text-muted'}`}
                            >
                              <Bookmark size={16} />
                            </button>
                          </div>
                          <a href={result.url} target="_blank" rel="noopener noreferrer" className="block group">
                            <h3 className="text-xl font-bold mb-2 group-hover:text-accent transition-colors flex items-center gap-2">
                              {result.title} <ExternalLink size={14} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                            </h3>
                            <p className="text-zinc-400 text-sm leading-relaxed">{result.snippet}</p>
                          </a>
                        </motion.div>
                      ))}
                    </div>

                    {/* Secondary Column (Empty or for other widgets) */}
                    <div className="hidden lg:block space-y-6">
                      {/* You can add more widgets here later */}
                    </div>
                  </div>
                </motion.div>
              ) : (
                <motion.div 
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="py-12"
                >
                  <p className="text-muted text-sm font-bold uppercase tracking-widest mb-6">Trending in the Multiverse</p>
                  <div className="flex flex-col gap-3 max-w-md">
                    {['#SpatialComputing', '#NeoMinimalism', '#AdarSaxenaDesign', '#FutureOfSearch'].map((tag, idx) => (
                      <button 
                        key={tag}
                        onClick={() => { setSearchQuery(tag.replace('#', '')); performSearch(); }}
                        className="flex items-center justify-between p-4 border border-muted rounded-xl hover:border-accent hover:bg-accent/5 transition-all group"
                      >
                        <div className="flex items-center gap-4">
                          <span className="text-lg font-black text-muted group-hover:text-accent transition-colors">0{idx + 1}</span>
                          <span className="font-bold">{tag}</span>
                        </div>
                        <ChevronRight size={16} className="text-muted group-hover:text-accent" />
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {activeTab === 'history' && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-6"
          >
            <div className="flex items-center justify-between mb-12">
              <h2 className="hero-title text-6xl">HISTORY</h2>
              <button onClick={() => setActiveTab('search')} className="p-3 border border-muted rounded-full hover:border-white transition-colors"><X size={24} /></button>
            </div>
            {history.length > 0 ? history.map((item, idx) => (
              <div key={item.id} className="border border-muted p-6 rounded-2xl flex items-center justify-between group hover:border-secondary transition-colors">
                <div className="flex items-center gap-6">
                  <span className="text-2xl font-black text-muted">{(idx + 1).toString().padStart(2, '0')}</span>
                  <div>
                    <p className="text-xl font-bold">{item.query}</p>
                    <p className="text-[10px] font-black text-muted uppercase tracking-widest mt-1">{item.timestamp?.toDate().toLocaleString()}</p>
                  </div>
                </div>
                <button 
                  onClick={() => { setSearchQuery(item.query); performSearch(); }}
                  className="p-3 bg-secondary rounded-xl opacity-0 group-hover:opacity-100 transition-opacity hover:bg-secondary/80 text-white"
                >
                  <ChevronRight size={20} />
                </button>
              </div>
            )) : (
              <p className="text-center text-muted font-bold uppercase tracking-widest py-20">No history found in this timeline.</p>
            )}
          </motion.div>
        )}

        {activeTab === 'bookmarks' && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-6"
          >
            <div className="flex items-center justify-between mb-12">
              <h2 className="hero-title text-6xl">SAVED</h2>
              <button onClick={() => setActiveTab('search')} className="p-3 border border-muted rounded-full hover:border-white transition-colors"><X size={24} /></button>
            </div>
            {bookmarks.length > 0 ? bookmarks.map((item) => (
              <div key={item.id} className="border border-muted p-8 rounded-3xl group hover:border-accent transition-colors">
                <div className="flex justify-between items-start mb-4">
                  <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-2xl font-bold hover:text-accent transition-colors">
                    {item.title}
                  </a>
                  <button 
                    onClick={() => deleteDoc(doc(db, `users/${user.uid}/bookmarks`, item.id))}
                    className="p-2 text-muted hover:text-red-400 transition-colors"
                  >
                    <X size={20} />
                  </button>
                </div>
                <p className="text-zinc-400 leading-relaxed mb-4">{item.snippet}</p>
                <div className="flex items-center gap-2 text-[10px] font-black text-muted uppercase tracking-widest">
                  <Bookmark size={10} /> Saved on {item.timestamp?.toDate().toLocaleDateString()}
                </div>
              </div>
            )) : (
              <p className="text-center text-muted font-bold uppercase tracking-widest py-20">Your multiverse collection is empty.</p>
            )}
          </motion.div>
        )}
      </main>

      {/* Footer */}
      <footer className="mt-20 py-12 flex flex-col md:flex-row justify-between items-end gap-8 border-t border-muted/30">
        <div className="flex flex-col gap-2">
          <div className="text-[12px] text-muted uppercase tracking-[0.2em] font-medium">
            Engineered by <strong className="text-white font-black">Adarsh Saxena</strong>
          </div>
        </div>

        <div className="flex gap-8 text-[12px] font-black uppercase tracking-widest text-accent">
          <span className="cursor-pointer hover:underline underline-offset-4">Instagram</span>
          <span className="cursor-pointer hover:underline underline-offset-4">Twitter</span>
          <span className="cursor-pointer hover:underline underline-offset-4">Discord</span>
        </div>
      </footer>
    </div>
  );
}

