import React, { useEffect, useState } from 'react';
import BlockchainBackgroundAccents from './BlockchainBackgroundAccents';
import Signup from './Signup';
import Mempool from './Mempool';
import Admin from './Admin';
import QuizView from './views/QuizView';
import DisplayBoardView from './views/DisplayBoardView';
import PageNullView from './views/PageNullView';
import { useMempool } from './hooks/useMempool';
import { finishMinerSession, markMinerCompletedInCache } from './utils/api';

function ParticipantApp() {
  const [mounted, setMounted] = useState(false);
  const [minerData, setMinerData] = useState(() => {
    const saved = localStorage.getItem('pow_miner');
    return saved ? JSON.parse(saved) : null;
  });

  const [currentView, setCurrentView] = useState(() => {
    const savedMiner = localStorage.getItem('pow_miner');
    const savedView = localStorage.getItem('pow_view');
    // If not authenticated, always display landing
    if (!savedMiner || savedView === 'null') {
      return 'landing';
    }
    return savedView || 'landing';
  });

  // Persistent root connection: keeps student in Presence and maintains socket channel across views
  const {
    miners,
    gameState,
    winnerInfo,
    poolConfig,
    sendBroadcast,
    channel,
    addLocalMiner,
  } = useMempool(minerData, null, false, false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Safely finish session and redirect participant to /null
  const navigateToNull = (winReceipt = null) => {
    const reg = minerData?.registration_number || minerData?.regNo;
    const mId = minerData?.id;
    let rId = null;
    try {
      const roundData = JSON.parse(localStorage.getItem('pow_current_round') || '{}');
      rId = roundData?.round_id;
    } catch (_) {}

    // Record completion in PostgreSQL and memory cache
    if (reg) {
      markMinerCompletedInCache(reg);
    }
    if (mId && rId) {
      finishMinerSession(mId, rId, reg);
    }

    // Preserve victory receipt if present
    let receiptToSave = winReceipt;
    if (!receiptToSave) {
      try {
        const savedReceipt = sessionStorage.getItem('pow_win_receipt');
        if (savedReceipt) receiptToSave = JSON.parse(savedReceipt);
      } catch (_) {}
    }

    // Purge credentials and cookies
    try {
      document.cookie.split(";").forEach((c) => {
        document.cookie = c
          .replace(/^ +/, "")
          .replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
      });
      sessionStorage.clear();
      if (receiptToSave) {
        sessionStorage.setItem('pow_win_receipt', JSON.stringify(receiptToSave));
      }
      localStorage.removeItem('pow_miner');
      localStorage.removeItem('pow_current_round');
      localStorage.removeItem('pow_quiz_index');
      localStorage.removeItem('pow_quiz_time');
      localStorage.removeItem('pow_view');
    } catch (_) {}

    setMinerData(null);

    // Direct browser cleanly to /null
    window.location.href = '/null';
  };

  // Sync state transitions from network events
  useEffect(() => {
    if (gameState === 'quiz_started' && currentView !== 'quiz') {
      setCurrentView('quiz');
    } else if (gameState === 'waiting' && currentView === 'quiz') {
      // Admin aborted round
      setCurrentView('mempool');
    } else if (gameState === 'block_found' || winnerInfo) {
      // Check if current user is the winner
      const isMe = minerData && winnerInfo && (
        (winnerInfo.regNo && (winnerInfo.regNo === minerData.registration_number || winnerInfo.regNo === minerData.regNo)) ||
        (winnerInfo.winner && winnerInfo.winner === minerData.name)
      );

      let hasLocalWinReceipt = false;
      try {
        const r = JSON.parse(sessionStorage.getItem('pow_win_receipt') || '{}');
        if (r && r.isWinner) hasLocalWinReceipt = true;
      } catch (_) {}

      // If current miner is the winner, DO NOT REDIRECT! Stay in QuizView so winner can see their victory screen
      if (isMe || hasLocalWinReceipt) {
        return;
      }

      // If non-winner is currently solving in QuizView, QuizView's effect handles the 3-second notice
      if (currentView === 'quiz') {
        return;
      }

      // For miners in mempool or elsewhere, brief delay before redirecting
      const t = setTimeout(() => {
        navigateToNull();
      }, 2500);
      return () => clearTimeout(t);
    }
  }, [gameState, currentView, winnerInfo, minerData]);

  // Persist view state only for active miner sessions (never persist 'null' or 'landing')
  useEffect(() => {
    if (currentView && currentView !== 'null' && currentView !== 'landing' && minerData) {
      localStorage.setItem('pow_view', currentView);
    } else {
      localStorage.removeItem('pow_view');
    }
  }, [currentView, minerData]);

  // Persist login session
  useEffect(() => {
    if (minerData) {
      localStorage.setItem('pow_miner', JSON.stringify(minerData));
    } else {
      localStorage.removeItem('pow_miner');
    }
  }, [minerData]);

  const handleConnectNode = (miner) => {
    console.log("Miner authenticated:", miner);
    setMinerData(miner);
    if (addLocalMiner) {
      addLocalMiner(miner);
    }
    if (sendBroadcast) {
      sendBroadcast('MINER_JOINED', miner);
    }
    setCurrentView('mempool');
  };

  const handleReturnToMempool = () => {
    setCurrentView('mempool');
  };

  const handleQuizComplete = (winReceipt = null) => {
    navigateToNull(winReceipt);
  };

  return (
    <div className="relative min-h-screen bg-slate-950 text-slate-100 font-sans overflow-hidden flex flex-col justify-between selection:bg-purple-500/30">
      
      {/* Cyber Grid Background */}
      <div className="absolute inset-0 cyber-grid-bg z-0 opacity-60"></div>

      {/* Background Orbs */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
        <div className="absolute top-[-10%] left-[-10%] w-[40vw] h-[40vw] rounded-full bg-purple-900/20 blur-[100px] animate-float"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[50vw] h-[50vw] rounded-full bg-fuchsia-900/20 blur-[120px] animate-float-delayed"></div>
      </div>

      <BlockchainBackgroundAccents />

      {currentView === 'landing' && (
        <>
          <main className="relative z-10 flex flex-col items-center flex-grow px-6 pt-16 pb-32 max-w-lg mx-auto w-full">
            <header className={`flex flex-col items-center mb-12 opacity-0 ${mounted ? 'animate-fade-in-up' : ''}`} style={{ animationDelay: '100ms' }}>
              <img src="/ETH_VJTI.jpg" alt="ethVJTI Logo" className="w-24 h-24 rounded-full mb-4 shadow-[0_0_20px_rgba(168,85,247,0.5)] border-2 border-purple-500/50 object-cover" />
              <div className="text-purple-400 font-mono text-sm tracking-widest uppercase mb-2">ethVJTI Presents</div>
              <h1 className="text-5xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-purple-300 to-white mb-2 drop-shadow-[0_0_10px_rgba(255,255,255,0.2)] text-center">
                PoW Pool
              </h1>
              <p className="text-purple-200/70 text-lg font-light text-center">
                Experience Proof of Work.
              </p>
            </header>

            <section className="w-full flex flex-col gap-5">
              <div className={`flex items-start gap-4 p-5 rounded-2xl bg-slate-900/60 border border-purple-900/50 backdrop-blur-md opacity-0 ${mounted ? 'animate-fade-in-up' : ''}`} style={{ animationDelay: '300ms' }}>
                <div className="flex-shrink-0 w-12 h-12 rounded-full bg-purple-900/50 flex items-center justify-center text-purple-300 text-2xl border border-purple-700/50 shadow-inner">
                  📡
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-white mb-1">Join the Pool</h3>
                  <p className="text-purple-200/70 text-sm leading-relaxed">Enter the mempool and race against other miners in real-time.</p>
                </div>
              </div>

              <div className={`flex items-start gap-4 p-5 rounded-2xl bg-slate-900/60 border border-purple-900/50 backdrop-blur-md opacity-0 ${mounted ? 'animate-fade-in-up' : ''}`} style={{ animationDelay: '500ms' }}>
                <div className="flex-shrink-0 w-12 h-12 rounded-full bg-fuchsia-900/50 flex items-center justify-center text-fuchsia-300 text-2xl border border-fuchsia-700/50 shadow-inner">
                  ⚡
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-white mb-1">Solve Fast</h3>
                  <p className="text-purple-200/70 text-sm leading-relaxed">Crack 5 simple puzzles faster than the rest of the network.</p>
                </div>
              </div>

              <div className={`flex items-start gap-4 p-5 rounded-2xl bg-slate-900/60 border border-purple-900/50 backdrop-blur-md opacity-0 ${mounted ? 'animate-fade-in-up' : ''}`} style={{ animationDelay: '700ms' }}>
                <div className="flex-shrink-0 w-12 h-12 rounded-full bg-white/10 flex items-center justify-center text-white text-2xl border border-white/30 shadow-inner">
                  🏆
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-white mb-1">Mine the Block</h3>
                  <p className="text-purple-200/70 text-sm leading-relaxed">Earn your permanent spot on the chain and an exclusive sticker.</p>
                </div>
              </div>
            </section>
          </main>

          <footer className={`fixed bottom-0 left-0 w-full p-6 bg-gradient-to-t from-slate-950 via-slate-950/90 to-transparent z-20 flex justify-center opacity-0 ${mounted ? 'animate-fade-in' : ''}`} style={{ animationDelay: '1000ms' }}>
            <button 
              onClick={() => {
                if (minerData) {
                  setCurrentView('mempool');
                } else {
                  setCurrentView('signup');
                }
              }}
              className="w-full max-w-lg py-4 px-8 rounded-xl bg-gradient-to-r from-purple-700 to-purple-500 hover:from-purple-600 hover:to-purple-400 text-white font-bold text-lg tracking-wide transition-all duration-300 shadow-[0_0_20px_rgba(168,85,247,0.4)] hover:shadow-[0_0_30px_rgba(168,85,247,0.6)] animate-pulse-slow transform hover:-translate-y-1 border border-purple-400/50 cursor-pointer"
            >
              {minerData ? '[ RESUME SESSION ]' : '[ ENTER THE NETWORK ]'}
            </button>
          </footer>
        </>
      )}

      {currentView === 'signup' && (
        <Signup 
          onConnect={handleConnectNode} 
          miners={miners} 
          poolConfig={poolConfig} 
        />
      )}

      {currentView === 'mempool' && (
        <Mempool 
          minerData={minerData} 
          miners={miners} 
          poolConfig={poolConfig} 
          gameState={gameState} 
        />
      )}

      {currentView === 'quiz' && (
        <QuizView 
          minerData={minerData} 
          sendBroadcast={sendBroadcast}
          winnerInfo={winnerInfo}
          onReturnToMempool={handleReturnToMempool}
          onComplete={handleQuizComplete}
        />
      )}

    </div>
  );
}

export default function AppRoot() {
  const [route, setRoute] = useState(() => {
    return window.location.pathname.toLowerCase().replace(/\/+$/, '');
  });

  useEffect(() => {
    const handlePopState = () => {
      setRoute(window.location.pathname.toLowerCase().replace(/\/+$/, ''));
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const adminPath = import.meta.env.VITE_ADMIN_ROUTE?.toLowerCase().replace(/\/+$/, '');
  if (adminPath && route === adminPath) {
    return <Admin />;
  }

  if (route === '/display' || route === '/projector' || route === '/screen') {
    return <DisplayBoardView />;
  }

  if (route === '/null') {
    return <PageNullView />;
  }

  return <ParticipantApp />;
}
