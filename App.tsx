
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { HeroScene } from './components/QuantumScene';
import { 
  Upload, 
  Scan, 
  FileText, 
  Loader2, 
  Image as ImageIcon, 
  Copy, 
  Check, 
  Plus, 
  Minus, 
  RefreshCw, 
  X, 
  AlertCircle,
  Zap
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { GoogleGenAI } from "@google/genai";

// --- Types ---
interface WordData {
  word: string;
  partOfSpeech: string;
  definition: string;
  example: string;
}

interface WordSlot {
  id: number;
  pos: string;
  data: WordData | null;
  isChanging: boolean;
}

// --- Constants ---
const POS_OPTIONS = [
  'Any', 'Noun', 'Verb', 'Adjective', 'Adverb', 
  'Pronoun', 'Conjunction', 'Preposition', 'Interjection'
];

const GRADE_LEVELS = [
  'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 
  'Grade 6', 'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10', 
  'High School', 'College'
];

// --- Components ---

const Toast = ({ message, onClose }: { message: string; onClose: () => void }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 4000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20, x: 20 }}
      animate={{ opacity: 1, y: 0, x: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="fixed bottom-8 right-8 z-[100] flex items-center gap-3 px-6 py-4 bg-red-950/80 border border-red-500/50 backdrop-blur-xl rounded-xl shadow-2xl text-red-200"
    >
      <AlertCircle size={20} className="text-red-400" />
      <span className="font-medium">{message}</span>
      <button onClick={onClose} className="ml-2 p-1 hover:bg-red-900/50 rounded-full transition-colors">
        <X size={16} />
      </button>
    </motion.div>
  );
};

