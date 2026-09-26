import React, { useEffect, useState } from 'react';
import BlockchainBackgroundAccents from './BlockchainBackgroundAccents';
import Signup from './Signup';
import Mempool from './Mempool';
import Admin from './Admin';
import Quiz from './Quiz';

function App() {
  const [mounted, setMounted] = useState(false);
  
  const [currentView, setCurrentView] = useState(() => {
    return localStorage.getItem('pow_view') || 'landing';
  }); 

  const [minerData, setMinerData] = useState(() => {
    const saved = localStorage.getItem('pow_miner');
    return saved ? JSON.parse(saved) : null;
  });

  // Check for secret admin route
    if (window.location.pathname.toLowerCase() === import.meta.env.VITE_ADMIN_ROUTE?.toLowerCase()) {
    return <Admin />;
  }

  useEffect(() => {
    setMounted(true);
  }, []);

  // Persist view state so they don't lose progress on refresh
  useEffect(() => {
    localStorage.setItem('pow_view', currentView);
  }, [currentView]);

  // Persist login session
  useEffect(() => {
    if (minerData) {
      localStorage.setItem('pow_miner', JSON.stringify(minerData));
    } else {
      localStorage.removeItem('pow_miner');
    }
  }, [minerData]);

  const handleConnectNode = (miner) => {
    console.log("Miner connected:", miner);
    setMinerData(miner);
    setCurrentView('mempool');
  };

  const handleQuizStart = () => {
    setCurrentView('quiz');
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
          {/* Main Content Area */}
          <main className="relative z-10 flex flex-col items-center flex-grow px-6 pt-16 pb-32 max-w-lg mx-auto w-full">
            
            {/* Header */}
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

            {/* Rules/Steps Section */}
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

          {/* CTA Footer */}
          <footer className={`fixed bottom-0 left-0 w-full p-6 bg-gradient-to-t from-slate-950 via-slate-950/90 to-transparent z-20 flex justify-center opacity-0 ${mounted ? 'animate-fade-in' : ''}`} style={{ animationDelay: '1000ms' }}>
            <button 
              onClick={() => {
                if (minerData) {
                  setCurrentView('mempool');
                } else {
                  setCurrentView('signup');
                }
              }}
              className="w-full max-w-lg py-4 px-8 rounded-xl bg-gradient-to-r from-purple-700 to-purple-500 hover:from-purple-600 hover:to-purple-400 text-white font-bold text-lg tracking-wide transition-all duration-300 shadow-[0_0_20px_rgba(168,85,247,0.4)] hover:shadow-[0_0_30px_rgba(168,85,247,0.6)] animate-pulse-slow transform hover:-translate-y-1 border border-purple-400/50"
            >
              {minerData ? '[ RESUME SESSION ]' : '[ ENTER THE NETWORK ]'}
            </button>
          </footer>
        </>
      )}

      {currentView === 'signup' && (
        <Signup onConnect={handleConnectNode} />
      )}

      {currentView === 'mempool' && (
        <Mempool minerData={minerData} onQuizStart={handleQuizStart} />
      )}

      {currentView === 'quiz' && (
        <Quiz minerData={minerData} onComplete={() => console.log('Finished!')} />
      )}

    </div>
  );
}

export default App;

