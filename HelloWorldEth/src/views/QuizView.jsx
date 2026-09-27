import React, { useState, useEffect } from 'react';
import { getRoundQuestions, recordAttempt, submitRoundCompletion, markMinerCompletedInCache, hashAnswer } from '../utils/api';

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
  const [nonWinnerNotice, setNonWinnerNotice] = useState(null);

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

  // Timer: runs only while active and not finished and no winner declared yet
  useEffect(() => {
    if (loading || questions.length === 0 || currentIndex >= questions.length || completionResult || winnerInfo) return;

    const timer = setInterval(() => {
      setElapsedTime(prev => {
        const newTime = prev + 1;
        localStorage.setItem('pow_quiz_time', newTime.toString());
        return newTime;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [loading, questions.length, currentIndex, completionResult, winnerInfo]);

  // If another participant won while solving, display notice and transition
  useEffect(() => {
    if (winnerInfo && !completionResult?.isWinner) {
      const myReg = minerData?.registration_number || minerData?.regNo;
      const isMe = minerData && (
        (winnerInfo.regNo && (winnerInfo.regNo === myReg)) ||
        (winnerInfo.winner && winnerInfo.winner === minerData.name)
      );
      if (!isMe) {
        setNonWinnerNotice(`Block #${winnerInfo.blockIndex || 1} was mined by ${winnerInfo.winner} in ${winnerInfo.timeTaken}s!`);
        const t = setTimeout(() => {
          if (onComplete) {
            onComplete({ isWinner: false, winnerName: winnerInfo.winner, blockIndex: winnerInfo.blockIndex, timeTaken: winnerInfo.timeTaken });
          }
        }, 3000);
        return () => clearTimeout(t);
      }
    }
  }, [winnerInfo, completionResult, minerData, onComplete]);

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
          const myReg = minerData?.registration_number || minerData?.regNo;
          markMinerCompletedInCache(myReg);

          if (res.isWinner) {
            // Save victory receipt in sessionStorage so PageNull also recognizes the win
            try {
              sessionStorage.setItem('pow_win_receipt', JSON.stringify({
                isWinner: true,
                minerName: minerData?.name,
                regNo: myReg,
                blockIndex: res.blockIndex,
                timeTaken: elapsedTime
              }));
            } catch (_) {}

            // Broadcast block mined over active mempool channel to projector and peers
            if (sendBroadcast) {
              sendBroadcast('BLOCK_MINED', {
                winner: minerData?.name,
                regNo: myReg,
                timeTaken: elapsedTime,
                blockIndex: res.blockIndex,
                roundId: roundInfo?.round_id
              });
            }
            // DO NOT auto-redirect! Let winner view their celebration screen!
          } else {
            // Finished, but someone else claimed the block first
            setNonWinnerNotice(`All puzzles solved! However, another miner reached consensus first.`);
            setTimeout(() => {
              if (onComplete) {
                onComplete({ isWinner: false, blockIndex: res.blockIndex, timeTaken: elapsedTime });
              }
            }, 3000);
          }
        } catch (err) {
          console.error("Error finalizing block:", err);
          if (onComplete) {
            onComplete({ isWinner: false });
          }
        }
      }
      finalizeBlock();
    }
  }, [isFinished, completionResult, roundInfo, minerData, elapsedTime, sendBroadcast, onComplete]);

  const handleOptionClick = async (option) => {
    if (status !== 'idle' || !currentQ || winnerInfo || completionResult) return;
    
    setSelectedOption(option);

    // Cryptographic evaluation: compare salted hashes without exposing answer in cleartext
    const optionHash = await hashAnswer(currentQ.id, option);
    const isCorrect = optionHash === currentQ.answerHash;

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
          regNo: minerData?.registration_number || minerData?.regNo,
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

  const myReg = minerData?.registration_number || minerData?.regNo;
  const isMeWinner = Boolean(
    completionResult?.isWinner ||
    (winnerInfo && minerData && (
      (winnerInfo.regNo && winnerInfo.regNo === myReg) ||
      (winnerInfo.winner && winnerInfo.winner === minerData.name)
    ))
  );

  const displayBlockIndex = completionResult?.blockIndex || winnerInfo?.blockIndex || 1;
  const displaySolveTime = completionResult?.timeTaken || winnerInfo?.timeTaken || elapsedTime;

  // 1. WINNER CELEBRATION SCREEN
  if (isMeWinner) {
    return (
      <div className="relative z-20 flex flex-col items-center justify-center flex-grow px-4 w-full max-w-lg mx-auto text-center animate-fade-in py-12">
        <div className="relative mb-6">
          <div className="w-28 h-28 rounded-full bg-gradient-to-tr from-amber-400 via-yellow-300 to-amber-500 text-slate-950 flex items-center justify-center text-5xl shadow-[0_0_60px_rgba(245,158,11,0.9)] animate-bounce">
            🏆
          </div>
          <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 font-mono text-[10px] uppercase font-bold tracking-widest bg-emerald-950 text-emerald-300 border border-emerald-500/50 px-3 py-0.5 rounded-full whitespace-nowrap shadow-md">
            PROOF OF WORK VALIDATED
          </span>
        </div>

        <div className="font-mono text-xs uppercase tracking-widest text-amber-400 bg-amber-950/70 border border-amber-500/50 px-4 py-1.5 rounded-full mb-3 shadow-inner animate-pulse">
          ★ BLOCK #{displayBlockIndex} MINED! ★
        </div>

        <h1 className="text-4xl md:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-300 via-yellow-200 to-white mb-2">
          YOU WON!
        </h1>

        <p className="text-purple-200 text-sm max-w-sm mb-6 leading-relaxed">
          Congratulations <strong className="text-white font-bold">{minerData?.name}</strong>! You cracked the cryptographic challenge in <strong className="text-amber-300 font-mono font-bold">{displaySolveTime}s</strong>.
        </p>

        {/* Victory Telemetry Card */}
        <div className="w-full bg-slate-900/90 border-2 border-amber-500/50 rounded-2xl p-5 backdrop-blur-xl text-left font-mono text-xs flex flex-col gap-2.5 shadow-2xl mb-8">
          <div className="flex justify-between items-center text-purple-300/80">
            <span>MINER IDENTIFIER</span>
            <span className="text-white font-bold">{myReg}</span>
          </div>
          <div className="h-px bg-white/10 w-full"></div>
          <div className="flex justify-between items-center text-purple-300/80">
            <span>SOLVE TIME</span>
            <span className="text-emerald-400 font-bold">{displaySolveTime}s</span>
          </div>
          <div className="h-px bg-white/10 w-full"></div>
          <div className="flex justify-between items-center text-purple-300/80">
            <span>LEDGER POSITION</span>
            <span className="text-amber-400 font-bold">BLOCK #{displayBlockIndex} (1st Place)</span>
          </div>
          <div className="h-px bg-white/10 w-full"></div>
          <div className="flex justify-between items-center text-purple-300/80">
            <span>PRIZE CLAIM STATUS</span>
            <span className="text-fuchsia-400 font-bold animate-pulse">COLLECT STICKER AT STAGE</span>
          </div>
        </div>

        <button
          onClick={() => {
            const receipt = {
              isWinner: true,
              blockIndex: displayBlockIndex,
              timeTaken: displaySolveTime,
              minerName: minerData?.name,
              regNo: myReg
            };
            try {
              sessionStorage.setItem('pow_win_receipt', JSON.stringify(receipt));
            } catch (_) {}
            if (onComplete) {
              onComplete(receipt);
            }
          }}
          className="w-full py-4 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400 hover:from-amber-400 hover:to-yellow-300 text-slate-950 font-black text-sm tracking-wide transition-all shadow-[0_0_30px_rgba(245,158,11,0.5)] cursor-pointer active:scale-95"
        >
          [ SHOW VICTORY RECEIPT & DECOUPLE ]
        </button>
      </div>
    );
  }

  // 2. NON-WINNER NOTICE (WHEN ANOTHER PARTICIPANT WINS)
  if (nonWinnerNotice) {
    return (
      <div className="relative z-20 flex flex-col items-center justify-center flex-grow px-4 w-full max-w-md mx-auto text-center animate-fade-in py-12">
        <div className="w-16 h-16 rounded-full bg-purple-950/80 border border-purple-500/40 flex items-center justify-center text-3xl mb-4 shadow-lg animate-pulse">
          ⚡
        </div>
        <div className="font-mono text-xs uppercase tracking-widest text-fuchsia-400 bg-fuchsia-950/60 border border-fuchsia-700/40 px-3.5 py-1 rounded-full mb-3">
          CONSENSUS REACHED
        </div>
        <h2 className="text-2xl font-black text-white mb-2">Round Concluded</h2>
        <p className="text-purple-200/80 font-mono text-sm mb-6 leading-relaxed">
          {nonWinnerNotice}
        </p>
        <p className="text-purple-400/50 font-mono text-xs animate-pulse">
          Decoupling node and transferring to terminal...
        </p>
      </div>
    );
  }

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
    return `${m}:${s}`;
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
                  disabled={status !== 'idle' || Boolean(winnerInfo) || Boolean(completionResult)}
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
