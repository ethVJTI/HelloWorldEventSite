import React, { useEffect } from 'react';
import BlockchainBackgroundAccents from '../BlockchainBackgroundAccents';

export default function PageNullView() {
  // Purge all participant tokens & credentials on mount
  useEffect(() => {
    // 1. Wipe document cookies
    try {
      document.cookie.split(";").forEach((c) => {
        document.cookie = c
          .replace(/^ +/, "")
          .replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
      });
    } catch (_) {}

    // 2. Wipe sessionStorage
    try {
      sessionStorage.clear();
    } catch (_) {}

    // 3. Clear participant authentication, quiz credentials, and view state
    try {
      localStorage.removeItem('pow_miner');
      localStorage.removeItem('pow_current_round');
      localStorage.removeItem('pow_quiz_index');
      localStorage.removeItem('pow_quiz_time');
      localStorage.removeItem('pow_view');
    } catch (_) {}
  }, []);

  const handleReturnHome = () => {
    try {
      localStorage.removeItem('pow_view');
      localStorage.removeItem('pow_miner');
      localStorage.removeItem('pow_current_round');
      localStorage.removeItem('pow_quiz_index');
      localStorage.removeItem('pow_quiz_time');
      sessionStorage.clear();
    } catch (_) {}
    window.location.href = '/';
  };

  return (
    <div className="relative min-h-screen bg-slate-950 text-slate-100 font-sans overflow-hidden flex flex-col justify-between selection:bg-purple-500/30">
      
      {/* Cyber Grid Background */}
      <div className="absolute inset-0 cyber-grid-bg z-0 opacity-50"></div>

      {/* Ambient Glow */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[60vw] h-[60vw] rounded-full bg-purple-950/25 blur-[140px]"></div>
      </div>

      <BlockchainBackgroundAccents />

      {/* Main Null Display */}
      <main className="relative z-10 flex flex-col items-center justify-center flex-grow px-6 text-center select-none py-12 my-auto animate-fade-in">
        
        {/* Terminal / Null Monogram */}
        <div className="relative mb-6">
          <div className="w-24 h-24 rounded-full bg-slate-900/80 border-2 border-purple-500/40 flex items-center justify-center shadow-[0_0_35px_rgba(168,85,247,0.3)]">
            <span className="font-mono text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-tr from-purple-400 to-fuchsia-300">
              Ø
            </span>
          </div>
          <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-red-500 border-2 border-slate-950"></span>
        </div>

        {/* Status Pill */}
        <div className="font-mono text-[11px] tracking-widest uppercase bg-purple-950/60 border border-purple-700/40 px-3.5 py-1 rounded-full text-purple-300 mb-4 shadow-inner">
          [ SYSTEM STATUS: NULL ]
        </div>

        <h1 className="text-3xl md:text-4xl font-black text-white mb-3 tracking-tight">
          Session Terminated
        </h1>

        <p className="text-purple-200/70 font-mono text-sm max-w-md mb-8 leading-relaxed">
          Consensus has been verified for this block. Your node has safely decoupled from the mining pool and credentials have been purged.
        </p>

        {/* State Telemetry Card */}
        <div className="w-full max-w-sm bg-slate-900/70 border border-purple-900/40 rounded-2xl p-5 backdrop-blur-md text-left font-mono text-xs flex flex-col gap-2.5 shadow-xl">
          <div className="flex justify-between items-center text-purple-300/80">
            <span>NODE STATUS</span>
            <span className="text-red-400 font-semibold">LOGGED OUT</span>
          </div>
          <div className="h-px bg-white/5 w-full"></div>
          <div className="flex justify-between items-center text-purple-300/80">
            <span>SESSION CACHE</span>
            <span className="text-emerald-400 font-semibold">CLEARED (0x0)</span>
          </div>
          <div className="h-px bg-white/5 w-full"></div>
          <div className="flex justify-between items-center text-purple-300/80">
            <span>RE-ENTRY POLICY</span>
            <span className="text-amber-400 font-semibold">1 ATTEMPT / CANDIDATE</span>
          </div>
        </div>

        {/* Reconnect / Return Home Button */}
        <button
          onClick={handleReturnHome}
          className="mt-6 px-6 py-2.5 rounded-xl bg-purple-900/40 hover:bg-purple-800/60 border border-purple-500/40 text-purple-200 font-mono text-xs transition-all cursor-pointer shadow-lg hover:shadow-purple-500/20 active:scale-95"
        >
          [ RECONNECT / RETURN TO HOME ]
        </button>

        <p className="mt-6 text-purple-400/50 font-mono text-xs max-w-xs leading-relaxed">
          Event rankings and winner distributions are projected on the main auditorium screen.
        </p>

      </main>

      {/* Terminal Footer */}
      <footer className="relative z-10 w-full py-4 text-center font-mono text-[11px] text-purple-400/30 border-t border-purple-900/20">
        PoW Pool • Consensus Decoupled • Terminal Session Closed
      </footer>

    </div>
  );
}
