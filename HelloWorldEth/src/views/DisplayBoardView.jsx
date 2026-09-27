import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../utils/supabase';
import { getDefaultPool } from '../utils/api';

const CLIP_MAP = {
  idle: '/animations/idle_loop.mp4',
  broadcasting: '/animations/broadcasting.mp4',
  mining: '/animations/mining_loop.mp4',
  block_found: '/animations/block_found.mp4',
  chain_append: '/animations/chain_append.mp4',
};

// Fallback durations in ms if video metadata is not yet loaded
const FALLBACK_DURATIONS = {
  broadcasting: 4000,
  mining: 5500,
  block_found: 4500,
  chain_append: 3500,
};

export default function DisplayBoardView() {
  const [stage, setStage] = useState('idle'); // 'idle' | 'broadcasting' | 'mining' | 'block_found' | 'chain_append'
  const [stageData, setStageData] = useState({
    blockIndex: 1,
    winnerName: null,
    timeTaken: 0,
    minerProgress: {}, // miner_id / regNo -> { name, solved }
  });

  const [pool, setPool] = useState(null);
  const [miners, setMiners] = useState([]);
  const [blocks, setBlocks] = useState([]);
  const [videoAvailable, setVideoAvailable] = useState(false);
  const [elapsedTimer, setElapsedTimer] = useState(0);

  const videoRef = useRef(null);
  const stageRef = useRef('idle');
  const timerIntervalRef = useRef(null);
  const stageTimeoutRef = useRef(null);
  const pendingWinnerRef = useRef(null);
  const miningStartTimeRef = useRef(0);

  // Dynamically obtain actual video clip duration or fallback
  const getVideoDurationMs = (st) => {
    if (videoRef.current && !isNaN(videoRef.current.duration) && videoRef.current.duration > 0) {
      return Math.round(videoRef.current.duration * 1000);
    }
    return FALLBACK_DURATIONS[st] || 4500;
  };

  // 1. Initial Data Fetch (Active pool, registered eligible miners, and mined blocks)
  useEffect(() => {
    getDefaultPool().then(async (poolData) => {
      setPool(poolData);
      if (poolData) {
        try {
          const { data: finished } = await supabase
            .from('miner_round_progress')
            .select('miner_id')
            .not('finished_at', 'is', null);

          const finishedIds = new Set((finished || []).map(f => f.miner_id));

          const { data: dbMiners } = await supabase
            .from('miners')
            .select('id, name, registration_number')
            .eq('pool_id', poolData.id)
            .order('created_at', { ascending: false })
            .limit(poolData.max_miners || 50);

          if (dbMiners && dbMiners.length > 0) {
            const eligible = dbMiners
              .filter(m => !finishedIds.has(m.id))
              .map(m => ({ id: m.id, name: m.name, regNo: m.registration_number }));
            if (eligible.length > 0) {
              setMiners(eligible);
            }
          }
        } catch (err) {
          console.warn("Could not fetch miners for display board:", err);
        }
      }
    }).catch(console.error);

    supabase
      .from('blocks')
      .select(`
        id,
        block_index,
        mined_at,
        time_taken_ms,
        display_hash,
        miners ( name, registration_number )
      `)
      .order('block_index', { ascending: true })
      .then(({ data }) => {
        if (data) setBlocks(data);
      });
  }, []);

  // 2. Realtime WebSocket Listener with Loop Synchronization
  useEffect(() => {
    const existing = supabase.getChannels().find(ch => ch.topic === 'realtime:pow_mempool');
    if (existing) {
      supabase.removeChannel(existing);
    }

    const channel = supabase.channel('pow_mempool', {
      config: { presence: { key: 'projector_display' } },
    });

    channel
      // Presence: Authoritative live list of currently connected miners
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        const active = Object.values(state)
          .map((u) => u[0])
          .filter((m) => m.role !== 'admin' && m.name && m.role !== 'display' && m.regNo);
        
        const map = new Map();
        active.forEach(m => map.set(m.regNo || m.id, {
          id: m.id,
          name: m.name,
          regNo: m.regNo
        }));

        setMiners(Array.from(map.values()));
      })
      // Instant Broadcast when ANY student joins the pool (<50ms across all devices)
      .on('broadcast', { event: 'MINER_JOINED' }, (payload) => {
        const m = payload.payload;
        if (m && m.name && (m.regNo || m.registration_number)) {
          const key = m.regNo || m.registration_number;
          setMiners((prev) => {
            if (prev.some(item => (item.regNo || item.registration_number) === key)) {
              return prev;
            }
            return [{ id: m.id, name: m.name, regNo: key }, ...prev];
          });
        }
      })
      // Broadcast: Admin started a round -> Verify in DB before going to 'broadcasting'
      .on('broadcast', { event: 'START_QUIZ' }, async (payload) => {
        const blk = payload.payload?.block_index || 1;
        const rId = payload.payload?.round_id;
        if (rId) {
          try {
            const { data: activeRound } = await supabase
              .from('rounds')
              .select('id, status')
              .eq('id', rId)
              .eq('status', 'active')
              .maybeSingle();
            if (!activeRound) {
              console.warn("⚠️ Untrusted START_QUIZ broadcast dropped (no active round found in DB).");
              return;
            }
          } catch (_) {}
        }
        pendingWinnerRef.current = null;
        triggerStage('broadcasting', { blockIndex: blk, minerProgress: {} });
      })
      // Broadcast: Student solved a question -> Update live progress bar
      .on('broadcast', { event: 'MINER_PROGRESS' }, (payload) => {
        const { miner_id, regNo, miner_name, questions_solved } = payload.payload || {};
        const key = regNo || miner_id;
        if (key) {
          setStageData((prev) => ({
            ...prev,
            minerProgress: {
              ...prev.minerProgress,
              [key]: {
                name: miner_name || 'Miner',
                solved: questions_solved || 0,
              },
            },
          }));
        }
      })
      // Broadcast: Block mined by winner -> Enforce DB verification and full iterative loop playback
      .on('broadcast', { event: 'BLOCK_MINED' }, async (payload) => {
        const winnerData = payload.payload || {};
        console.log("BLOCK_MINED received. Current display stage:", stageRef.current);

        // Security check: Verify in database that this round was genuinely completed and winner assigned
        if (winnerData.roundId) {
          try {
            const { data: verifiedRound } = await supabase
              .from('rounds')
              .select('id, winner_miner_id, status')
              .eq('id', winnerData.roundId)
              .maybeSingle();

            if (!verifiedRound || verifiedRound.status !== 'completed' || !verifiedRound.winner_miner_id) {
              console.warn("⚠️ Untrusted BLOCK_MINED broadcast dropped (failed DB verification).");
              return;
            }
          } catch (verErr) {
            console.warn("Could not verify block mined broadcast against DB:", verErr);
          }
        }

        if (stageRef.current === 'broadcasting') {
          // Still in broadcasting: queue winner so broadcasting and at least 1 full mining loop play
          pendingWinnerRef.current = winnerData;
        } else if (stageRef.current === 'mining') {
          // In mining: ensure at least one full loop of mining_loop.mp4 has played
          const elapsed = Date.now() - miningStartTimeRef.current;
          const minMiningLoop = getVideoDurationMs('mining');

          if (elapsed < minMiningLoop) {
            const remaining = minMiningLoop - elapsed;
            console.log(`Delaying block_found by ${remaining}ms to complete at least one full mining loop.`);
            if (stageTimeoutRef.current) clearTimeout(stageTimeoutRef.current);
            stageTimeoutRef.current = setTimeout(() => {
              executeBlockFound(winnerData);
            }, remaining);
          } else {
            // Already completed at least one full loop
            executeBlockFound(winnerData);
          }
        } else {
          executeBlockFound(winnerData);
        }
      })
      // Broadcast: Admin aborted round -> return to 'idle'
      .on('broadcast', { event: 'ABORT_ROUND' }, () => {
        pendingWinnerRef.current = null;
        triggerStage('idle', {});
      });

    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const executeBlockFound = (winnerData) => {
    const { winner, timeTaken, blockIndex } = winnerData;
    triggerStage('block_found', {
      winnerName: winner || 'Anonymous Miner',
      timeTaken: timeTaken || 0,
      blockIndex: blockIndex || 1,
    });

    // Add to local blocks chain
    setBlocks((prev) => [
      ...prev,
      {
        id: Math.random().toString(),
        block_index: blockIndex || prev.length + 1,
        display_hash: `0x0000${Math.random().toString(16).slice(2, 10)}89f2`,
        time_taken_ms: (timeTaken || 0) * 1000,
        miners: { name: winner },
      },
    ]);
  };

  // 3. Stage Transitions & Auto-Advance with Full Video Loop Guarantee
  const triggerStage = (nextStage, data = {}) => {
    if (stageTimeoutRef.current) clearTimeout(stageTimeoutRef.current);

    setStage(nextStage);
    stageRef.current = nextStage;
    setStageData((prev) => ({ ...prev, ...data }));

    // Manage mining timer and loop start timestamp
    if (nextStage === 'mining') {
      miningStartTimeRef.current = Date.now();
      setElapsedTimer(0);
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = setInterval(() => {
        setElapsedTimer((t) => t + 1);
      }, 1000);

      // If a winner solved the quiz during broadcasting, let mining loop play 1 full cycle
      if (pendingWinnerRef.current) {
        const queuedWinner = pendingWinnerRef.current;
        pendingWinnerRef.current = null;
        const loopDuration = getVideoDurationMs('mining');
        console.log(`Miner solved during broadcasting! Playing 1 full mining loop (${loopDuration}ms) before block_found.`);
        stageTimeoutRef.current = setTimeout(() => {
          executeBlockFound(queuedWinner);
        }, loopDuration);
      }
    } else {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    }

    // Schedule transitions for non-infinite animation stages
    if (nextStage === 'broadcasting') {
      const dur = getVideoDurationMs('broadcasting');
      stageTimeoutRef.current = setTimeout(() => {
        triggerStage('mining', { minerProgress: {} });
      }, dur);
    } else if (nextStage === 'block_found') {
      const dur = getVideoDurationMs('block_found');
      stageTimeoutRef.current = setTimeout(() => {
        triggerStage('chain_append');
      }, dur);
    } else if (nextStage === 'chain_append') {
      const dur = getVideoDurationMs('chain_append');
      stageTimeoutRef.current = setTimeout(() => {
        triggerStage('idle', {});
      }, dur);
    }
  };

  const handleVideoLoaded = () => {
    setVideoAvailable(true);
  };

  const handleVideoError = () => {
    setVideoAvailable(false);
  };

  const handleVideoEnded = () => {
    if (stage === 'broadcasting') {
      triggerStage('mining', { minerProgress: {} });
    } else if (stage === 'block_found') {
      triggerStage('chain_append');
    } else if (stage === 'chain_append') {
      triggerStage('idle', {});
    }
  };

  const formatSeconds = (sec) => {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  return (
    <div className="relative w-screen h-screen max-h-screen bg-slate-950 text-white font-sans overflow-hidden flex flex-col justify-between selection:bg-purple-500/30">
      
      {/* BACKGROUND ANIMATION VIDEO */}
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
        <video
          ref={videoRef}
          key={stage}
          src={CLIP_MAP[stage]}
          autoPlay
          muted
          playsInline
          loop={stage === 'idle' || stage === 'mining'}
          onLoadedData={handleVideoLoaded}
          onError={handleVideoError}
          onEnded={handleVideoEnded}
          className={`w-full h-full object-cover transition-opacity duration-700 ${
            videoAvailable ? 'opacity-80' : 'opacity-0'
          }`}
        />
        
        {!videoAvailable && (
          <div className="absolute inset-0 bg-gradient-to-br from-slate-950 via-purple-950/40 to-slate-950 animate-pulse-slow" />
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/30 to-slate-950/80" />
      </div>

      {/* TOP HEADER (flex-shrink-0: never compressed) */}
      <header className="relative z-20 flex-shrink-0 flex items-center justify-between px-8 py-3 bg-slate-950/80 border-b border-white/10 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <img
            src="/ETH_VJTI.jpg"
            alt="ethVJTI"
            className="w-10 h-10 rounded-full border border-purple-400 shadow-[0_0_15px_rgba(168,85,247,0.5)] object-cover"
          />
          <div>
            <h1 className="text-xl font-extrabold tracking-tight text-white flex items-center gap-2">
              PoW POOL <span className="text-xs px-2 py-0.5 rounded-full bg-purple-900/60 border border-purple-500/40 text-purple-300 font-mono">PROJECTOR</span>
            </h1>
            <p className="text-[11px] font-mono text-purple-300/70">
              Interactive Proof-of-Work Consensus Visualizer
            </p>
          </div>
        </div>

        {/* Stage Status Badge */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900/80 border border-purple-500/30 font-mono text-xs shadow-inner">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                stage === 'idle'
                  ? 'bg-amber-400 animate-pulse'
                  : stage === 'broadcasting'
                  ? 'bg-blue-400 animate-ping'
                  : stage === 'mining'
                  ? 'bg-red-500 animate-ping'
                  : 'bg-emerald-400 animate-bounce'
              }`}
            />
            <span className="uppercase tracking-widest text-slate-200 font-semibold text-[11px]">
              {stage === 'idle' && 'MEMPOOL OPEN'}
              {stage === 'broadcasting' && 'BROADCASTING BLOCK'}
              {stage === 'mining' && 'CONSENSUS RACETRACK'}
              {stage === 'block_found' && 'BLOCK FOUND!'}
              {stage === 'chain_append' && 'APPENDING LEDGER'}
            </span>
          </div>

          <div className="font-mono text-xs bg-purple-950/60 border border-purple-700/50 px-3 py-1.5 rounded-xl text-purple-200">
            Active Nodes: <strong className="text-white font-bold">{miners.length}</strong>
          </div>
        </div>
      </header>

      {/* CENTER STAGE (min-h-0: contained) */}
      <main className="relative z-20 flex-1 min-h-0 flex flex-col items-center justify-center px-6 py-2 w-full max-w-6xl mx-auto overflow-hidden">
        
        {/* STAGE 1: IDLE / WAITING ROOM */}
        {stage === 'idle' && (
          <div className="flex flex-col items-center text-center animate-fade-in max-w-2xl">
            <div className="relative mb-3">
              <div className="w-20 h-20 rounded-full bg-gradient-to-tr from-purple-600 to-fuchsia-500 flex items-center justify-center text-3xl shadow-[0_0_40px_rgba(217,70,239,0.6)] animate-pulse-slow">
                ⚡
              </div>
            </div>
            
            <h2 className="text-3xl md:text-4xl font-black text-white tracking-tight mb-2">
              AWAITING NEXT BLOCK BROADCAST
            </h2>
            <p className="text-purple-300 text-sm font-light mb-4 max-w-lg">
              Miners authenticate via mobile to enter the memory pool. Once consensus starts, race to solve 5 cryptographic puzzles.
            </p>

            {/* Connected Miners Pills */}
            <div className="w-full bg-slate-900/70 p-4 rounded-2xl border border-white/10 backdrop-blur-md">
              <div className="text-[11px] uppercase tracking-widest text-purple-400 font-mono font-bold mb-2">
                Active Nodes in Mempool ({miners.length})
              </div>
              <div className="flex flex-wrap justify-center gap-2 max-h-24 overflow-y-auto custom-scrollbar">
                {miners.length === 0 ? (
                  <span className="text-purple-300/40 font-mono text-xs italic">No nodes authenticated yet. Scan QR code to connect.</span>
                ) : (
                  miners.map((m, idx) => (
                    <div key={m.regNo || m.id || idx} className="flex items-center gap-1.5 bg-slate-950/80 border border-purple-700/40 px-3 py-1.5 rounded-lg text-xs font-medium text-purple-100">
                      <span className="w-1.5 h-1.5 rounded-full bg-fuchsia-400 animate-pulse"></span>
                      {m.name}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* STAGE 2: BROADCASTING */}
        {stage === 'broadcasting' && (
          <div className="flex flex-col items-center text-center animate-fade-in-up">
            <div className="text-xs font-mono tracking-widest text-amber-400 uppercase bg-amber-950/60 border border-amber-500/40 px-3 py-1 rounded-full mb-3 animate-pulse">
              TRANSACTION BROADCAST INITIATED
            </div>
            <h2 className="text-5xl md:text-6xl font-black tracking-tight text-white mb-2 drop-shadow-[0_0_30px_rgba(245,158,11,0.5)]">
              BLOCK #{stageData.blockIndex}
            </h2>
            <p className="text-base text-purple-200 font-mono max-w-lg">
              Admin node is broadcasting cryptographic difficulty parameters to all connected miner nodes...
            </p>
          </div>
        )}

        {/* STAGE 3: MINING (RACETRACK OVERLAY WITH SCROLL) */}
        {stage === 'mining' && (
          <div className="w-full flex flex-col items-center animate-fade-in max-h-full">
            <div className="flex justify-between items-center w-full max-w-3xl mb-2 px-2">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-red-500 animate-ping"></span>
                <span className="font-mono text-fuchsia-400 text-xs font-bold tracking-widest">PROOF OF WORK IN PROGRESS</span>
              </div>
              <div className="font-mono text-2xl font-black text-white bg-slate-900/80 px-4 py-1 rounded-xl border border-fuchsia-500/40 shadow-[0_0_15px_rgba(217,70,239,0.4)]">
                {formatSeconds(elapsedTimer)}
              </div>
            </div>

            <div className="w-full max-w-3xl bg-slate-900/80 p-4 rounded-2xl border border-purple-900/50 backdrop-blur-xl shadow-2xl flex flex-col gap-2">
              <div className="text-[11px] font-mono font-bold text-purple-300 uppercase tracking-widest flex justify-between border-b border-white/10 pb-2">
                <span>Active Mining Nodes ({miners.length})</span>
                <span>Block Completion (5 Puzzles)</span>
              </div>

              {/* Strict Max Height ensures bottom chain is never cut in half */}
              <div className="max-h-[38vh] overflow-y-auto pr-2 custom-scrollbar flex flex-col gap-2">
                {miners.length === 0 ? (
                  <div className="text-center text-purple-300/40 font-mono py-4 text-xs italic">No active miners detected in current round.</div>
                ) : (
                  miners.map((m, idx) => {
                    const key = m.regNo || m.id;
                    const solvedCount = stageData.minerProgress[key]?.solved ?? stageData.minerProgress[m.id]?.solved ?? 0;
                    const pct = Math.min((solvedCount / 5) * 100, 100);

                    return (
                      <div key={m.id || m.regNo || idx} className="flex flex-col gap-1">
                        <div className="flex justify-between items-center text-xs font-semibold">
                          <span className="text-white flex items-center gap-1.5 truncate max-w-[70%]">
                            <span className="text-purple-400 font-mono text-[10px]">[{idx + 1}]</span>
                            <span className="truncate">{m.name}</span>
                          </span>
                          <span className="font-mono text-[11px] text-fuchsia-300 font-bold">{solvedCount} / 5</span>
                        </div>
                        <div className="h-2.5 w-full bg-slate-950 rounded-full overflow-hidden border border-white/5 p-0.5 shadow-inner">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-purple-600 via-fuchsia-500 to-white transition-all duration-500 ease-out shadow-[0_0_10px_rgba(217,70,239,0.8)]"
                            style={{ width: `${pct}%` }}
                          ></div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}

        {/* STAGE 4: BLOCK FOUND (WINNER SPOTLIGHT) */}
        {stage === 'block_found' && (
          <div className="flex flex-col items-center text-center animate-fade-in max-w-xl">
            <div className="w-16 h-16 rounded-full bg-gradient-to-tr from-amber-400 to-yellow-200 text-slate-950 flex items-center justify-center text-3xl mb-2 shadow-[0_0_50px_rgba(245,158,11,0.8)] animate-bounce">
              🏆
            </div>
            
            <div className="text-[10px] font-mono font-bold tracking-widest text-emerald-400 uppercase bg-emerald-950/80 border border-emerald-500/50 px-4 py-1 rounded-full mb-2">
              CONSENSUS REACHED • BLOCK MINED
            </div>

            <h2 className="text-4xl md:text-5xl font-black text-white mb-1 tracking-tight">
              {stageData.winnerName}
            </h2>
            <p className="text-purple-300 font-mono text-sm mb-3">
              Mined Block #{stageData.blockIndex} in <strong className="text-white font-bold">{stageData.timeTaken}s</strong>!
            </p>

            <div className="bg-slate-900/90 border border-amber-500/40 p-2.5 rounded-xl font-mono text-[11px] text-amber-200/80 shadow-xl">
              Hash: 0x0000{Math.random().toString(16).slice(2, 10)}89f2c19e34a78b
            </div>
          </div>
        )}

        {/* STAGE 5: CHAIN APPEND */}
        {stage === 'chain_append' && (
          <div className="flex flex-col items-center text-center animate-fade-in">
            <div className="text-[10px] font-mono tracking-widest text-cyan-400 uppercase bg-cyan-950/80 border border-cyan-500/50 px-3.5 py-1 rounded-full mb-2 animate-pulse">
              IMMUTABLE COMMITMENT
            </div>
            <h2 className="text-3xl font-extrabold text-white mb-1">
              APPENDING BLOCK #{stageData.blockIndex} TO LEDGER
            </h2>
            <p className="text-purple-300 text-xs font-mono">
              Synchronizing state across distributed nodes...
            </p>
          </div>
        )}

      </main>

      {/* BOTTOM BLOCKCHAIN TIMELINE (flex-shrink-0: NEVER cut in half) */}
      <footer className="relative z-20 flex-shrink-0 w-full px-8 py-3 bg-slate-950/90 border-t border-white/10 backdrop-blur-xl">
        <div className="flex items-center justify-between mb-2 text-[11px] font-mono font-bold text-purple-400 uppercase tracking-widest">
          <span>Distributed Ledger (Mined Blocks)</span>
          <span className="text-slate-400 font-normal">Genesis &rarr; Latest</span>
        </div>

        <div className="flex items-center gap-3 overflow-x-auto pb-1 custom-scrollbar">
          {/* Genesis Block */}
          <div className="flex-shrink-0 flex items-center gap-2">
            <div className="w-36 bg-slate-900/80 border border-purple-800/50 p-2.5 rounded-xl flex flex-col shadow-md">
              <span className="font-mono text-[9px] text-fuchsia-400 font-bold uppercase">Block #000</span>
              <span className="text-xs font-semibold text-white truncate">GENESIS</span>
              <span className="font-mono text-[9px] text-slate-500 truncate">0x00000000...0000</span>
            </div>
            <span className="text-purple-500 font-mono text-xs font-bold">&rarr;</span>
          </div>

          {/* Mined Blocks */}
          {blocks.map((b, i) => (
            <div key={b.id || i} className="flex-shrink-0 flex items-center gap-2 animate-fade-in">
              <div className="w-40 bg-purple-950/40 border border-purple-500/40 p-2.5 rounded-xl flex flex-col shadow-[0_0_12px_rgba(168,85,247,0.2)]">
                <div className="flex justify-between items-center mb-0.5">
                  <span className="font-mono text-[9px] text-fuchsia-300 font-bold">Block #{b.block_index}</span>
                  <span className="font-mono text-[9px] text-emerald-400 font-semibold">{((b.time_taken_ms || 0) / 1000).toFixed(1)}s</span>
                </div>
                <span className="text-xs font-bold text-white truncate">{b.miners?.name || 'Miner'}</span>
                <span className="font-mono text-[8px] text-purple-300/50 truncate">{b.display_hash}</span>
              </div>
              {i < blocks.length - 1 && <span className="text-purple-500 font-mono text-xs font-bold">&rarr;</span>}
            </div>
          ))}

          {blocks.length === 0 && (
            <div className="text-slate-500 font-mono text-xs italic py-1">
              Waiting for Block #001 to be mined by students...
            </div>
          )}
        </div>
      </footer>

    </div>
  );
}
