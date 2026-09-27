import React, { useState, useEffect } from 'react';
import { useMempool } from './hooks/useMempool';
import { getDefaultPool, startNewRound, updatePoolMaxMiners, abortActiveRound } from './utils/api';

// Configurable admin passcode (or fallback secure workshop passcode)
const EXPECTED_PASSCODE = import.meta.env.VITE_ADMIN_PASSCODE || 'ethVJTI@2026';

export default function Admin() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    return sessionStorage.getItem('pow_admin_authenticated') === 'true';
  });
  const [passcodeInput, setPasscodeInput] = useState('');
  const [authError, setAuthError] = useState(null);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [isLockedOut, setIsLockedOut] = useState(false);

  // Initialize mempool hook only when authenticated to prevent unauthorized presence monitoring
  const { miners, channel, updateAdminConfig } = useMempool(null, null, isAuthenticated);
  const [maxMiners, setMaxMiners] = useState(10);
  const [broadcasting, setBroadcasting] = useState(false);
  const [pool, setPool] = useState(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [actionMessage, setActionMessage] = useState(null);

  useEffect(() => {
    if (isAuthenticated) {
      getDefaultPool().then(p => {
        setPool(p);
        if (p?.max_miners) {
          setMaxMiners(p.max_miners);
          if (updateAdminConfig) updateAdminConfig({ maxMiners: p.max_miners });
        }
      }).catch(console.error);
    }
  }, [isAuthenticated]);

  const handleLogin = (e) => {
    e.preventDefault();
    if (isLockedOut) return;

    if (passcodeInput === EXPECTED_PASSCODE) {
      sessionStorage.setItem('pow_admin_authenticated', 'true');
      setIsAuthenticated(true);
      setAuthError(null);
      setFailedAttempts(0);
    } else {
      const nextFailed = failedAttempts + 1;
      setFailedAttempts(nextFailed);
      if (nextFailed >= 5) {
        setIsLockedOut(true);
        setAuthError("Too many failed attempts. Locked out for 30 seconds.");
        setTimeout(() => {
          setIsLockedOut(false);
          setFailedAttempts(0);
          setAuthError(null);
        }, 30000);
      } else {
        setAuthError(`Invalid passcode. Attempts remaining: ${5 - nextFailed}`);
      }
    }
  };

  const handleLogout = () => {
    sessionStorage.removeItem('pow_admin_authenticated');
    setIsAuthenticated(false);
    setPasscodeInput('');
  };

  const handleSetMaxMiners = async () => {
    if (!pool) return;
    setIsUpdating(true);
    try {
      await updatePoolMaxMiners(pool.id, Number(maxMiners));
      if (updateAdminConfig) {
        updateAdminConfig({ maxMiners: Number(maxMiners) });
      }
      setActionMessage('Max miners saved to database & network updated!');
      setTimeout(() => setActionMessage(null), 3000);
    } catch (err) {
      console.error(err);
      alert('Failed to update max miners: ' + err.message);
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

      setActionMessage(`Block #${round.block_index} broadcasted to all miners!`);
      setTimeout(() => setActionMessage(null), 4000);
    } catch (err) {
      console.error("Failed to start round:", err);
      alert("Error starting round: " + err.message);
    } finally {
      setBroadcasting(false);
    }
  };

  const handleAbortRound = async () => {
    if (!pool) return;
    if (!window.confirm("Are you sure you want to abort the current round?")) return;

    try {
      await abortActiveRound(pool.id);
      if (channel) {
        await channel.send({
          type: 'broadcast',
          event: 'ABORT_ROUND',
          payload: { timestamp: Date.now() }
        });
      }
      setActionMessage("Active round has been aborted.");
      setTimeout(() => setActionMessage(null), 3000);
    } catch (err) {
      console.error("Failed to abort round:", err);
      alert("Error aborting round: " + err.message);
    }
  };

  // 1. Authentication Gate: If unauthenticated, show passcode modal
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 font-sans flex items-center justify-center p-6 selection:bg-purple-500/30">
        <div className="absolute inset-0 cyber-grid-bg z-0 opacity-40 pointer-events-none"></div>

        <div className="relative z-10 w-full max-w-md bg-slate-900/80 border border-purple-800/50 p-8 rounded-3xl backdrop-blur-xl shadow-2xl animate-fade-in">
          <div className="flex flex-col items-center mb-6 text-center">
            <div className="w-16 h-16 rounded-2xl bg-purple-950/80 border border-purple-500/40 flex items-center justify-center text-2xl shadow-inner mb-3">
              🔒
            </div>
            <h2 className="text-2xl font-black text-white">Admin Authentication</h2>
            <p className="text-purple-300/60 font-mono text-xs mt-1">Proof-of-Work Supervisor Console</p>
          </div>

          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            <div>
              <label className="block text-xs font-mono text-purple-300 uppercase tracking-widest mb-1.5">
                Supervisor Passcode
              </label>
              <input
                type="password"
                placeholder="Enter secret passcode..."
                value={passcodeInput}
                onChange={(e) => setPasscodeInput(e.target.value)}
                disabled={isLockedOut}
                className="w-full bg-slate-950 border border-purple-700/50 rounded-xl px-4 py-3 text-white placeholder-slate-600 focus:outline-none focus:border-purple-400 font-mono text-sm shadow-inner"
              />
            </div>

            {authError && (
              <div className="text-xs font-mono text-red-400 bg-red-950/50 border border-red-500/40 p-2.5 rounded-xl text-center">
                {authError}
              </div>
            )}

            <button
              type="submit"
              disabled={isLockedOut || !passcodeInput.trim()}
              className="w-full py-3 bg-gradient-to-r from-purple-700 to-fuchsia-600 hover:from-purple-600 hover:to-fuchsia-500 text-white font-bold rounded-xl transition-all shadow-[0_0_20px_rgba(168,85,247,0.3)] disabled:opacity-50 cursor-pointer text-sm"
            >
              {isLockedOut ? 'LOCKED OUT' : '[ AUTHENTICATE ]'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // 2. Authenticated Admin Dashboard
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
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-slate-900/80 px-4 py-2 rounded-xl border border-purple-500/20">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-fuchsia-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-fuchsia-500"></span>
              </span>
              <span className="text-xs font-semibold tracking-wider text-purple-200">NETWORK LIVE</span>
            </div>
            <button
              onClick={handleLogout}
              className="px-3 py-2 bg-red-950/60 hover:bg-red-900/80 border border-red-500/40 text-red-300 rounded-xl font-mono text-xs transition-colors cursor-pointer"
            >
              [ LOGOUT ]
            </button>
          </div>
        </header>

        {actionMessage && (
          <div className="mb-6 p-4 rounded-xl bg-purple-900/40 border border-purple-500/50 text-purple-200 text-sm font-semibold text-center animate-fade-in">
            {actionMessage}
          </div>
        )}

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
                  {isUpdating ? 'Saving...' : 'Set'}
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-purple-900/30 text-purple-400 font-mono text-sm">
                    <th className="pb-3">Node Name</th>
                    <th className="pb-3">Registration No</th>
                    <th className="pb-3">Joined At</th>
                    <th className="pb-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-purple-900/20 text-sm">
                  {miners.length === 0 ? (
                    <tr>
                      <td colSpan="4" className="py-6 text-center text-purple-400/50 italic">
                        No miners connected to the mempool yet.
                      </td>
                    </tr>
                  ) : (
                    miners.map((m, idx) => (
                      <tr key={m.regNo || m.id || idx} className="hover:bg-purple-900/10 transition-colors">
                        <td className="py-3 font-medium text-white flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                          {m.name}
                        </td>
                        <td className="py-3 font-mono text-purple-300">{m.regNo}</td>
                        <td className="py-3 text-purple-400 text-xs">
                          {m.joinedAt ? new Date(m.joinedAt).toLocaleTimeString() : 'Just now'}
                        </td>
                        <td className="py-3">
                          <span className="bg-emerald-950 border border-emerald-500/30 text-emerald-400 text-xs px-2 py-0.5 rounded-full font-mono">
                            Ready
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex flex-col gap-6">
            <div className="bg-slate-900/50 rounded-2xl border border-purple-900/30 p-6 backdrop-blur-sm">
              <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                <span className="text-2xl">⚡</span> Round Control
              </h2>
              
              <p className="text-sm text-purple-200/70 mb-6 leading-relaxed">
                Starting the round broadcasts transaction payload to all connected nodes and transitions them to the Proof of Work solving screen simultaneously.
              </p>

              <button
                onClick={handleBroadcast}
                disabled={broadcasting}
                className="w-full py-4 rounded-xl bg-gradient-to-r from-fuchsia-600 to-purple-600 hover:from-fuchsia-500 hover:to-purple-500 text-white font-black tracking-wide transition-all shadow-[0_0_20px_rgba(217,70,239,0.3)] hover:shadow-[0_0_30px_rgba(217,70,239,0.5)] transform hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50 disabled:cursor-not-allowed text-base cursor-pointer"
              >
                {broadcasting ? 'BROADCASTING...' : 'START ROUND (BROADCAST)'}
              </button>

              <button
                onClick={handleAbortRound}
                className="w-full mt-3 py-2.5 rounded-xl bg-red-950/40 hover:bg-red-900/60 border border-red-500/30 text-red-300 font-mono text-xs transition-all cursor-pointer"
              >
                [ ABORT CURRENT ROUND ]
              </button>
            </div>

            <div className="bg-slate-900/50 rounded-2xl border border-purple-900/30 p-6 backdrop-blur-sm">
              <h3 className="text-lg font-bold text-white mb-2">Display Projector Link</h3>
              <p className="text-sm text-purple-200/70 mb-4">
                Open this URL on the main projector screen in full screen:
              </p>
              <div className="bg-slate-950 p-3 rounded-lg border border-purple-900/50 font-mono text-xs text-purple-300 break-all select-all flex justify-between items-center">
                <span>{window.location.origin}/display</span>
                <a 
                  href="/display" 
                  target="_blank" 
                  rel="noreferrer"
                  className="ml-2 text-fuchsia-400 hover:underline"
                >
                  Open &rarr;
                </a>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
