import React from 'react';

export default function Mempool({ minerData, miners = [], poolConfig = { maxMiners: 10 } }) {
  const maxMiners = poolConfig?.maxMiners || 10;
  const currentCount = miners.length;

  return (
    <div className="relative z-10 flex flex-col items-center justify-center flex-grow px-6 w-full max-w-lg mx-auto min-h-screen pb-20">
      
      {/* Pulsing Network Node / Orb */}
      <div className="relative flex items-center justify-center mb-12 mt-8">
        <div className="absolute w-32 h-32 rounded-full bg-purple-600/20 blur-xl animate-pulse-slow"></div>
        <div className="absolute w-24 h-24 rounded-full bg-fuchsia-500/30 blur-md animate-ping" style={{ animationDuration: '3s' }}></div>
        <div className="relative w-16 h-16 rounded-full bg-gradient-to-tr from-purple-700 to-fuchsia-400 border-2 border-white/20 shadow-[0_0_30px_rgba(217,70,239,0.8)] flex items-center justify-center z-10">
          <span className="text-white text-2xl">⚡</span>
        </div>
      </div>

      <header className="flex flex-col items-center mb-8 text-center animate-fade-in-up">
        <h2 className="text-3xl font-extrabold tracking-tight text-white mb-2">
          The Mempool
        </h2>
        <p className="text-purple-200/70 text-sm max-w-[250px]">
          Waiting for the network to reach consensus on the next block...
        </p>
      </header>

      {/* Live Counter & Roster */}
      <div className="w-full bg-slate-900/60 p-6 rounded-3xl border border-purple-900/50 backdrop-blur-md shadow-2xl animate-fade-in-up" style={{ animationDelay: '200ms' }}>
        
        <div className="flex justify-between items-center mb-4 border-b border-purple-900/50 pb-4">
          <span className="text-purple-300 font-semibold tracking-wide uppercase text-sm">Active Nodes</span>
          <span className="bg-purple-900/50 text-fuchsia-300 py-1 px-3 rounded-full text-sm font-bold font-mono shadow-inner border border-purple-700/50">
            {currentCount} / {maxMiners}
          </span>
        </div>

        {/* List of miners */}
        <ul className="flex flex-col gap-3 max-h-[40vh] overflow-y-auto pr-2 custom-scrollbar">
          {miners.map((m, index) => (
            <li key={m.regNo || m.id || index} className="flex items-center gap-3 bg-slate-950/50 p-3 rounded-xl border border-white/5 transition-all animate-fade-in">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-800 to-fuchsia-900 flex items-center justify-center text-sm font-bold text-white border border-purple-500/30 shadow-inner">
                {m.name?.charAt(0).toUpperCase()}
              </div>
              <div className="flex flex-col">
                <span className="text-white text-sm font-medium">{m.name}</span>
                <span className="text-purple-400/50 text-xs font-mono">{m.regNo}</span>
              </div>
              {m.regNo === (minerData?.registration_number || minerData?.regNo) && (
                <span className="ml-auto text-[10px] uppercase tracking-widest text-fuchsia-400 bg-fuchsia-900/30 px-2 py-1 rounded-md border border-fuchsia-500/20">You</span>
              )}
            </li>
          ))}
          {currentCount === 0 && (
             <li className="text-center text-purple-200/40 text-sm py-4 italic animate-pulse">Initializing local node...</li>
          )}
        </ul>

      </div>

    </div>
  );
}
