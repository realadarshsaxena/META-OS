/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { toPng } from 'html-to-image';
import { 
  Search, 
  Sparkles, 
  History, 
  Bookmark, 
  User as UserIcon, 
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
  Loader2,
  Mic,
  Video,
  Share2,
  Zap,
  Globe,
  MessageSquare,
  Clock,
  Wind,
  Heart,
  ShieldCheck
} from 'lucide-react';
import Groq from "groq-sdk";
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
  updateDoc,
  limit,
  Timestamp
} from 'firebase/firestore';

// Types
interface SearchResult {
  id: string;
  title: string;
  url: string;
  snippet: string;
  source: string;
  imageUrl?: string;
}

interface SearchImage {
  title: string;
  imageUrl: string;
  link: string;
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

interface GlobalActivityItem {
  id: string;
  query: string;
  timestamp: Timestamp;
}

type Persona = 'hype' | 'scholar' | 'cynic';

// AI Service
const getApiKey = () => {
  try {
    return (import.meta as any).env.VITE_GROQ_API_KEY || 
           (import.meta as any).env.VITE_AI_KEY || 
           (import.meta as any).env.VITE_API_KEY;
  } catch {
    return (import.meta as any).env.VITE_GROQ_API_KEY || 
           (import.meta as any).env.VITE_AI_KEY || 
           (import.meta as any).env.VITE_API_KEY;
  }
};

const GROQ_KEY = getApiKey();
const ai = GROQ_KEY ? new Groq({ apiKey: GROQ_KEY, dangerouslyAllowBrowser: true }) : null;

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [imageResults, setImageResults] = useState<SearchImage[]>([]);
  const [aiInsight, setAiInsight] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([]);
  const [activeTab, setActiveTab] = useState<'search' | 'history' | 'bookmarks' | 'zen'>('search');
  const [showProfile, setShowProfile] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [isAnalyzingImage, setIsAnalyzingImage] = useState(false);
  const [imageAnalysis, setImageAnalysis] = useState<string | null>(null);
  const [selectedVideo, setSelectedVideo] = useState<string | null>(null);
  const [isVideoAnalyzing, setIsVideoAnalyzing] = useState(false);
  const [videoAnalysis, setVideoAnalysis] = useState<string | null>(null);
  const [persona, setPersona] = useState<Persona>('hype');
  const [credits, setCredits] = useState<number>(10);
  const [globalActivity, setGlobalActivity] = useState<GlobalActivityItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const [isAiLoading, setIsAiLoading] = useState(false);
  const [firestoreError, setFirestoreError] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [chatHistory, setChatHistory] = useState<{ role: 'user' | 'assistant', content: string }[]>([]);
  const [followUpQuery, setFollowUpQuery] = useState('');
  const [isFollowUpLoading, setIsFollowUpLoading] = useState(false);
  const [searchMemory, setSearchMemory] = useState<string[]>([]);
  const [isListening, setIsListening] = useState(false);

  // Zen Mode State
  const [zenChat, setZenChat] = useState<{ role: 'user' | 'assistant', content: string }[]>([]);
  const [zenQuery, setZenQuery] = useState('');
  const [isZenLoading, setIsZenLoading] = useState(false);