const App: React.FC = () => {
  // --- State ---
  const [file, setFile] = useState<File | null>(null);
  const [fileContent, setFileContent] = useState<{ text?: string; base64?: string; mimeType?: string } | null>(null);
  const [gradeLevel, setGradeLevel] = useState('Grade 5');
  const [wordCount, setWordCount] = useState(7);
  const [slots, setSlots] = useState<WordSlot[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [status, setStatus] = useState<'READY' | 'SCANNING' | 'SCAN COMPLETE' | 'ERROR'>('READY');
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Initialization & Sync ---
  useEffect(() => {
    // Initialize or sync slots with wordCount
    setSlots(prev => {
      const newSlots = [...prev];
      if (newSlots.length < wordCount) {
        for (let i = newSlots.length; i < wordCount; i++) {
          newSlots.push({ id: i, pos: 'Any', data: null, isChanging: false });
        }
      } else if (newSlots.length > wordCount) {
        return newSlots.slice(0, wordCount);
      }
      return newSlots;
    });
  }, [wordCount]);

  // --- Handlers ---
  const handleFileChange = async (selectedFile: File) => {
    setFile(selectedFile);
    setStatus('READY');
    setError(null);

    const reader = new FileReader();
    const type = selectedFile.type;

    if (type.startsWith('image/')) {
      reader.onloadend = () => {
        const base64 = (reader.result as string).split(',')[1];
        setFileContent({ base64, mimeType: type });
      };
      reader.readAsDataURL(selectedFile);
    } else if (type === 'text/plain') {
      const text = await selectedFile.text();
      setFileContent({ text });
    } else {
      // Simple text extraction for PDF/DOC as requested
      reader.onload = (e) => {
        const bytes = new Uint8Array(e.target?.result as ArrayBuffer);
        let text = '';
        for (let i = 0; i < bytes.length; i++) {
          const c = bytes[i];
          if ((c >= 32 && c < 127) || c === 10 || c === 13) {
            text += String.fromCharCode(c);
          }
        }
        setFileContent({ text: text.replace(/\s{3,}/g, ' ').trim().substring(0, 8000) });
      };
      reader.readAsArrayBuffer(selectedFile);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files?.[0]) {
      handleFileChange(e.dataTransfer.files[0]);
    }
  };

  const initiateScan = async () => {
    if (!file || !fileContent) {
      setError("Please upload a document first.");
      return;
    }

    setIsScanning(true);
    setStatus('SCANNING');
    setError(null);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
      const model = ai.models.generateContent({
        model: "gemini-2.0-flash",
        contents: {
          parts: [
            { text: `You are a vocabulary expert. Analyze this document and find ${wordCount} vocabulary words that are challenging for ${gradeLevel} students. Respect the part of speech selected per slot: ${slots.map((s, i) => `Slot ${i+1}: ${s.pos}`).join(', ')}. Return ONLY a JSON array: [{ "word": "string", "partOfSpeech": "string", "definition": "string", "example": "string" }]` },
            fileContent.base64 
              ? { inlineData: { mimeType: fileContent.mimeType!, data: fileContent.base64 } }
              : { text: fileContent.text! }
          ]
        },
        config: { responseMimeType: "application/json" }
      });

      const response = await model;
      const data = JSON.parse(response.text || '[]');
      
      setSlots(prev => prev.map((slot, i) => ({
        ...slot,
        data: data[i] || null
      })));
      
      setStatus('SCAN COMPLETE');
    } catch (err) {
      console.error("Scan error:", err);
      setError("Analysis failed. Please check your connection or file format.");
      setStatus('ERROR');
    } finally {
      setIsScanning(false);
    }
  };

  const changeWord = async (index: number) => {
    const slot = slots[index];
    const existingWords = slots.filter(s => s.data).map(s => s.data!.word).join(', ');
    
    setSlots(prev => prev.map((s, i) => i === index ? { ...s, isChanging: true } : s));

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
      const model = ai.models.generateContent({
        model: "gemini-2.0-flash",
        contents: `You are a vocabulary expert. Find ONE replacement vocabulary word for a ${gradeLevel} student. Requirements: Part of speech: ${slot.pos === 'Any' ? 'any' : slot.pos}. Must be DIFFERENT from these already used words: ${existingWords}. Return ONLY a JSON object: { "word": "string", "partOfSpeech": "string", "definition": "string", "example": "string" }`,
        config: { responseMimeType: "application/json" }
      });

      const response = await model;
      const newWord = JSON.parse(response.text || '{}');
      
      setSlots(prev => prev.map((s, i) => i === index ? { ...s, data: newWord, isChanging: false } : s));
    } catch (err) {
      console.error("Change word error:", err);
      setError("Failed to fetch a new word.");
      setSlots(prev => prev.map((s, i) => i === index ? { ...s, isChanging: false } : s));
    }
  };

  const updateSlotPos = (index: number, pos: string) => {
    setSlots(prev => prev.map((s, i) => i === index ? { ...s, pos } : s));
  };

  return (
    <div className="min-h-screen bg-[#050a12] text-[#e0eaf5] font-['DM_Sans'] relative overflow-hidden">
      {/* Background Grid Overlay */}
      <div className="fixed inset-0 pointer-events-none z-0 opacity-20" 
           style={{ backgroundImage: 'linear-gradient(#00d4ff11 1px, transparent 1px), linear-gradient(90deg, #00d4ff11 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
      
      {/* 3D Background */}
      <div className="fixed inset-0 z-0 pointer-events-none opacity-40">
        <HeroScene />
      </div>

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between px-10 py-6 border-b border-[#1a2e45] bg-[#050a12]/80 backdrop-blur-xl">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 border-2 border-[#00d4ff] rounded-lg flex items-center justify-center shadow-[0_0_20px_rgba(0,212,255,0.3)]">
            <Zap size={24} className="text-[#00d4ff]" />
          </div>
          <div>
            <h1 className="font-['Orbitron'] text-2xl font-bold tracking-[3px] text-[#00d4ff] drop-shadow-[0_0_10px_rgba(0,212,255,0.5)]">LEXOSCAN</h1>
            <p className="font-['JetBrains_Mono'] text-[10px] text-[#5a7a99] uppercase tracking-[2px]">Vocabulary Intelligence</p>
          </div>
        </div>
        <div className="font-['JetBrains_Mono'] text-[11px] text-[#00ff9d] border border-[#00ff9d]/30 px-4 py-1.5 rounded-full tracking-wider">
          AI-POWERED · V2.0
        </div>
      </header>

      <div className="relative z-10 app-container grid grid-cols-1 lg:grid-cols-[380px_1fr] min-h-[calc(100vh-89px)]">
        
        {/* LEFT PANEL */}
        <aside className="left-panel border-r border-[#1a2e45] p-8 flex flex-col gap-8 bg-[#0c1520]/60 backdrop-blur-md">
          
          {/* File Upload */}
          <div className="space-y-4">
            <label className="font-['JetBrains_Mono'] text-[10px] text-[#00d4ff] uppercase tracking-[3px] flex items-center gap-2 before:content-[''] before:w-5 before:h-[1px] before:bg-[#00d4ff]">
              Upload Document
            </label>
            <div 
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`relative group cursor-pointer border-2 border-dashed rounded-xl p-8 text-center transition-all duration-300 bg-[#0c1520] ${isDragging || file ? 'border-[#00d4ff] shadow-[0_0_20px_rgba(0,212,255,0.1)]' : 'border-[#1a2e45] hover:border-[#00d4ff]/50'}`}
            >
              <input type="file" ref={fileInputRef} className="hidden" onChange={(e) => e.target.files?.[0] && handleFileChange(e.target.files[0])} accept=".pdf,.txt,.doc,.docx,.png,.jpg,.jpeg,.webp" />
              <div className="mb-4 flex justify-center">
                <div className={`p-4 rounded-xl border-2 transition-colors duration-300 ${file ? 'border-[#00d4ff] text-[#00d4ff]' : 'border-[#1a2e45] text-[#5a7a99] group-hover:border-[#00d4ff]/50'}`}>
                  <Upload size={32} />
                </div>
              </div>
              <p className="text-sm font-medium mb-1">{file ? file.name : 'Drop your file here'}</p>
              <p className="text-xs text-[#5a7a99]">{file ? `${(file.size / 1024).toFixed(1)} KB` : 'or click to browse'}</p>
              
              {file && (
                <button 
                  onClick={(e) => { e.stopPropagation(); setFile(null); setFileContent(null); }}
                  className="absolute top-4 right-4 text-[#5a7a99] hover:text-[#ff6b35] transition-colors"
                >
                  <X size={16} />
                </button>
              )}
            </div>
          </div>

          {/* Settings */}
          <div className="space-y-6">
            <div className="space-y-2">
              <label className="text-xs font-medium text-[#5a7a99]">Grade Level</label>
              <select 
                value={gradeLevel}
                onChange={(e) => setGradeLevel(e.target.value)}
                className="w-full bg-[#0c1520] border border-[#1a2e45] rounded-lg px-4 py-3 text-sm focus:border-[#00d4ff] focus:ring-1 focus:ring-[#00d4ff] outline-none transition-all cursor-pointer appearance-none"
                style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 24 24\' stroke=\'%2300d4ff\'%3E%3Cpath stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'2\' d=\'M19 9l-7 7-7-7\'/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 1rem center', backgroundSize: '1rem' }}
              >
                {GRADE_LEVELS.map(level => <option key={level} value={level}>{level}</option>)}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-[#5a7a99]">Number of Words</label>
              <div className="flex items-center bg-[#0c1520] border border-[#1a2e45] rounded-lg overflow-hidden">
                <button 
                  onClick={() => setWordCount(prev => Math.max(1, prev - 1))}
                  className="p-3 text-[#00d4ff] hover:bg-[#1a2e45] transition-colors"
                >
                  <Minus size={18} />
                </button>
                <input 
                  type="number" 
                  value={wordCount}
                  onChange={(e) => setWordCount(Math.max(1, Math.min(30, parseInt(e.target.value) || 1)))}
                  className="w-full bg-transparent text-center font-['JetBrains_Mono'] text-sm outline-none"
                />
                <button 
                  onClick={() => setWordCount(prev => Math.min(30, prev + 1))}
                  className="p-3 text-[#00d4ff] hover:bg-[#1a2e45] transition-colors"
                >
                  <Plus size={18} />
                </button>
              </div>
            </div>
          </div>

          {/* Action Button */}
          <button 
            onClick={initiateScan}
            disabled={!file || isScanning}
            className="mt-auto group relative w-full py-4 bg-gradient-to-r from-[#00d4ff] to-[#0099cc] rounded-xl overflow-hidden transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-40 disabled:grayscale disabled:scale-100 shadow-[0_0_30px_rgba(0,212,255,0.2)] hover:shadow-[0_0_40px_rgba(0,212,255,0.4)]"
          >
            <div className="absolute inset-0 bg-white/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            <span className="relative font-['Orbitron'] font-bold text-sm tracking-[2px] text-[#050a12] flex items-center justify-center gap-2">
              {isScanning ? <Loader2 className="animate-spin" size={18} /> : '⟨ INITIATE SCAN ⟩'}
            </span>
          </button>
        </aside>

        {/* RIGHT PANEL */}
        <main className="right-panel p-10 overflow-y-auto custom-scrollbar">
          <div className="flex items-center justify-between mb-10">
            <h2 className="font-['Orbitron'] text-sm text-[#5a7a99] tracking-[2px] uppercase">Word Slots</h2>
            <div className="flex items-center gap-3 font-['JetBrains_Mono'] text-[11px] text-[#5a7a99]">
              <motion.div 
                animate={status === 'SCANNING' ? { opacity: [1, 0.3, 1] } : {}}
                transition={{ repeat: Infinity, duration: 1.5 }}
                className={`w-2 h-2 rounded-full ${status === 'SCAN COMPLETE' ? 'bg-[#00ff9d] shadow-[0_0_8px_#00ff9d]' : status === 'ERROR' ? 'bg-[#ff6b35]' : 'bg-[#5a7a99]'}`} 
              />
              {status}
            </div>
          </div>

          <div className="grid gap-4">
            <AnimatePresence mode="popLayout">
              {slots.map((slot, index) => (
                <motion.div 
                  key={slot.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ delay: index * 0.05 }}
                  className={`grid grid-cols-1 md:grid-cols-[160px_1fr_auto] border border-[#1a2e45] rounded-xl overflow-hidden bg-[#0c1520] transition-all duration-300 hover:border-[#00d4ff]/30 hover:shadow-[0_4px_20px_rgba(0,212,255,0.05)] ${slot.isChanging ? 'animate-pulse border-[#00d4ff]' : ''}`}
                >
                  {/* Left Col: Slot & POS */}
                  <div className="bg-[#111d2e] border-r border-[#1a2e45] p-6 flex flex-col items-center justify-center gap-2">
                    <span className="font-['Orbitron'] text-xl font-bold text-[#1a2e45]">{String(index + 1).padStart(2, '0')}</span>
                    <label className="font-['JetBrains_Mono'] text-[9px] text-[#5a7a99] uppercase tracking-wider">Part of Speech</label>
                    <select 
                      value={slot.pos}
                      onChange={(e) => updateSlotPos(index, e.target.value)}
                      className="w-full bg-[#050a12] border border-[#1a2e45] rounded-md px-2 py-1.5 text-[11px] text-[#00d4ff] font-['JetBrains_Mono'] outline-none cursor-pointer hover:border-[#00d4ff]/50 transition-colors"
                    >
                      {POS_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                    </select>
                  </div>

                  {/* Center Col: Content */}
                  <div className="p-6 flex flex-col gap-2 min-w-0">
                    {slot.data ? (
                      <>
                        <div className="flex items-center gap-3">
                          <h3 className="font-['Orbitron'] text-xl font-bold text-[#00d4ff] tracking-wider drop-shadow-[0_0_10px_rgba(0,212,255,0.3)]">
                            {slot.data.word}
                          </h3>
                          <span className="px-2 py-0.5 bg-[#00ff9d]/10 border border-[#00ff9d]/30 rounded text-[10px] font-['JetBrains_Mono'] text-[#00ff9d]">
                            {slot.data.partOfSpeech}
                          </span>
                        </div>
                        <p className="text-sm text-[#5a7a99] leading-relaxed">{slot.data.definition}</p>
                        <p className="text-xs text-[#00d4ff]/60 italic border-l-2 border-[#00d4ff]/20 pl-4 mt-1">
                          "{slot.data.example}"
                        </p>
                      </>
                    ) : (
                      <div className="h-full flex items-center text-[#1a2e45] font-['Orbitron'] text-sm tracking-[2px]">
                        — AWAITING SCAN —
                      </div>
                    )}
                  </div>

                  {/* Right Col: Change */}
                  <div className="flex items-center justify-center p-6 border-l border-[#1a2e45]">
                    <button 
                      onClick={() => changeWord(index)}
                      disabled={!slot.data || slot.isChanging}
                      className="flex items-center gap-2 px-4 py-2 border border-[#1a2e45] rounded-lg text-[11px] font-['JetBrains_Mono'] text-[#5a7a99] hover:border-[#ff6b35] hover:text-[#ff6b35] hover:shadow-[0_0_12px_rgba(255,107,53,0.2)] transition-all disabled:opacity-20 disabled:cursor-not-allowed group"
                    >
                      <RefreshCw size={14} className={`group-hover:rotate-180 transition-transform duration-500 ${slot.isChanging ? 'animate-spin' : ''}`} />
                      CHANGE
                    </button>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </main>
      </div>

      {/* Loading Overlay */}
      <AnimatePresence>
        {isScanning && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-[#050a12]/80 backdrop-blur-sm flex flex-col items-center justify-center gap-6"
          >
            <div className="relative">
              <div className="w-20 h-20 border-2 border-[#1a2e45] rounded-full" />
              <div className="absolute inset-0 w-20 h-20 border-t-2 border-[#00d4ff] rounded-full animate-spin" />
            </div>
            <div className="text-center space-y-2">
              <p className="font-['JetBrains_Mono'] text-sm text-[#00d4ff] tracking-[3px] animate-pulse uppercase">Scanning Document...</p>
              <p className="text-[10px] text-[#5a7a99] uppercase tracking-widest">Neural Analysis in Progress</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error Toast */}
      <AnimatePresence>
        {error && <Toast message={error} onClose={() => setError(null)} />}
      </AnimatePresence>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #1a2e45;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #00d4ff;
        }
      `}</style>
    </div>
  );
};

export default App;


