import React, { useState, useEffect } from 'react';
import { getRoundQuestions } from './utils/api';

export default function Quiz({ minerData, onComplete }) {
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(true);

  const [currentIndex, setCurrentIndex] = useState(() => {
    return parseInt(localStorage.getItem('pow_quiz_index') || '0', 10);
  });
  const [elapsedTime, setElapsedTime] = useState(() => {
    return parseInt(localStorage.getItem('pow_quiz_time') || '0', 10);
  });
  
  const [status, setStatus] = useState('idle'); // 'idle' | 'correct' | 'wrong'
  const [selectedOption, setSelectedOption] = useState(null);
  const [penaltyFlash, setPenaltyFlash] = useState(false);

  // Load questions for the current round
  useEffect(() => {
    async function loadQuestions() {
      const roundData = JSON.parse(localStorage.getItem('pow_current_round') || '{}');
      if (roundData.round_id) {
        try {
          const qs = await getRoundQuestions(roundData.round_id);
          setQuestions(qs);
        } catch (err) {
          console.error("Failed to load questions:", err);
        }
      }
      setLoading(false);
    }
    loadQuestions();
  }, []);

  // Sync index
  useEffect(() => {
    localStorage.setItem('pow_quiz_index', currentIndex.toString());
  }, [currentIndex]);

  // Timer
  useEffect(() => {
    if (loading || questions.length === 0 || currentIndex >= questions.length) return;

    const timer = setInterval(() => {
      setElapsedTime(prev => {
        const newTime = prev + 1;
        localStorage.setItem('pow_quiz_time', newTime.toString());
        return newTime;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [loading, questions.length, currentIndex]);

  const currentQ = questions[currentIndex];
  const isFinished = questions.length > 0 && currentIndex >= questions.length;

  useEffect(() => {
    if (isFinished && onComplete) {
      onComplete();
    }
  }, [isFinished, onComplete]);

  const handleOptionClick = (option) => {
    if (status !== 'idle' || !currentQ) return;
    
    setSelectedOption(option);
    const isCorrect = option === currentQ.answer;

    if (isCorrect) {
      setStatus('correct');
      setTimeout(() => {
        setStatus('idle');
        setSelectedOption(null);
        setCurrentIndex(prev => prev + 1);
      }, 800);
    } else {
      setStatus('wrong');
      
      // Apply 5 second penalty and instantly sync to storage
      setElapsedTime(prev => {
        const newTime = prev + 5;
        localStorage.setItem('pow_quiz_time', newTime.toString());
        return newTime;
      });
      
      // Trigger penalty visual flash on the timer
      setPenaltyFlash(true);
      setTimeout(() => setPenaltyFlash(false), 1000);

      setTimeout(() => {
        setStatus('idle');
        setSelectedOption(null);
      }, 800);
    }
  };

  if (loading) {
    return (
      <div className="relative z-10 flex flex-col items-center justify-center min-h-screen text-fuchsia-400 font-mono animate-pulse">
        Fetching blocks...
      </div>
    );
  }

  if (questions.length === 0) {
    return (
      <div className="relative z-10 flex flex-col items-center justify-center min-h-screen text-red-400 font-mono">
        Error: No questions found for this block.
      </div>
    );
  }

  if (isFinished) {
    return (
      <div className="relative z-10 flex flex-col items-center justify-center flex-grow w-full min-h-screen animate-fade-in text-center">
        <div className="text-6xl mb-4">🏆</div>
        <h2 className="text-3xl font-bold text-white mb-2">Block Mined!</h2>
        <p className="text-purple-300 font-mono">Syncing to network...</p>
      </div>
    );
  }

  // Format time (MM:SS)
  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return m + ':' + s;
  };

  return (
    <div className="relative z-10 flex flex-col items-center justify-center flex-grow px-4 w-full max-w-3xl mx-auto min-h-[80vh]">
      
      {/* Top Bar */}
      <div className="w-full flex justify-between items-center mb-6 px-2">
        <div className="flex items-center gap-3">
          <div className="w-3 h-3 rounded-full bg-fuchsia-500 animate-pulse"></div>
          <span className="font-mono text-fuchsia-300 font-semibold tracking-wider text-sm">MINING_ACTIVE</span>
        </div>
        <div className="flex flex-col items-end">
          <div className={`font-mono text-xl font-bold px-4 py-1 rounded-lg border shadow-inner transition-colors ${
            penaltyFlash ? 'bg-red-900/80 text-red-300 border-red-500 animate-pulse' : 'text-purple-200 bg-slate-900/80 border-purple-500/30'
          }`}>
            {formatTime(elapsedTime)}
          </div>
          {penaltyFlash && <span className="text-red-400 text-xs font-bold absolute mt-10">+5s PENALTY</span>}
        </div>
      </div>

      {/* Progress Bar */}
      <div className="w-full mb-8">
        <div className="flex justify-between text-xs font-bold text-purple-300 mb-2 uppercase tracking-widest px-1">
          <span>Block Progress</span>
          <span>{currentIndex} / {questions.length} Solved</span>
        </div>
        <div className="h-2 w-full bg-slate-900 rounded-full overflow-hidden border border-purple-900/50 shadow-inner">
          <div 
            className="h-full bg-gradient-to-r from-purple-600 to-fuchsia-500 transition-all duration-500 ease-out shadow-[0_0_10px_rgba(217,70,239,0.8)]"
            style={{ width: ((currentIndex / questions.length) * 100) + '%' }}
          ></div>
        </div>
      </div>

      {/* Terminal UI */}
      <div className={`w-full bg-slate-950 rounded-2xl border transition-colors duration-300 shadow-2xl overflow-hidden ${
        status === 'correct' ? 'border-green-500 shadow-[0_0_30px_rgba(34,197,94,0.3)]' :
        status === 'wrong' ? 'border-red-500 shadow-[0_0_30px_rgba(239,68,68,0.3)] animate-shake' :
        'border-purple-700/50'
      }`}>
        
        {/* Terminal Header */}
        <div className="bg-slate-900 px-4 py-3 border-b border-white/5 flex gap-2">
          <div className="w-3 h-3 rounded-full bg-red-500/80"></div>
          <div className="w-3 h-3 rounded-full bg-yellow-500/80"></div>
          <div className="w-3 h-3 rounded-full bg-green-500/80"></div>
        </div>

        <div className="p-6 md:p-8">
          <div className="text-purple-400 font-mono text-xs mb-4 uppercase tracking-widest opacity-70">
            Incoming Task [Hash: 0x{currentQ.id.toString().substring(0, 8)}...]
          </div>
          
          <h3 className="text-xl md:text-2xl font-bold text-white mb-8 leading-relaxed">
            {currentQ.prompt}
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {currentQ.options.map((option, idx) => {
              const isSelected = selectedOption === option;
              let btnClass = "bg-slate-900 border-purple-800/50 text-purple-200 hover:border-fuchsia-500 hover:bg-slate-800";
              
              if (isSelected) {
                if (status === 'correct') {
                  btnClass = "bg-green-900/30 border-green-500 text-green-300 shadow-[0_0_15px_rgba(34,197,94,0.4)]";
                } else if (status === 'wrong') {
                  btnClass = "bg-red-900/30 border-red-500 text-red-300 shadow-[0_0_15px_rgba(239,68,68,0.4)]";
                } else {
                  btnClass = "bg-fuchsia-900/30 border-fuchsia-500 text-white";
                }
              }

              return (
                <button
                  key={idx}
                  onClick={() => handleOptionClick(option)}
                  disabled={status !== 'idle'}
                  className={`w-full flex items-center justify-start p-5 rounded-xl border-2 font-mono text-left transition-all duration-200 ${btnClass}`}
                >
                  <span className="text-fuchsia-500 mr-3 opacity-60">[{String.fromCharCode(65 + idx)}]</span>
                  {option}
                </button>
              );
            })}
          </div>

        </div>
      </div>

    </div>
  );
}
