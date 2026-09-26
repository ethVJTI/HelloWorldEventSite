import React, { useState, useEffect } from 'react';
import { getDefaultPool, registerMiner } from './utils/api';
import { useMempool } from './hooks/useMempool';

export default function Signup({ onConnect }) {
  const [mounted, setMounted] = useState(false);
  const [name, setName] = useState('');
  const [regNo, setRegNo] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Passively listen to mempool to check if it's full
  const { miners, poolConfig } = useMempool(null, null, false, true); // isPassive = true
  
  const currentCount = miners.length;
  const maxMiners = poolConfig.maxMiners || 10;
  const isPoolFull = currentCount >= maxMiners;

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim() || !regNo.trim()) return;
    
    if (isPoolFull) {
      setError("The Mempool is currently full. Please wait for the next block.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      // 1. Get the active pool
      const pool = await getDefaultPool();
      
      // 2. Register the miner (or fetch existing session)
      const miner = await registerMiner(pool.id, name.trim(), regNo.trim());
      
      // 3. Pass the full miner data up to App state
      if (onConnect) onConnect(miner);
    } catch (err) {
      console.error(err);
      setError("Failed to connect to the network. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative z-10 flex flex-col items-center justify-center flex-grow px-6 w-full max-w-md mx-auto min-h-screen pb-20">
      
      {/* Header */}
      <header className={`flex flex-col items-center mb-10 opacity-0 ${mounted ? 'animate-fade-in-up' : ''}`} style={{ animationDelay: '100ms' }}>
        <div className="w-20 h-20 rounded-full bg-purple-900/30 flex items-center justify-center mb-6 border-2 border-purple-500/50 shadow-[0_0_15px_rgba(168,85,247,0.5)]">
          <span className="text-3xl">🔌</span>
        </div>
        <h2 className="text-3xl font-extrabold tracking-tight text-white mb-2 text-center">
          Join the Network
        </h2>
        <p className="text-purple-200/70 text-center text-sm">
          Authenticate your miner node to enter the mempool.
        </p>
      </header>

      {/* Form */}
      <form 
        onSubmit={handleSubmit}
        className={`w-full flex flex-col gap-6 bg-slate-900/60 p-8 rounded-3xl border border-purple-900/50 backdrop-blur-md shadow-2xl opacity-0 ${mounted ? 'animate-fade-in-up' : ''}`} 
        style={{ animationDelay: '300ms' }}
      >
        
        <div className="flex flex-col gap-2">
          <label htmlFor="name" className="text-sm font-semibold text-purple-300 ml-1 uppercase tracking-wider">
            Miner Name
          </label>
          <input 
            type="text" 
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Satoshi Nakamoto" 
            className="w-full bg-slate-950/80 border border-purple-800/50 rounded-xl px-4 py-3 text-white placeholder-purple-200/30 focus:outline-none focus:border-purple-400 focus:ring-1 focus:ring-purple-400 transition-all"
            required
            disabled={loading || isPoolFull}
          />
          <p className="text-xs text-purple-200/40 ml-1">How you'll appear on the blockchain.</p>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="regNo" className="text-sm font-semibold text-purple-300 ml-1 uppercase tracking-wider">
            Registration Number
          </label>
          <input 
            type="text" 
            id="regNo"
            value={regNo}
            onChange={(e) => setRegNo(e.target.value)}
            placeholder="e.g. 2310700XX" 
            className="w-full bg-slate-950/80 border border-purple-800/50 rounded-xl px-4 py-3 text-white placeholder-purple-200/30 focus:outline-none focus:border-fuchsia-400 focus:ring-1 focus:ring-fuchsia-400 transition-all"
            required
            disabled={loading || isPoolFull}
          />
          <p className="text-xs text-purple-200/40 ml-1">Used for unique verification.</p>
        </div>

        {isPoolFull && (
          <div className="text-red-400 text-sm text-center bg-red-900/20 p-3 rounded-lg border border-red-900/50 font-semibold animate-pulse">
            🚨 POOL IS CURRENTLY FULL ({currentCount}/{maxMiners}) 🚨
            <br/><span className="text-xs font-normal">Wait for the admin to start the next round or increase capacity.</span>
          </div>
        )}

        {error && !isPoolFull && (
          <div className="text-red-400 text-sm text-center bg-red-900/20 p-2 rounded-lg border border-red-900/50">
            {error}
          </div>
        )}

        <button 
          type="submit"
          disabled={loading || isPoolFull}
          className={`w-full mt-4 py-4 rounded-xl font-bold tracking-wide transition-all duration-300 border flex justify-center items-center gap-2 ${
            isPoolFull 
              ? 'bg-slate-800 text-slate-500 border-slate-700 cursor-not-allowed' 
              : 'bg-gradient-to-r from-purple-700 to-purple-500 hover:from-purple-600 hover:to-purple-400 text-white shadow-[0_0_15px_rgba(168,85,247,0.4)] hover:shadow-[0_0_25px_rgba(168,85,247,0.6)] transform hover:-translate-y-1 border-purple-400/50 disabled:opacity-50 disabled:cursor-not-allowed'
          }`}
        >
          {loading ? 'CONNECTING...' : isPoolFull ? 'POOL AT CAPACITY' : '[ CONNECT NODE ]'}
        </button>

      </form>

    </div>
  );
}
