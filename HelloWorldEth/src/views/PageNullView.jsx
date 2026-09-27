import React, { useState, useEffect } from 'react';
import BlockchainBackgroundAccents from '../BlockchainBackgroundAccents';

export default function PageNullView() {
  const [winReceipt, setWinReceipt] = useState(() => {
    try {
      const saved = sessionStorage.getItem('pow_win_receipt');
      return saved ? JSON.parse(saved) : null;
    } catch (_) {
      return null;
    }
  });

  // Purge participant tokens & credentials on mount, while preserving winner claim receipt
  useEffect(() => {
    // 1. Wipe document cookies
    try {
      document.cookie.split(";").forEach((c) => {
        document.cookie = c
          .replace(/^ +/, "")
          .replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
      });
    } catch (_) {}

    // 2. Clear participant authentication, quiz credentials, and view state from localStorage
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

  // 1. WINNER VICTORY RECEIPT DISPLAY
  if (winReceipt?.isWinner) {
    const rawReg = winReceipt.regNo || 'WIN';
    const claimCode = `ETH-BLK${winReceipt.blockIndex || 1}-${rawReg.slice(-4).toUpperCase()}`;

    return (
      <div className="relative min-h-screen bg-slate-950 text-slate-100 font-sans overflow-hidden flex flex-col justify-between selection:bg-amber-500/30">
        
        {/* Cyber Grid Background */}
        <div className="absolute inset-0 cyber-grid-bg z-0 opacity-50"></div>

        {/* Golden Ambient Glow */}
        <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[70vw] h-[70vw] rounded-full bg-amber-500/15 blur-[160px]"></div>
          <div className="absolute bottom-10 right-10 w-[40vw] h-[40vw] rounded-full bg-yellow-500/10 blur-[140px]"></div>
        </div>

        <BlockchainBackgroundAccents />

        {/* Main Winner Display */}
        <main className="relative z-10 flex flex-col items-center justify-center flex-grow px-6 text-center select-none py-12 my-auto animate-fade-in max-w-lg mx-auto w-full">
          
          {/* Winner Trophy Monogram */}
          <div className="relative mb-6">
            <div className="w-24 h-24 rounded-full bg-gradient-to-tr from-amber-500/20 via-yellow-400/20 to-amber-600/30 border-2 border-amber-400/60 flex items-center justify-center shadow-[0_0_50px_rgba(245,158,11,0.5)] animate-pulse">
              <span className="text-5xl drop-shadow-[0_0_15px_rgba(245,158,11,0.8)]">
                🏆
              </span>
            </div>
            <span className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-emerald-500 border-2 border-slate-950 flex items-center justify-center text-xs text-black font-extrabold shadow-md">✓</span>
          </div>

          {/* Status Pill */}
          <div className="font-mono text-[11px] tracking-widest uppercase bg-amber-950/80 border border-amber-500/60 px-4 py-1 rounded-full text-amber-300 mb-4 shadow-[0_0_15px_rgba(245,158,11,0.3)]">
            [ SYSTEM STATUS: BLOCK #{winReceipt.blockIndex || 1} MINER • WINNER ]
          </div>

          <h1 className="text-3xl md:text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-300 via-yellow-100 to-white mb-2 tracking-tight">
            Proof of Work Champion
          </h1>

          <p className="text-amber-200/80 font-mono text-sm max-w-md mb-6 leading-relaxed">
            Consensus successfully reached and verified on the public ledger. Your node claimed the block.
          </p>

          {/* Golden Winner Receipt Card */}
          <div className="w-full bg-slate-900/90 border-2 border-amber-500/50 rounded-2xl p-5 backdrop-blur-xl text-left font-mono text-xs flex flex-col gap-3 shadow-[0_0_30px_rgba(245,158,11,0.2)]">
            <div className="flex justify-between items-center text-purple-300/80">
              <span className="text-amber-400/90 font-bold">RECEIPT ID</span>
              <span className="text-white font-bold bg-amber-950/60 px-2.5 py-0.5 rounded border border-amber-500/40 text-[11px] tracking-wider">{claimCode}</span>
            </div>
            <div className="h-px bg-white/10 w-full"></div>
            <div className="flex justify-between items-center text-purple-300/80">
              <span>WINNING MINER</span>
              <span className="text-white font-bold">{winReceipt.minerName}</span>
            </div>
            <div className="h-px bg-white/10 w-full"></div>
            <div className="flex justify-between items-center text-purple-300/80">
              <span>REGISTRATION NO</span>
              <span className="text-amber-300 font-bold">{winReceipt.regNo}</span>
            </div>
            <div className="h-px bg-white/10 w-full"></div>
            <div className="flex justify-between items-center text-purple-300/80">
              <span>SOLVE TIME</span>
              <span className="text-emerald-400 font-bold">{winReceipt.timeTaken}s</span>
            </div>
            <div className="h-px bg-white/10 w-full"></div>
            <div className="flex justify-between items-center text-purple-300/80">
              <span>BLOCK INDEX</span>
              <span className="text-amber-400 font-bold">BLOCK #{winReceipt.blockIndex || 1} (1st Place)</span>
            </div>
            <div className="h-px bg-white/10 w-full"></div>
            
            {/* Sticker Claim Banner */}
            <div className="mt-1 p-3 rounded-xl bg-gradient-to-r from-amber-500/20 via-yellow-500/10 to-transparent border border-amber-400/40 flex items-center gap-3">
              <span className="text-2xl flex-shrink-0">🎁</span>
              <div className="text-[11px] text-amber-200/90 leading-tight">
                <strong className="text-amber-300 block mb-0.5 uppercase tracking-wide">Prize Redemption</strong>
                Present this screen to the ethVJTI organizers at the stage to claim your exclusive sticker!
              </div>
            </div>
          </div>

          {/* Return Home Button */}
          <button
            onClick={handleReturnHome}
            className="mt-6 px-6 py-2.5 rounded-xl bg-amber-950/50 hover:bg-amber-900/60 border border-amber-500/40 text-amber-200 font-mono text-xs transition-all cursor-pointer shadow-lg hover:shadow-amber-500/20 active:scale-95"
          >
            [ FINISH & RETURN TO HOME ]
          </button>
        </main>

        {/* Terminal Footer */}
        <footer className="relative z-10 w-full py-4 text-center font-mono text-[11px] text-amber-400/40 border-t border-amber-900/30">
          ethVJTI PoW Pool • Verified Block Winner • Cryptographic Proof Intact
        </footer>

      </div>
    );
  }

  // 2. STANDARD DECOUPLED TERMINAL (NON-WINNERS)
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
