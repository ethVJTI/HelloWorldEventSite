import React, { useState, useEffect } from 'react';
import { useMempool } from './hooks/useMempool';
import { getDefaultPool, startNewRound, updatePoolMaxMiners } from './utils/api';

export default function Admin() {
  const { miners, channel, updateAdminConfig } = useMempool(null, null, true); // true = isAdmin
  const [maxMiners, setMaxMiners] = useState(10);
  const [broadcasting, setBroadcasting] = useState(false);
  const [pool, setPool] = useState(null);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    getDefaultPool().then(p => {
      setPool(p);
      if (p.max_miners) {
        setMaxMiners(p.max_miners);
        if (updateAdminConfig) updateAdminConfig({ maxMiners: p.max_miners });
      }
    }).catch(console.error);
  }, []);

  const handleSetMaxMiners = async () => {
    if (!pool) return;
    setIsUpdating(true);
    try {
      await updatePoolMaxMiners(pool.id, Number(maxMiners));
      // Still broadcast it over socket for instant UI updates for currently connected clients
      if (updateAdminConfig) {
        updateAdminConfig({ maxMiners: Number(maxMiners) });
      }
      alert('Max miners updated in database!');
    } catch (err) {
      console.error(err);
      alert('Failed to update max miners. Did you add the max_miners column to the pools table?');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleBroadcast = async () => {
    if (!channel || !pool) return;
    setBroadcasting(true);
    
    try {
      const round = await startNewRound(pool.id);

      await channel.send({
        type: 'broadcast',
        event: 'START_QUIZ',
        payload: { 
          timestamp: Date.now(),
          round_id: round.id,
          block_index: round.block_index
        },
      });
    } catch (err) {
      console.error("Failed to start round:", err);
      alert("Error starting round. Check console.");
    }
    
    setTimeout(() => {
      setBroadcasting(false);
    }, 2000);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans p-8">
      <div className="absolute inset-0 cyber-grid-bg z-0 opacity-20 pointer-events-none"></div>

      <div className="relative z-10 max-w-6xl mx-auto">
        <header className="flex justify-between items-end mb-10 border-b border-purple-900/50 pb-6">
          <div>
            <h1 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-fuchsia-400">
              Admin Control Panel
            </h1>
            <p className="text-purple-300/60 mt-1 font-mono text-sm">PoW Pool Network Supervisor</p>
          </div>
          <div className="flex items-center gap-4 bg-slate-900/80 px-4 py-2 rounded-xl border border-purple-500/20">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-fuchsia-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-fuchsia-500"></span>
            </span>
            <span className="text-sm font-semibold tracking-wider text-purple-200">NETWORK LIVE</span>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          <div className="col-span-1 lg:col-span-2 bg-slate-900/50 rounded-2xl border border-purple-900/30 p-6 backdrop-blur-sm">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <span className="text-2xl">🔌</span> Mempool Monitor
              </h2>
              <div className="bg-purple-950/50 text-purple-300 py-1 px-3 rounded-lg text-sm font-mono border border-purple-800/50">
                Connected: {miners.length} / {maxMiners}
              </div>
            </div>

            <div className="mb-6 flex gap-4 items-center bg-slate-950/50 p-4 rounded-xl border border-white/5">
              <label className="text-sm text-purple-200/70 uppercase font-semibold">Max Miners for Next Round:</label>
              <div className="flex gap-2">
                <input 
                  type="number" 
                  value={maxMiners}
                  onChange={(e) => setMaxMiners(e.target.value)}
                  className="bg-slate-900 border border-purple-700/50 rounded-lg px-3 py-1 w-24 text-white text-center focus:outline-none focus:border-fuchsia-500"
                />
                <button 
                  onClick={handleSetMaxMiners}
                  disabled={isUpdating}
                  className="bg-fuchsia-700 hover:bg-fuchsia-600 text-white px-4 py-1 rounded-lg font-bold text-sm transition-colors border border-fuchsia-500 disabled:opacity-50"
                >
                  {isUpdating ? 'SAVING...' : 'SET'}
                </button>
              </div>
            </div>

            <div className="bg-slate-950/80 rounded-xl border border-white/5 overflow-hidden h-[400px] flex flex-col">
              <div className="grid grid-cols-4 gap-4 p-4 border-b border-purple-900/30 bg-purple-900/10 text-xs uppercase tracking-wider text-purple-300 font-semibold">
                <div className="col-span-2">Miner Name</div>
                <div>Reg No</div>
                <div className="text-right">Action</div>
              </div>
              <div className="overflow-y-auto p-2 flex-grow custom-scrollbar">
                {miners.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-purple-300/30 italic">
                    No miners currently in the pool.
                  </div>
                ) : (
                  miners.map((m, i) => (
                    <div key={m.regNo || i} className="grid grid-cols-4 gap-4 p-3 items-center hover:bg-white/5 rounded-lg transition-colors border-b border-white/5 last:border-0">
                      <div className="col-span-2 font-medium text-purple-100 truncate">{m.name}</div>
                      <div className="font-mono text-xs text-purple-300/60">{m.regNo}</div>
                      <div className="text-right">
                        <button className="text-xs bg-red-900/20 hover:bg-red-900/40 text-red-400 px-3 py-1 rounded border border-red-900/50 transition-colors">
                          KICK
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="col-span-1 flex flex-col gap-6">
            
            <div className="bg-slate-900/50 rounded-2xl border border-fuchsia-900/50 p-6 backdrop-blur-sm flex flex-col items-center justify-center text-center">
              <h2 className="text-lg font-bold text-white mb-2">Network Control</h2>
              <p className="text-sm text-purple-200/60 mb-8">Broadcast the next block to all connected nodes to begin the mining race.</p>
              
              <button 
                onClick={handleBroadcast}
                disabled={broadcasting || miners.length === 0}
                className={`w-full py-8 rounded-2xl font-black text-xl tracking-widest transition-all duration-300 border-2 ${
                  broadcasting 
                    ? 'bg-fuchsia-600 border-fuchsia-400 text-white shadow-[0_0_40px_rgba(217,70,239,0.8)] scale-95' 
                    : miners.length === 0 
                      ? 'bg-slate-800 border-slate-700 text-slate-500 cursor-not-allowed'
                      : 'bg-gradient-to-br from-fuchsia-600 to-purple-600 border-fuchsia-400 text-white shadow-[0_0_30px_rgba(217,70,239,0.5)] hover:shadow-[0_0_50px_rgba(217,70,239,0.8)] hover:scale-105'
                }`}
              >
                {broadcasting ? 'BROADCASTING...' : 'BROADCAST BLOCK'}
              </button>
            </div>

            <div className="bg-slate-900/50 rounded-2xl border border-red-900/30 p-6 backdrop-blur-sm">
              <h2 className="text-sm font-bold text-red-400 mb-4 uppercase tracking-wider">Emergency Stops</h2>
              <div className="flex flex-col gap-3">
                <button className="w-full py-3 bg-red-950/40 hover:bg-red-900/60 border border-red-900/50 text-red-300 rounded-xl text-sm font-semibold transition-colors">
                  ABORT ROUND
                </button>
                <button className="w-full py-3 bg-red-950/40 hover:bg-red-900/60 border border-red-900/50 text-red-300 rounded-xl text-sm font-semibold transition-colors">
                  RESET LEADERBOARD
                </button>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
