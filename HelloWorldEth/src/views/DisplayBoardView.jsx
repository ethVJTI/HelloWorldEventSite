import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
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
  const [newBlockId, setNewBlockId] = useState(null);

  const videoRef = useRef(null);
  const blockchainRef = useRef(null);
  const stageRef = useRef('idle');
  const timerIntervalRef = useRef(null);
  const stageTimeoutRef = useRef(null);
  const pendingWinnerRef = useRef(null);
  const pendingBlockRef = useRef(null);
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
        pendingBlockRef.current = null;
        setNewBlockId(null);
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
      // Broadcast: Block mined by winner -> React immediately in real-time
      .on('broadcast', { event: 'BLOCK_MINED' }, (payload) => {
        const winnerData = payload.payload || {};
        console.log("[DisplayBoard] Realtime BLOCK_MINED broadcast received:", winnerData);
        handleIncomingBlock(winnerData);
      })
      // Supabase Postgres CDC: Catch real-time database block inserts immediately
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'blocks' }, async (payload) => {
        console.log("⚡ [DisplayBoard] Realtime postgres_changes on 'blocks' INSERT received:", payload.new);
        const row = payload.new;
        if (!row) return;

        let minerName = 'Miner';
        if (row.miner_id) {
          try {
            const { data: m } = await supabase
              .from('miners')
              .select('name')
              .eq('id', row.miner_id)
              .maybeSingle();
            if (m?.name) minerName = m.name;
          } catch (_) {}
        }

        handleIncomingBlock({
          id: row.id,
          blockIndex: row.block_index,
          display_hash: row.display_hash,
          timeTaken: (row.time_taken_ms || 0) / 1000,
          winner: minerName,
        });
      })
      // Broadcast: Admin aborted round -> return to 'idle'
      .on('broadcast', { event: 'ABORT_ROUND' }, () => {
        pendingWinnerRef.current = null;
        pendingBlockRef.current = null;
        triggerStage('idle', {});
      });

    channel.subscribe((status) => {
      console.log("⚡ [DisplayBoard] Realtime channel status:", status);
    });

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Auto-scroll the 3D blockchain ledger when a new block is mined
  useEffect(() => {
    if (!newBlockId) return;

    const timer = setTimeout(() => {
      const container = blockchainRef.current;
      if (!container) return;

      const blockElements = container.querySelectorAll('.cube-wrapper-3d');
      const lastBlock = blockElements[blockElements.length - 1];
      if (lastBlock) {
        lastBlock.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'end' });
      }
      container.scrollTo({
        left: container.scrollWidth,
        behavior: 'smooth',
      });
    }, 120);

    return () => clearTimeout(timer);
  }, [blocks, newBlockId]);

  // Dedicated real-time handler to process newly mined block and advance display board
  const handleIncomingBlock = (winnerData) => {
    if (!winnerData) return;
    const winnerName = winnerData.winner || winnerData.minerName || winnerData.name || 'Anonymous Miner';
    const timeTaken = Number(winnerData.timeTaken) || ((winnerData.time_taken_ms || 0) / 1000) || 0;
    const blockIndex = Number(winnerData.blockIndex || winnerData.block_index) || 1;
    const displayHash = winnerData.display_hash || winnerData.displayHash || `0x0000${Math.random().toString(16).slice(2, 10)}89f2`;
    const blockId = winnerData.id || `block-${blockIndex}-${Date.now()}`;

    // Deduplicate: Don't add if already in ledger (by id or by positive block_index)
    const exists = blocks.some((b) => 
      (winnerData.id && b.id === winnerData.id) ||
      (blockIndex > 0 && b.block_index === blockIndex)
    );
    if (exists) {
      return;
    }

    // If this block is already queued and waiting for chain_append video to finish
    if (
      pendingBlockRef.current &&
      (pendingBlockRef.current.block_index === blockIndex ||
       (winnerData.id && pendingBlockRef.current.id === winnerData.id))
    ) {
      if (winnerData.id) {
        pendingBlockRef.current.id = winnerData.id;
      }
      return;
    }

    // Queue the block to be appended into the blockchain ONLY AFTER chain_append.mp4 finishes
    pendingBlockRef.current = {
      id: blockId,
      block_index: blockIndex,
      display_hash: displayHash,
      time_taken_ms: Math.round(timeTaken * 1000),
      miners: { name: winnerName },
    };

    // Advance projector center stage to 'block_found' immediately
    triggerStage('block_found', {
      winnerName,
      timeTaken,
      blockIndex,
    });
  };

  // Commit the pending block to the blockchain ledger and trigger 3D entry animation
  const commitPendingBlock = () => {
    if (!pendingBlockRef.current) return;
    const blockToAdd = pendingBlockRef.current;
    pendingBlockRef.current = null;

    setBlocks((prev) => {
      const exists = prev.some((b) => 
        (blockToAdd.id && b.id === blockToAdd.id) ||
        (blockToAdd.block_index > 0 && b.block_index === blockToAdd.block_index)
      );
      if (exists) {
        return prev;
      }

      setNewBlockId(blockToAdd.id);
      return [...prev, blockToAdd];
    });
  };

  const executeBlockFound = handleIncomingBlock;

  // 3. Stage Transitions & Auto-Advance with Full Video Loop Guarantee
  const triggerStage = (nextStage, data = {}) => {
    if (stageTimeoutRef.current) clearTimeout(stageTimeoutRef.current);

    // If transitioning away from chain_append to idle, commit the block right as the video finishes
    if (stageRef.current === 'chain_append' && nextStage === 'idle') {
      commitPendingBlock();
    }

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
        commitPendingBlock();
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
      commitPendingBlock();
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
          style={{ transform: 'translateY(-20%)', height: 'calc(100% + 10%)' }}
          className={`w-full object-cover transition-opacity duration-700 ${
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
          <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-900/80 border border-purple-950 font-mono text-xs text-white shadow-inner">
            <span className="uppercase tracking-widest text-slate-200 font-semibold text-[11px]">
              {stage === 'idle' && 'MEMPOOL OPEN'}
              {stage === 'broadcasting' && 'BROADCASTING BLOCK'}
              {stage === 'mining' && 'CONSENSUS RACETRACK'}
              {stage === 'block_found' && 'BLOCK FOUND!'}
              {stage === 'chain_append' && 'APPENDING LEDGER'}
            </span>
          </div>

          <div className="font-mono text-xs bg-purple-950 border border-purple-700/50 px-3 py-1.5 text-white-200">
            Active Nodes: <strong className="text-white font-bold">{miners.length}</strong>
          </div>
        </div>
      </header>

      {/* CENTER STAGE (min-h-0: contained) */}
      <main className="relative z-20 flex-1 min-h-0 flex flex-col items-center justify-center px-6 py-2 w-full max-w-6xl mx-auto overflow-hidden">
        
        {/* STAGE 1: IDLE / WAITING ROOM */}
        {stage === 'idle' && (
          <div className="flex flex-col items-center text-center animate-fade-in max-w-2xl">
            
            <h2 className="text-3xl md:text-4xl font-black text-white tracking-tight mb-2">
              AWAITING NEXT BLOCK BROADCAST
            </h2>

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

        {/* STAGE 3: MINING (ADAPTIVE MULTI-COLUMN RACETRACK) */}
        {stage === 'mining' && (() => {
          // Merge presence miners and miners who broadcasted progress
          const rosterMap = new Map();
          (miners || []).forEach((m, idx) => {
            const key = m.regNo || m.id || `miner-${idx}`;
            rosterMap.set(key, {
              id: m.id || key,
              regNo: m.regNo || key,
              name: m.name || `Miner #${idx + 1}`,
              key,
            });
          });

          Object.entries(stageData.minerProgress || {}).forEach(([key, prog]) => {
            if (rosterMap.has(key)) {
              const existing = rosterMap.get(key);
              rosterMap.set(key, { ...existing, name: prog.name || existing.name, solved: prog.solved });
            } else {
              rosterMap.set(key, {
                id: key,
                regNo: key,
                key,
                name: prog.name || 'Miner',
                solved: prog.solved,
              });
            }
          });

          const rosterList = Array.from(rosterMap.values()).map((m) => {
            const solved = stageData.minerProgress[m.key]?.solved ?? stageData.minerProgress[m.id]?.solved ?? m.solved ?? 0;
            return { ...m, solvedCount: solved };
          });

          // Sort leaders to the top so race leaders are always visible first
          const sortedRoster = rosterList.sort((a, b) => b.solvedCount - a.solvedCount);

          const gridColsClass =
            sortedRoster.length > 12
              ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
              : sortedRoster.length > 4
              ? 'grid-cols-1 md:grid-cols-2'
              : 'grid-cols-1';

          return (
            <div className="w-full flex flex-col items-center animate-fade-in max-h-full">
              <div className="flex justify-between items-center w-full max-w-5xl mb-2 px-2">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-red-500 animate-ping"></span>
                  <span className="font-mono text-fuchsia-400 text-xs font-bold tracking-widest">
                    PROOF OF WORK CONSENSUS RACETRACK
                  </span>
                </div>
                <div className="font-mono text-xl md:text-2xl font-black text-white bg-slate-900/80 px-4 py-1 rounded-xl border border-fuchsia-500/40 shadow-[0_0_15px_rgba(217,70,239,0.4)]">
                  ⏱️ {formatSeconds(elapsedTimer)}
                </div>
              </div>

              <div className="w-full max-w-5xl bg-slate-900/85 p-3 md:p-4 rounded-2xl border border-purple-800/50 backdrop-blur-xl shadow-2xl flex flex-col gap-2">
                <div className="text-[11px] font-mono font-bold text-purple-300 uppercase tracking-widest flex justify-between border-b border-white/10 pb-2 px-1">
                  <span>Active Mining Nodes ({sortedRoster.length})</span>
                  <span>Target: 5 Cryptographic Puzzles</span>
                </div>

                {/* Adaptive Scrollable Grid: Displays 20-30+ miners simultaneously without cutoffs */}
                <div className="max-h-[44vh] overflow-y-auto pr-1.5 custom-scrollbar">
                  {sortedRoster.length === 0 ? (
                    <div className="text-center text-purple-300/40 font-mono py-6 text-xs italic">
                      No active miners detected in current round.
                    </div>
                  ) : (
                    <div className={`grid gap-2.5 ${gridColsClass}`}>
                      {sortedRoster.map((m, idx) => {
                        const solvedCount = m.solvedCount;
                        const pct = Math.min((solvedCount / 5) * 100, 100);
                        const isFinished = solvedCount >= 5;

                        return (
                          <div
                            key={m.key || m.id || idx}
                            className={`p-2.5 rounded-xl border transition-all ${
                              isFinished
                                ? 'bg-amber-950/40 border-amber-500/50 shadow-[0_0_12px_rgba(245,158,11,0.25)]'
                                : solvedCount > 0
                                ? 'bg-purple-950/35 border-purple-600/40 shadow-sm'
                                : 'bg-slate-950/60 border-white/5'
                            } flex flex-col gap-1.5`}
                          >
                            <div className="flex justify-between items-center text-xs font-semibold">
                              <span className="text-white flex items-center gap-1.5 truncate max-w-[72%]">
                                <span className="font-mono text-[10px] font-bold text-purple-400">
                                  {idx === 0 && solvedCount > 0
                                    ? '🥇'
                                    : idx === 1 && solvedCount > 0
                                    ? '🥈'
                                    : idx === 2 && solvedCount > 0
                                    ? '🥉'
                                    : `#${idx + 1}`}
                                </span>
                                <span className="truncate text-[11px] font-medium text-slate-100">{m.name}</span>
                              </span>
                              <span
                                className={`font-mono text-[10px] font-bold ${
                                  isFinished
                                    ? 'text-amber-300 font-black'
                                    : solvedCount > 0
                                    ? 'text-fuchsia-300'
                                    : 'text-slate-500'
                                }`}
                              >
                                {isFinished ? 'SOLVED 5/5' : `${solvedCount} / 5`}
                              </span>
                            </div>
                            <div className="h-2 w-full bg-slate-950 rounded-full overflow-hidden border border-white/5 p-0.5 shadow-inner">
                              <div
                                className={`h-full rounded-full transition-all duration-500 ease-out ${
                                  isFinished
                                    ? 'bg-gradient-to-r from-amber-500 to-yellow-300 shadow-[0_0_10px_rgba(245,158,11,0.8)]'
                                    : 'bg-gradient-to-r from-purple-600 via-fuchsia-500 to-white shadow-[0_0_8px_rgba(217,70,239,0.7)]'
                                }`}
                                style={{ width: `${pct}%` }}
                              ></div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

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

      {/* BOTTOM BLOCKCHAIN TIMELINE (3D CUBE LEDGER) */}
      <footer className="relative z-20 flex-shrink-0 w-full px-8 py-2 bg-slate-950/90 border-t border-white/10 backdrop-blur-xl">
        <div className="flex items-center justify-between mb-1 text-[11px] font-mono font-bold text-purple-400 uppercase tracking-widest">
          <span>Distributed Ledger (Mined Blocks)</span>
          <span className="text-slate-400 font-normal">Genesis &rarr; Latest</span>
        </div>

        <div className="blockchain-3d-container" ref={blockchainRef}>
          <div className="blockchain-3d-inner">
            {(() => {
              const genesisBlock = {
                id: 'genesis-000',
                isGenesis: true,
                block_index: 0,
                name: 'GENESIS',
                display_hash: '0x00000000...0000',
                time_taken_ms: 0,
              };
              const hasDbGenesis = blocks.some((b) => b.block_index === 0);
              const allBlocks = hasDbGenesis ? blocks : [genesisBlock, ...blocks];

              return allBlocks.map((b, idx) => {
                const isGenesis = b.isGenesis || b.block_index === 0;
                const isNew = b.id === newBlockId;
                const isConnectingToNew = idx < allBlocks.length - 1 && allBlocks[idx + 1]?.id === newBlockId;

                return (
                  <div key={b.id || idx} className="chain-item-3d">
                    <motion.div
                      className="cube-wrapper-3d"
                      initial={
                        isNew
                          ? {
                              opacity: 0,
                              scale: 0.1,
                              x: 140,
                              y: -35,
                              rotateX: -75,
                              rotateY: -75,
                              rotateZ: 45,
                            }
                          : false
                      }
                      animate={{
                        opacity: 1,
                        scale: 1,
                        x: 0,
                        y: 0,
                        rotateX: 0,
                        rotateY: 0,
                        rotateZ: 0,
                      }}
                      transition={{
                        duration: 1.1,
                        ease: [0.16, 1, 0.3, 1],
                      }}
                    >
                      {/* IMPACT SHOCKWAVE */}
                      {isNew && (
                        <motion.div
                          className="impact-3d"
                          initial={{
                            opacity: 0,
                            scale: 0,
                          }}
                          animate={{
                            opacity: [0, 1, 0],
                            scale: [0, 1.1, 2.5],
                          }}
                          transition={{
                            duration: 0.45,
                            delay: 1.18,
                            times: [0, 0.25, 1],
                          }}
                        />
                      )}

                      {/* 3D CUBE */}
                      <div className={`cube-3d ${isGenesis ? 'genesis' : ''} ${isNew ? 'new-block' : ''}`}>
                        {/* FRONT FACE */}
                        <div className="face-3d front">
                          <motion.div
                            className="w-full text-center flex flex-col items-center justify-center relative z-10"
                            initial={isNew ? { opacity: 0, scale: 0.5 } : false}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{
                              duration: 0.35,
                              delay: isNew ? 1.38 : 0,
                            }}
                          >
                            <div
                              className={`text-[8px] font-mono tracking-wider font-bold mb-0.5 ${
                                isGenesis ? 'text-amber-400' : 'text-fuchsia-300'
                              }`}
                            >
                              {isGenesis ? 'BLOCK #000' : `BLOCK #${b.block_index}`}
                            </div>
                            <div className="text-[11px] font-bold text-white truncate max-w-[95px] mb-0.5">
                              {isGenesis ? 'GENESIS' : (b.miners?.name || b.name || 'Miner')}
                            </div>
                            <div className="w-full px-1 py-0.5 rounded bg-black/70 border border-purple-500/20 font-mono text-[7px] text-purple-200 truncate">
                              {b.display_hash}
                            </div>
                            {!isGenesis && (
                              <div className="text-[8px] font-mono text-emerald-400 font-semibold mt-0.5">
                                {((b.time_taken_ms || 0) / 1000).toFixed(1)}s
                              </div>
                            )}
                          </motion.div>
                        </div>

                        {/* BACK FACE */}
                        <div className="face-3d back">
                          <span>⛓</span>
                        </div>

                        {/* RIGHT FACE */}
                        <div className="face-3d right">
                          <span>{isGenesis ? '💎' : '₿'}</span>
                        </div>

                        {/* LEFT FACE */}
                        <div className="face-3d left">
                          <span>{isGenesis ? '🏛️' : 'Ξ'}</span>
                        </div>

                        {/* TOP FACE */}
                        <div className="face-3d top">
                          <span>{isGenesis ? 'GENESIS' : 'BLOCKCHAIN'}</span>
                        </div>

                        {/* BOTTOM FACE */}
                        <div className="face-3d bottom">
                          <span>🔗</span>
                        </div>
                      </div>
                    </motion.div>

                    {/* CONNECTING CHAIN LINK */}
                    {idx < allBlocks.length - 1 && (
                      <motion.div
                        className="chain-link-3d"
                        initial={
                          isConnectingToNew
                            ? {
                                opacity: 0,
                                scaleX: 0,
                              }
                            : false
                        }
                        animate={{
                          opacity: 1,
                          scaleX: 1,
                        }}
                        transition={{
                          duration: 0.4,
                          delay: isConnectingToNew ? 1.75 : 0,
                        }}
                      >
                        ⛓
                      </motion.div>
                    )}
                  </div>
                );
              });
            })()}
          </div>
        </div>
      </footer>

    </div>
  );
}
