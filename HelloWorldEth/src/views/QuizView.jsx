import React, { useState, useEffect } from 'react';
import { getRoundQuestions, recordAttempt, submitRoundCompletion, markMinerCompletedInCache } from '../utils/api';

export default function QuizView({ minerData, sendBroadcast, winnerInfo, onReturnToMempool, onComplete }) {
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [roundInfo, setRoundInfo] = useState(null);

  const [currentIndex, setCurrentIndex] = useState(() => {
    return parseInt(localStorage.getItem('pow_quiz_index') || '0', 10);
  });
  const [elapsedTime, setElapsedTime] = useState(() => {
    return parseInt(localStorage.getItem('pow_quiz_time') || '0', 10);
  });
  
  const [status, setStatus] = useState('idle'); // 'idle' | 'correct' | 'wrong'
  const [selectedOption, setSelectedOption] = useState(null);
  const [penaltyFlash, setPenaltyFlash] = useState(false);
  const [completionResult, setCompletionResult] = useState(null);

  // Load questions for the active round
  useEffect(() => {
    async function loadQuestions() {
      try {
        const roundData = JSON.parse(localStorage.getItem('pow_current_round') || '{}');
        setRoundInfo(roundData);
        const qs = await getRoundQuestions(roundData?.round_id);
        setQuestions(qs);
      } catch (err) {
        console.error("Failed to load questions:", err);
      } finally {
        setLoading(false);
      }
    }
    loadQuestions();
  }, []);

  // Sync current question index to storage
  useEffect(() => {
    localStorage.setItem('pow_quiz_index', currentIndex.toString());
  }, [currentIndex]);

  // Timer: runs only while active and not finished and no winner yet
  useEffect(() => {
    if (loading || questions.length === 0 || currentIndex >= questions.length || winnerInfo) return;

    const timer = setInterval(() => {
      setElapsedTime(prev => {
        const newTime = prev + 1;
        localStorage.setItem('pow_quiz_time', newTime.toString());
        return newTime;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [loading, questions.length, currentIndex, winnerInfo]);

  // If another participant won while solving, immediately exit quiz
  useEffect(() => {
    if (winnerInfo && onComplete) {
      onComplete();
    }
  }, [winnerInfo, onComplete]);

  const currentQ = questions[currentIndex];
  const isFinished = questions.length > 0 && currentIndex >= questions.length;

  // Handle block completion & winner check
  useEffect(() => {
    if (isFinished && !completionResult) {
      async function finalizeBlock() {
        try {
          const res = await submitRoundCompletion({
            roundId: roundInfo?.round_id,
            minerId: minerData?.id,
            poolId: minerData?.pool_id,
            elapsedTimeSeconds: elapsedTime
          });
          setCompletionResult(res);
          markMinerCompletedInCache(minerData?.registration_number);

          // Broadcast block mined over active mempool channel if this miner won
          if (res.isWinner && sendBroadcast) {
            sendBroadcast('BLOCK_MINED', {
              winner: minerData?.name,
              timeTaken: elapsedTime,
              blockIndex: res.blockIndex
            });
          }

          // Immediately redirect this participant to Page Null
          if (onComplete) {
            onComplete();
          }
        } catch (err) {
          console.error("Error finalizing block:", err);
          if (onComplete) {
            onComplete();
          }
        }
      }
      finalizeBlock();
    }
  }, [isFinished, completionResult, roundInfo, minerData, elapsedTime, sendBroadcast, onComplete]);

  const handleOptionClick = (option) => {
    if (status !== 'idle' || !currentQ || winnerInfo) return;
    
    setSelectedOption(option);
    const isCorrect = option === currentQ.answer;

    // Record attempt in database audit
    recordAttempt({
      roundId: roundInfo?.round_id,
      minerId: minerData?.id,
      roundQuestionId: currentQ.round_question_id,
      submittedAnswer: option,
      isCorrect
    });

    if (isCorrect) {
      setStatus('correct');
      const nextCount = currentIndex + 1;

      // Broadcast live progress for the Projector / Display Board racetrack
      if (sendBroadcast) {
        sendBroadcast('MINER_PROGRESS', {
          miner_id: minerData?.id,
          regNo: minerData?.registration_number,
          miner_name: minerData?.name,
          questions_solved: nextCount
        });
      }

      setTimeout(() => {
        setStatus('idle');
        setSelectedOption(null);
        setCurrentIndex(prev => prev + 1);
      }, 800);
    } else {
      setStatus('wrong');
      
      // Apply 5 second penalty and sync to storage
      setElapsedTime(prev => {
        const newTime = prev + 5;
        localStorage.setItem('pow_quiz_time', newTime.toString());
        return newTime;
      });
      
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
          <span className="w-3 h-3 rounded-full bg-emerald-500 animate-ping"></span>
          <span className="font-mono text-xs uppercase tracking-widest text-emerald-400">Block Mining Active</span>
        </div>
        
        {/* Timer */}
        <div className={`font-mono text-xl font-bold px-4 py-1.5 rounded-xl border transition-all ${
          penaltyFlash 
            ? 'bg-red-500/20 text-red-400 border-red-500/50 scale-110 shadow-[0_0_15px_rgba(239,68,68,0.5)]' 
            : 'bg-slate-900/60 text-purple-300 border-purple-800/40'
        }`}>
          ⏱️ {formatTime(elapsedTime)}
          {penaltyFlash && <span className="text-xs ml-1 text-red-400 animate-pulse">+5s</span>}
        </div>
      </div>

      {/* Progress Dots */}
      <div className="w-full flex gap-2 mb-8 px-2">
        {questions.map((_, i) => (
          <div 
            key={i} 
            className={`h-2 flex-grow rounded-full transition-all duration-300 ${
              i < currentIndex 
                ? 'bg-fuchsia-500 shadow-[0_0_10px_rgba(217,70,239,0.5)]' 
                : i === currentIndex 
                  ? 'bg-purple-500 animate-pulse' 
                  : 'bg-slate-800 border border-white/5'
            }`}
          />
        ))}
      </div>

      {/* Question Card */}
      {currentQ && (
        <div className="w-full bg-slate-900/60 p-6 md:p-8 rounded-3xl border border-purple-900/50 backdrop-blur-md shadow-2xl animate-fade-in relative overflow-hidden">
          
          <div className="flex justify-between items-center text-xs font-mono text-purple-400/60 mb-4 uppercase tracking-wider">
            <span>Puzzle {currentIndex + 1} of {questions.length}</span>
            <span>Proof-of-Work Challenge</span>
          </div>

          <h3 className="text-xl md:text-2xl font-bold text-white mb-8 leading-snug">
            {currentQ.prompt}
          </h3>

          {/* Options */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {currentQ.options.map((option, idx) => {
              const isSelected = selectedOption === option;
              let btnStyle = "bg-slate-950/60 border-purple-800/40 text-purple-100 hover:border-purple-500 hover:bg-purple-950/30";

              if (isSelected) {
                if (status === 'correct') {
                  btnStyle = "bg-emerald-500/20 border-emerald-500 text-emerald-300 shadow-[0_0_20px_rgba(168,85,129,0.4)]";
                } else if (status === 'wrong') {
                  btnStyle = "bg-red-500/20 border-red-500 text-red-300 shadow-[0_0_20px_rgba(239,68,68,0.4)] animate-shake";
                }
              }

              return (
                <button
                  key={idx}
                  onClick={() => handleOptionClick(option)}
                  disabled={status !== 'idle' || Boolean(winnerInfo)}
                  className={`p-4 rounded-xl border text-left font-medium transition-all duration-200 cursor-pointer flex items-center justify-between group ${btnStyle}`}
                >
                  <span className="text-sm md:text-base leading-relaxed">{option}</span>
                  <span className="text-xs font-mono opacity-40 group-hover:opacity-100 transition-opacity ml-2">
                    [{String.fromCharCode(65 + idx)}]
                  </span>
                </button>
              );
            })}
          </div>

        </div>
      )}

    </div>
  );
}