  // Voice Recognition Setup
  const requestMicPermission = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop()); // Close the stream immediately
      return true;
    } catch (err) {
      console.error("Mic permission request failed", err);
      return false;
    }
  };

  const startListening = async (target: 'search' | 'followup') => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Voice recognition is not supported in this browser. Try Chrome or Edge! 🎙️");
      return;
    }

    // Proactively request permission if it might be blocked
    const hasPermission = await requestMicPermission();
    if (!hasPermission) {
      alert("Microphone access is required for voice features. Please allow it in your browser settings! 🎤❌");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    recognition.onerror = (event: any) => {
      console.error("Speech recognition error", event.error);
      setIsListening(false);
      
      if (event.error === 'not-allowed') {
        alert("Microphone access was denied. Please check your browser settings and ensure you've granted permission to this site! 🎤❌");
      } else if (event.error === 'no-speech') {
        // Just ignore if they didn't say anything
      } else {
        alert(`Speech recognition error: ${event.error}. Try again? 📡`);
      }
    };

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      if (target === 'search') {
        setSearchQuery(transcript);
      } else {
        setFollowUpQuery(transcript);
      }
    };

    recognition.start();
  };

  // Safety Reset for Loading States
  useEffect(() => {
    let timeout: NodeJS.Timeout;
    if (isSearching || isAiLoading || isAnalyzingImage) {
      timeout = setTimeout(() => {
        setIsSearching(false);
        setIsAiLoading(false);
        setIsAnalyzingImage(false);
      }, 25000); // 25s hard limit
    }
    return () => clearTimeout(timeout);
  }, [isSearching, isAiLoading, isAnalyzingImage]);

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

    const globalQuery = query(
      collection(db, 'global_activity'),
      orderBy('timestamp', 'desc'),
      limit(10)
    );
    const unsubscribeGlobal = onSnapshot(globalQuery, (snapshot) => {
      setGlobalActivity(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as GlobalActivityItem)));
    });

    // Credit logic: Sync credits from user doc
    const userDocRef = doc(db, 'users', user.uid);
    const unsubscribeUser = onSnapshot(userDocRef, (doc) => {
      if (doc.exists()) {
        const data = doc.data();
        setCredits(data.credits ?? 10);
        
        // Daily reset logic
        const lastReset = data.lastCreditReset?.toDate();
        const now = new Date();
        if (!lastReset || now.getDate() !== lastReset.getDate()) {
          updateDoc(userDocRef, {
            credits: 10,
            lastCreditReset: serverTimestamp()
          });
        }
      }
    });

    return () => {
      unsubscribeHistory();
      unsubscribeBookmarks();
      unsubscribeGlobal();
      unsubscribeUser();
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

  const getPersonaPrompt = () => {
    switch (persona) {
      case 'scholar':
        return "You are a distinguished scholar for VibeSearch. Provide deep, academic insights with formal language and citations. No slang, only rigorous facts.";
      case 'cynic':
        return "You are a brutally honest, cynical AI for VibeSearch. Be sarcastic, skeptical, and highlight the flaws or ironies in the search results. Keep it real but edgy.";
      default:
        return "You are a Gen Z AI assistant for VibeSearch. Use punchy language, emojis, and stay context-aware. Be helpful but keep the vibe high.";
    }
  };

  const performSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    setIsAiLoading(true);
    setAiInsight(null);
    setChatHistory([]);
    setSearchMemory(prev => [searchQuery, ...prev].slice(0, 5));
    setActiveTab('search');

    // Global Activity Logging (Anonymized)
    try {
      addDoc(collection(db, 'global_activity'), {
        query: searchQuery.slice(0, 50), // Truncate for privacy
        timestamp: serverTimestamp()
      });
    } catch (e) { console.error("Global log failed", e); }

    try {
      // 1. Fetch Real Search Results from Serper
      const serperKey = (import.meta as any).env.VITE_SERPER_API_KEY;
      let searchData;
      let imageData;
      
      if (serperKey) {
        const [searchRes, imageRes] = await Promise.all([
          fetch('https://google.serper.dev/search', {
            method: 'POST',
            headers: { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({ q: searchQuery })
          }),
          fetch('https://google.serper.dev/images', {
            method: 'POST',
            headers: { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({ q: searchQuery, num: 8 })
          })
        ]);
        
        searchData = await searchRes.json();
        imageData = await imageRes.json();
      }

      const webResults: SearchResult[] = searchData?.organic?.map((item: any, idx: number) => ({
        id: `serper-${idx}`,
        title: item.title,
        url: item.link,
        snippet: item.snippet,
        source: new URL(item.link).hostname.replace('www.', ''),
        imageUrl: item.imageUrl
      })) || [
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
        }
      ];

      const images: SearchImage[] = imageData?.images?.map((img: any) => ({
        title: img.title,
        imageUrl: img.imageUrl,
        link: img.link
      })) || [];

      setResults(webResults);
      setImageResults(images);
      setIsSearching(false);

      // 2. Get AI Insights (Async) with Search Context
      if (!ai) {
        setAiInsight("Groq API Key is missing. Please add VITE_GROQ_API_KEY to your secrets. 🛸");
        setIsAiLoading(false);
        return;
      }

      try {
        const getInsight = async () => {
          const contextPrompt = searchMemory.length > 0 
            ? `Recent Multiverse Activity: ${searchMemory.join(', ')}. `
            : '';
          
          const searchContext = webResults.slice(0, 3).map(r => `Source: ${r.source}\nTitle: ${r.title}\nSnippet: ${r.snippet}`).join('\n\n');

          const aiPromise = ai.chat.completions.create({
            model: "llama-3.3-70b-versatile",
            messages: [
              { 
                role: "system", 
                content: `${getPersonaPrompt()} 
                User Name: ${user?.displayName || 'Adarsh Saxena'}. 
                ${contextPrompt}
                
                REAL-TIME SEARCH CONTEXT:
                ${searchContext}

                Provide a short insight for the current search using the provided real-time context. 
                Stay under 100 words.` 
              },
              { role: "user", content: `Current Search: "${searchQuery}"` }
            ],
            max_tokens: 300
          });

          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error("AI Timeout")), 12000)
          );

          return await Promise.race([aiPromise, timeoutPromise]) as any;
        };

        const result = await getInsight();
        const insight = result?.choices?.[0]?.message?.content || "The multiverse is quiet on this one. 🌌";
        setAiInsight(insight);
        setChatHistory([{ role: 'assistant', content: insight }]);

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

  const handleZenChat = async (e?: React.FormEvent, customQuery?: string) => {
    if (e) e.preventDefault();
    const query = customQuery || zenQuery;
    if (!query.trim() || isZenLoading || !ai) return;

    const newChat = [...zenChat, { role: 'user', content: query } as const];
    setZenChat(newChat);
    setZenQuery('');
    setIsZenLoading(true);

    try {
      const response = await ai.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages: [
          { 
            role: "system", 
            content: "You are a specialized Zen AI assistant for VibeSearch. Your goal is to help users who are overthinking or feeling anxious. Use a calm, grounding, and supportive tone. Provide short, actionable grounding exercises (like 5-4-3-2-1 or box breathing) if appropriate. Avoid overwhelming them with information. Be a safe space." 
          },
          ...newChat
        ],
        temperature: 0.5,
        max_tokens: 500
      });

      const aiResponse = response.choices[0]?.message?.content || "I'm here for you. Take a deep breath. 🌬️";
      setZenChat([...newChat, { role: 'assistant', content: aiResponse }]);
    } catch (err) {
      console.error("Zen chat failed", err);
      setZenChat([...newChat, { role: 'assistant', content: "The multiverse is a bit noisy right now. Let's just breathe together for a moment. 🧘‍♂️" }]);
    } finally {
      setIsZenLoading(false);
    }
  };

  const handleFollowUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!followUpQuery.trim() || !ai || isFollowUpLoading) return;

    const userMessage = followUpQuery.trim();
    setFollowUpQuery('');
    setChatHistory(prev => [...prev, { role: 'user', content: userMessage }]);
    setIsFollowUpLoading(true);

    try {
      const response = await ai.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages: [
          { 
            role: "system", 
            content: `${getPersonaPrompt()} Keep the conversation going based on the previous context. User Name: ${user?.displayName || 'Adarsh Saxena'}. Current Topic: ${searchQuery}.` 
          },
          ...chatHistory.map(msg => ({ role: msg.role, content: msg.content })),
          { role: "user", content: userMessage }
        ],
        max_tokens: 500
      });

      const assistantMessage = response.choices[0].message.content || "The signal is weak... try again? 📡";
      setChatHistory(prev => [...prev, { role: 'assistant', content: assistantMessage }]);
    } catch (error) {
      console.error("Follow-up failed", error);
      setChatHistory(prev => [...prev, { role: 'assistant', content: "My brain just glitched. Try that again? 😵‍💫" }]);
    } finally {
      setIsFollowUpLoading(false);
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
    if (credits <= 0) {
      alert("You've run out of Vibe Credits for today! 🔋💀 Credits reset daily.");
      return;
    }

    setIsAnalyzingImage(true);
    setImageAnalysis(null);
    setActiveTab('search');
    setResults([]); // Clear search results when analyzing image

    try {
      const base64Data = base64Image; // Groq can handle data URLs or base64
      
      if (!ai) {
        setImageAnalysis("Groq API Key is missing for analysis. 💀");
        return;
      }

      const result = await ai.chat.completions.create({
        model: "llama-3.2-11b-vision-preview",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Analyze this image in a Gen Z, punchy style. What's the vibe? What's in it? Keep it short and shareable. Use emojis." },
              { type: "image_url", image_url: { url: base64Data } }
            ]
          }
        ],
        max_tokens: 300
      });
      
      setImageAnalysis(result.choices[0].message.content);
      // Decrement credits
      if (user) {
        updateDoc(doc(db, 'users', user.uid), {
          credits: credits - 1
        });
      }
    } catch (error) {
      console.error("Image analysis failed", error);
      setImageAnalysis("Failed to analyze image. The multiverse is glitching. 💀");
    } finally {
      setIsAnalyzingImage(false);
    }
  };

  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        setSelectedVideo(base64);
        analyzeVideo(base64, file.type);
      };
      reader.readAsDataURL(file);
    }
  };

  const analyzeVideo = async (base64Video: string, mimeType: string) => {
    if (credits <= 0) {
      setVideoAnalysis("You've run out of Vibe Credits for today! 🔋💀 Credits reset daily.");
      return;
    }
    setIsVideoAnalyzing(true);
    setVideoAnalysis(null);
    setActiveTab('search');
    setResults([]);

    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
        setVideoAnalysis("Gemini API Key is missing or invalid. Please check your AI Studio secrets! 🔑💀");
        return;
      }

      const gemini = new GoogleGenAI({ apiKey });
      const base64Data = base64Video.split(',')[1];

      // Use the exact format from the Gemini API skill
      const response = await gemini.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: {
          parts: [
            { text: "Analyze this video content. Provide a summary with CLICKABLE TIMESTAMPS in the format [MM:SS]. What are the key moments? What is the overall vibe? Summarize it in a Gen Z, punchy style with emojis. Keep it short." },
            { inlineData: { data: base64Data, mimeType } }
          ]
        }
      });

      if (response && response.text) {
        setVideoAnalysis(response.text);
        // Decrement credits
        if (user) {
          updateDoc(doc(db, 'users', user.uid), {
            credits: credits - 1
          });
        }
      } else {
        setVideoAnalysis("The AI couldn't generate a response for this video. It might be too large or unsupported. 📼");
      }
    } catch (error: any) {
      console.error("Video analysis failed", error);
      const errorMessage = error?.message || "Unknown error";
      setVideoAnalysis(`Video analysis failed: ${errorMessage}. The timeline is corrupted. 📼💀`);
    } finally {
      setIsVideoAnalyzing(false);
    }
  };

  const shareVibe = async () => {
    if (!cardRef.current) return;
    try {
      const dataUrl = await toPng(cardRef.current, { cacheBust: true });
      const link = document.createElement('a');
      link.download = `vibe-card-${Date.now()}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('Vibe Card generation failed', err);
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
      <div className="min-h-screen flex flex-col items-center justify-center p-4 sm:p-10 bg-[#050505] selection:bg-accent/30 relative overflow-hidden">
        {/* Fascinating Background Blobs */}
        <div className="fascinating-bg">
          <div className="blob w-[500px] h-[500px] -top-48 -left-48 animate-float" style={{ animationDelay: '0s' }} />
          <div className="blob w-[600px] h-[600px] -bottom-48 -right-48 animate-float" style={{ animationDelay: '-10s' }} />
        </div>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-xl w-full text-center space-y-8 sm:space-y-12"
        >
          <div className="space-y-4 sm:space-y-6">
            <h1 className="hero-title">
              VIBE<br /><span className="neon-text">SEARCH.</span>
            </h1>
            <p className="text-lg sm:text-xl text-muted font-bold uppercase tracking-widest">
              Authentication Required
            </p>
          </div>

          <div className="glass p-6 sm:p-12 rounded-[30px] sm:rounded-[40px] border border-white/10 relative overflow-hidden group">
            <div className="relative z-10 space-y-8">
              <div className="w-20 h-20 bg-secondary rounded-3xl mx-auto flex items-center justify-center neon-glow mb-8">
                <UserIcon className="text-white w-10 h-10" />
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
    <div className="min-h-screen flex flex-col selection:bg-accent/30 p-4 sm:p-10">
      {/* Fascinating Background Blobs */}
      <div className="fascinating-bg">
        <div className="blob w-[500px] h-[500px] -top-48 -left-48 animate-float" style={{ animationDelay: '0s' }} />
        <div className="blob w-[400px] h-[400px] top-1/2 left-2/3 animate-float" style={{ animationDelay: '-5s' }} />
        <div className="blob w-[600px] h-[600px] -bottom-48 left-1/4 animate-float" style={{ animationDelay: '-10s' }} />
      </div>

      {/* Header */}
      <header className="flex items-center justify-between mb-8 sm:mb-16">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-black tracking-tighter uppercase">
            Meta // OS
          </h1>
        </div>

        <div className="flex items-center gap-4">
          {user && (
            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 glass rounded-full border border-white/5">
              <Zap size={14} className="text-accent" />
              <span className="text-xs font-black uppercase tracking-tighter">{credits} Vibe Credits</span>
            </div>
          )}
          
          <div className="flex items-center gap-1 glass p-1 rounded-full border border-white/5">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setActiveTab(activeTab === 'zen' ? 'search' : 'zen')}
              className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-tighter transition-all flex items-center gap-1.5 ${activeTab === 'zen' ? 'bg-secondary text-white' : 'text-muted hover:text-white'}`}
            >
              <Wind size={12} /> Zen Mode
            </motion.button>
            <div className="w-[1px] h-3 bg-white/10 mx-1" />
            {(['hype', 'scholar', 'cynic'] as Persona[]).map((p) => (
              <motion.button
                key={p}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setPersona(p)}
                className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-tighter transition-all ${persona === p ? 'bg-accent text-black' : 'text-muted hover:text-white'}`}
              >
                {p}
              </motion.button>
            ))}
          </div>

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
        {activeTab === 'zen' && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="max-w-3xl mx-auto w-full space-y-12 py-8"
          >
            {/* Zen Header */}
            <div className="text-center space-y-4">
              <div className="w-20 h-20 bg-secondary/20 rounded-full mx-auto flex items-center justify-center relative">
                <motion.div 
                  animate={{ scale: [1, 1.5, 1] }}
                  transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                  className="absolute inset-0 bg-secondary/10 rounded-full blur-xl"
                />
                <Wind className="text-secondary relative z-10" size={32} />
              </div>
              <h2 className="text-4xl font-black uppercase tracking-tighter">Zen Space</h2>
              <p className="text-zinc-400 font-medium">Quiet the noise. Ground your mind in the present timeline.</p>
            </div>

            {/* Breathing Bubble */}
            <div className="glass p-12 rounded-[40px] border border-white/5 flex flex-col items-center justify-center gap-8 relative overflow-hidden">
              <motion.div 
                animate={{ 
                  scale: [1, 1.4, 1],
                  opacity: [0.5, 1, 0.5]
                }}
                transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
                className="w-48 h-48 rounded-full bg-gradient-to-br from-secondary/40 to-accent/40 blur-2xl"
              />
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <motion.p 
                  animate={{ opacity: [0, 1, 0] }}
                  transition={{ duration: 8, repeat: Infinity, times: [0, 0.5, 1] }}
                  className="text-2xl font-black uppercase tracking-[0.3em] text-white"
                >
                  Breathe In
                </motion.p>
                <motion.p 
                  animate={{ opacity: [0, 1, 0] }}
                  transition={{ duration: 8, repeat: Infinity, times: [0.5, 0.75, 1], delay: 4 }}
                  className="text-2xl font-black uppercase tracking-[0.3em] text-white absolute"
                >
                  Breathe Out
                </motion.p>
              </div>
            </div>

            {/* Zen Chat */}
            <div className="glass p-6 sm:p-8 rounded-3xl border border-white/5 space-y-6">
              <div className="flex items-center gap-2 mb-4">
                <Heart className="text-red-400" size={20} />
                <span className="text-xs font-black uppercase tracking-widest">Grounding Assistant</span>
              </div>

              <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 scrollbar-hide">
                {zenChat.length === 0 && (
                  <div className="text-center py-8 space-y-4">
                    <p className="text-zinc-500 text-sm">Feeling overwhelmed? I'm here to help you ground yourself.</p>
                    <div className="flex flex-wrap justify-center gap-2">
                      {[
                        "I'm overthinking right now",
                        "Help me ground myself",
                        "Quick breathing exercise",
                        "I feel anxious"
                      ].map((q) => (
                        <button 
                          key={q}
                          onClick={() => handleZenChat(undefined, q)}
                          className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-full text-xs font-bold transition-colors"
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {zenChat.map((msg, i) => (
                  <motion.div 
                    key={i}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div className={`max-w-[85%] p-4 rounded-2xl text-sm font-medium ${
                      msg.role === 'user' 
                        ? 'bg-secondary text-white rounded-tr-none' 
                        : 'bg-white/5 text-zinc-200 rounded-tl-none border border-white/10'
                    }`}>
                      {msg.content}
                    </div>
                  </motion.div>
                ))}
                {isZenLoading && (
                  <div className="flex justify-start">
                    <div className="bg-white/5 p-4 rounded-2xl border border-white/10">
                      <Loader2 className="animate-spin text-secondary" size={20} />
                    </div>
                  </div>
                )}
              </div>

              <form onSubmit={handleZenChat} className="relative mt-4">
                <input 
                  type="text"
                  value={zenQuery}
                  onChange={(e) => setZenQuery(e.target.value)}
                  placeholder="Tell me what's on your mind..."
                  className="w-full bg-white/5 border border-white/10 rounded-xl py-4 px-6 pr-16 text-sm focus:outline-none focus:border-secondary transition-colors"
                />
                <button 
                  type="submit"
                  disabled={isZenLoading || !zenQuery.trim()}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-secondary hover:bg-secondary/10 rounded-lg transition-colors disabled:opacity-50"
                >
                  <ArrowRight size={20} />
                </button>
              </form>
            </div>

            {/* Safety Note */}
            <div className="flex items-start gap-3 p-4 bg-blue-500/5 border border-blue-500/10 rounded-2xl">
              <ShieldCheck className="text-blue-400 flex-shrink-0" size={18} />
              <p className="text-[10px] text-blue-300/60 leading-relaxed uppercase font-bold tracking-wider">
                Note: I am an AI assistant, not a medical professional. If you are in a crisis, please reach out to local emergency services or a mental health professional. You are not alone.
              </p>
            </div>
          </motion.div>
        )}

        {activeTab === 'search' && (
          <div className="space-y-12">
            {/* Hero Section */}
            {!results.length && !isSearching && (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-12 group cursor-default"
              >
                <h2 className="hero-title mb-6 select-none">
                  <span className="block animate-glitch">SEARCH</span>
                  <span className="neon-text block animate-glitch" style={{ animationDelay: '0.1s' }}>BEYOND.</span>
                </h2>
                <p className="text-xl text-muted font-medium uppercase tracking-[0.2em]">The meta-engine for the next generation.</p>
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
            <div className="space-y-4">
              <motion.div 
                layout
                className="relative group max-w-3xl w-full"
              >
                <div className="relative w-full">
                  <form onSubmit={performSearch} className="relative w-full">
                    <input 
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search the multiverse..."
                      className="search-input-theme pr-32 sm:pr-44"
                    />
                    <div className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 flex items-center gap-1 sm:gap-2">
                      <motion.button 
                        type="button"
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        onClick={() => startListening('search')}
                        className={`w-8 h-8 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center transition-all ${isListening ? 'bg-red-500/20 text-red-500 animate-pulse' : 'hover:bg-white/5 text-muted'}`}
                        title="Voice Search"
                      >
                        <Mic size={18} className="sm:hidden" />
                        <Mic size={20} className="hidden sm:block" />
                      </motion.button>
                      <motion.button 
                        type="button"
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        onClick={() => fileInputRef.current?.click()}
                        className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center hover:bg-white/5 text-muted transition-colors"
                        title="Analyze Image"
                      >
                        <Camera size={18} className="sm:hidden" />
                        <Camera size={20} className="hidden sm:block" />
                      </motion.button>
                      <motion.button 
                        type="button"
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        onClick={() => videoInputRef.current?.click()}
                        className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center hover:bg-white/5 text-muted transition-colors"
                        title="Analyze Video"
                      >
                        <Video size={18} className="sm:hidden" />
                        <Video size={20} className="hidden sm:block" />
                      </motion.button>
                      <motion.button 
                        type="submit"
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        disabled={isSearching}
                        className="w-10 h-10 sm:w-12 sm:h-12 bg-secondary rounded-xl flex items-center justify-center hover:bg-secondary/80 transition-colors disabled:opacity-50 neon-glow"
                      >
                        <Search className="text-white" size={20} />
                      </motion.button>
                    </div>
                  </form>
                  <input 
                    type="file"
                    ref={fileInputRef}
                    onChange={handleImageUpload}
                    accept="image/*"
                    className="hidden"
                  />
                  <input 
                    type="file"
                    ref={videoInputRef}
                    onChange={handleVideoUpload}
                    accept="video/*"
                    className="hidden"
                  />
                </div>
              </motion.div>

              {/* Multiverse Feed */}
              <div className="max-w-3xl w-full overflow-hidden relative py-2">
                <div className="flex items-center gap-8 whitespace-nowrap animate-marquee">
                  <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-accent">
                    <Globe size={12} /> Live Multiverse Activity:
                  </div>
                  {globalActivity.map((act) => (
                    <span key={act.id} className="text-[10px] font-bold uppercase tracking-widest text-muted/60">
                      • {act.query}
                    </span>
                  ))}
                  {/* Duplicate for seamless loop */}
                  {globalActivity.map((act) => (
                    <span key={`${act.id}-dup`} className="text-[10px] font-bold uppercase tracking-widest text-muted/60">
                      • {act.query}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Image/Video Preview */}
            <div className="flex flex-wrap gap-4">
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

              <AnimatePresence>
                {selectedVideo && (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    className="relative w-48 h-48 rounded-2xl overflow-hidden border-2 border-secondary group"
                  >
                    <video src={selectedVideo} className="w-full h-full object-cover" />
                    <button 
                      onClick={() => setSelectedVideo(null)}
                      className="absolute top-2 right-2 p-1 bg-black/50 rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X size={16} />
                    </button>
                    {isVideoAnalyzing && (
                      <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                        <Loader2 className="text-secondary animate-spin" size={32} />
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Results Grid */}
            <AnimatePresence mode="wait">
              {isSearching || isAnalyzingImage || isVideoAnalyzing ? (
                <motion.div 
                  key="loading"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-col items-center justify-center py-20 gap-4"
                >
                  <div className={`w-12 h-12 border-4 ${isVideoAnalyzing ? 'border-secondary' : 'border-accent'} border-t-transparent rounded-full animate-spin`} />
                  <p className="text-muted font-black uppercase tracking-widest animate-pulse">
                    {isVideoAnalyzing ? 'DECODING VIDEO...' : isAnalyzingImage ? 'ANALYZING VIBES...' : 'CRAWLING MULTIVERSE...'}
                  </p>
                </motion.div>
              ) : (results.length > 0 || imageAnalysis || videoAnalysis) ? (
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
                      className="glass p-4 sm:p-8 rounded-3xl relative overflow-hidden group border border-white/10 w-full"
                    >
                      <div className="flex items-center justify-between mb-6">
                        <div className="ai-badge-theme">AI Synthetic Insight // {persona} mode</div>
                        {aiInsight && (
                          <button 
                            onClick={shareVibe}
                            className="flex items-center gap-2 px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-full text-[10px] font-black uppercase tracking-tighter transition-all"
                          >
                            <Share2 size={12} /> Share Vibe Card
                          </button>
                        )}
                      </div>

                      <div ref={cardRef} className="relative z-10 p-6 bg-black/20 rounded-2xl border border-white/5 overflow-hidden">
                        {/* Shimmer Effect when loading */}
                        {isAiLoading && <div className="absolute inset-0 shimmer pointer-events-none" />}
                        
                        <h3 className="text-2xl font-bold mb-4 neon-text">Multiverse Context</h3>
                        {isAiLoading ? (
                          <div className="space-y-4">
                            <div className="h-4 bg-white/10 rounded w-full animate-pulse" />
                            <div className="h-4 bg-white/10 rounded w-5/6 animate-pulse" />
                            <div className="h-4 bg-white/10 rounded w-4/6 animate-pulse" />
                          </div>
                        ) : (
                          <div className="space-y-6">
                            {/* Chat History */}
                            <div className="space-y-4">
                              {chatHistory.map((msg, i) => (
                                <motion.div 
                                  key={i}
                                  initial={{ opacity: 0, x: msg.role === 'user' ? 20 : -20 }}
                                  animate={{ opacity: 1, x: 0 }}
                                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                                >
                                  <div className={`max-w-[85%] p-4 rounded-2xl ${
                                    msg.role === 'user' 
                                      ? 'bg-accent text-black font-bold' 
                                      : 'bg-white/5 text-zinc-300 border border-white/10'
                                  }`}>
                                    {msg.content}
                                  </div>
                                </motion.div>
                              ))}
                              {isFollowUpLoading && (
                                <div className="flex justify-start">
                                  <div className="bg-white/5 p-4 rounded-2xl border border-white/10">
                                    <Loader2 className="animate-spin text-accent" size={20} />
                                  </div>
                                </div>
                              )}
                            </div>

                            {/* Follow-up Input */}
                            <form onSubmit={handleFollowUp} className="relative mt-4">
                              <div className="relative flex items-center">
                                <input 
                                  type="text"
                                  value={followUpQuery}
                                  onChange={(e) => setFollowUpQuery(e.target.value)}
                                  placeholder="Ask more about this..."
                                  className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 pr-24 text-sm focus:outline-none focus:border-accent transition-colors"
                                />
                                <div className="absolute right-2 flex items-center gap-1">
                                  <button 
                                    type="button"
                                    onClick={() => startListening('followup')}
                                    className={`p-2 rounded-lg transition-all ${isListening ? 'text-red-500 animate-pulse' : 'text-muted hover:text-white'}`}
                                    title="Voice Input"
                                  >
                                    <Mic size={18} />
                                  </button>
                                  <button 
                                    type="submit"
                                    disabled={isFollowUpLoading || !followUpQuery.trim()}
                                    className="p-2 text-accent hover:bg-accent/10 rounded-lg transition-colors disabled:opacity-50"
                                  >
                                    <ArrowRight size={18} />
                                  </button>
                                </div>
                              </div>
                            </form>
                          </div>
                        )}

                        {/* Card Branding for Share */}
                        <div className="mt-8 pt-6 border-t border-white/5 flex items-center justify-between opacity-0 group-hover:opacity-100 transition-opacity">
                          <div className="text-[10px] font-black uppercase tracking-[0.2em] text-accent">VibeSearch // Meta OS</div>
                          <div className="text-[10px] font-bold text-muted uppercase tracking-widest">Timeline: {new Date().toLocaleDateString()}</div>
                        </div>
                      </div>
                      
                      {/* Decor */}
                      <div className="absolute -bottom-20 -right-20 w-64 h-64 bg-secondary/20 blur-[80px] rounded-full pointer-events-none" />
                    </motion.div>
                  )}

                  <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-8">
                    {/* Web Results Column or Analysis */}
                    <div className="space-y-6">
                      {/* Image Results Row */}
                      {imageResults.length > 0 && (
                        <motion.div 
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="space-y-4"
                        >
                          <div className="flex items-center gap-2 mb-2">
                            <ImageIcon className="text-accent" size={20} />
                            <span className="text-[10px] font-black text-accent uppercase tracking-[0.2em]">Visual Multiverse</span>
                          </div>
                          <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide">
                            {imageResults.map((img, i) => (
                              <motion.a
                                key={i}
                                href={img.link}
                                target="_blank"
                                rel="noopener noreferrer"
                                whileHover={{ scale: 1.05, y: -5 }}
                                className="flex-shrink-0 w-40 h-40 rounded-2xl overflow-hidden border border-white/10 glass relative group"
                              >
                                <img 
                                  src={img.imageUrl} 
                                  alt={img.title}
                                  className="w-full h-full object-cover transition-transform group-hover:scale-110"
                                  referrerPolicy="no-referrer"
                                />
                                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity p-3 flex flex-col justify-end">
                                  <p className="text-[10px] font-bold text-white truncate">{img.title}</p>
                                </div>
                              </motion.a>
                            ))}
                          </div>
                        </motion.div>
                      )}

                      {videoAnalysis && (
                        <motion.div 
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="border-2 border-secondary p-6 sm:p-8 rounded-3xl bg-secondary/5 relative overflow-hidden"
                        >
                          <div className="flex items-center gap-2 mb-6">
                            <Video className="text-secondary" size={24} />
                            <span className="text-xs font-black text-secondary uppercase tracking-[0.2em]">Video Intelligence</span>
                          </div>
                          <p className="text-xl sm:text-2xl font-bold leading-relaxed">
                            {videoAnalysis}
                          </p>
                          <div className="absolute -bottom-10 -right-10 w-40 h-40 bg-secondary/20 blur-[60px] rounded-full pointer-events-none" />
                        </motion.div>
                      )}

                      {imageAnalysis && (
                        <motion.div 
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="border-2 border-accent p-6 sm:p-8 rounded-3xl bg-accent/5 relative overflow-hidden"
                        >
                          <div className="flex items-center gap-2 mb-6">
                            <Camera className="text-accent" size={24} />
                            <span className="text-xs font-black text-accent uppercase tracking-[0.2em]">Visual Analysis</span>
                          </div>
                          <p className="text-xl sm:text-2xl font-bold leading-relaxed">
                            {imageAnalysis}
                          </p>
                          <div className="absolute -bottom-10 -right-10 w-40 h-40 bg-accent/20 blur-[60px] rounded-full pointer-events-none" />
                        </motion.div>
                      )}

                      {results.map((result, idx) => (
                        <motion.div 
                          key={result.id}
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          whileHover={{ y: -5, scale: 1.01 }}
                          transition={{ delay: idx * 0.05 }}
                          className="border border-muted p-4 sm:p-6 rounded-2xl hover:border-secondary transition-all duration-300 group relative glass overflow-hidden"
                        >
                          <div className="absolute inset-0 shimmer opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                          <div className="flex justify-between items-start mb-4 relative z-10">
                            <span className="text-[10px] font-black text-muted uppercase tracking-[0.2em]">{result.source}</span>
                            <button 
                              onClick={() => toggleBookmark(result)}
                              className={`p-2 rounded-lg transition-colors ${bookmarks.some(b => b.url === result.url) ? 'bg-accent text-black' : 'hover:bg-white/5 text-muted'}`}
                            >
                              <Bookmark size={16} />
                            </button>
                          </div>
                          <a href={result.url} target="_blank" rel="noopener noreferrer" className="block group">
                            <div className="flex flex-col sm:flex-row gap-4">
                              {result.imageUrl && (
                                <div className="w-full sm:w-32 h-32 sm:h-24 rounded-xl overflow-hidden flex-shrink-0 border border-white/5">
                                  <img 
                                    src={result.imageUrl} 
                                    className="w-full h-full object-cover group-hover:scale-110 transition-transform" 
                                    alt="" 
                                    referrerPolicy="no-referrer"
                                  />
                                </div>
                              )}
                              <div className="flex-1">
                                <h3 className="text-xl font-bold mb-2 group-hover:text-accent transition-colors flex items-center gap-2">
                                  {result.title} <ExternalLink size={14} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                                </h3>
                                <p className="text-zinc-400 text-sm leading-relaxed">{result.snippet}</p>
                              </div>
                            </div>
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
            <div className="flex items-center justify-between mb-8 sm:mb-12">
              <h2 className="hero-title text-4xl sm:text-6xl">HISTORY</h2>
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
            <div className="flex items-center justify-between mb-8 sm:mb-12">
              <h2 className="hero-title text-4xl sm:text-6xl">SAVED</h2>
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
      <footer className="mt-20 py-12 flex flex-col sm:flex-row justify-between items-center sm:items-end gap-8 border-t border-muted/30">
        <div className="flex flex-col gap-2 text-center sm:text-left">
          <div className="text-[10px] sm:text-[12px] text-muted uppercase tracking-[0.2em] font-medium">
            Engineered by <strong className="text-white font-black">Adarsh Saxena</strong>
          </div>
        </div>

        <div className="flex flex-wrap justify-center gap-4 sm:gap-8 text-[10px] sm:text-[12px] font-black uppercase tracking-widest text-accent">
          <span className="cursor-pointer hover:underline underline-offset-4">Instagram</span>
          <span className="cursor-pointer hover:underline underline-offset-4">Twitter</span>
          <span className="cursor-pointer hover:underline underline-offset-4">Discord</span>
        </div>
      </footer>
    </div>
  );
}

