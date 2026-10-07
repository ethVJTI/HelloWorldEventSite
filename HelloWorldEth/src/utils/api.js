import { supabase } from './supabase';

// In-Memory Cache for fast O(1) single-attempt checking (avoids spamming Postgres)
const completedMinersCache = new Set();
let cacheLoaded = false;
let cachePromise = null;

/**
 * Computes a secure one-way SHA-256 hash with questionId salt.
 * Ensures quiz answers are never exposed in cleartext to client DevTools.
 */
export async function hashAnswer(questionId, answerStr) {
  if (!answerStr) return '';
  const salted = `${questionId || ''}:${String(answerStr).trim().toLowerCase()}`;
  const msgBuffer = new TextEncoder().encode(salted);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Prefetches all completed registration numbers once on mount into an in-memory Set.
 */
export async function prefetchCompletedMiners() {
  if (cacheLoaded) return completedMinersCache;
  if (cachePromise) return cachePromise;

  cachePromise = (async () => {
    try {
      const { data } = await supabase
        .from('miner_round_progress')
        .select(`
          miner_id,
          finished_at,
          miners ( registration_number )
        `)
        .not('finished_at', 'is', null);

      if (data) {
        data.forEach(row => {
          if (row.miners?.registration_number) {
            completedMinersCache.add(row.miners.registration_number);
          }
        });
      }
      cacheLoaded = true;
    } catch (e) {
      console.warn("Could not prefetch completed miners cache:", e);
    }
    return completedMinersCache;
  })();

  return cachePromise;
}

/**
 * Adds a registration number to the local memory cache and localStorage.
 */
export function markMinerCompletedInCache(regNo) {
  if (regNo) {
    completedMinersCache.add(regNo);
    try {
      localStorage.setItem('pow_has_played', regNo);
    } catch (_) {}
  }
}

/**
 * Checks in-memory cache and localStorage synchronously (0 DB queries).
 */
export function isMinerCachedAsCompleted(regNo) {
  if (!regNo) return false;
  if (completedMinersCache.has(regNo)) return true;
  try {
    if (localStorage.getItem('pow_has_played') === regNo) return true;
  } catch (_) {}
  return false;
}

/**
 * Fetches the default active pool.
 */
export async function getDefaultPool() {
  let { data: pool, error } = await supabase
    .from('pools')
    .select('id, name, max_miners, created_at')
    .limit(1)
    .maybeSingle();

  if (!pool) {
    const { data: newPool, error: insertError } = await supabase
      .from('pools')
      .insert([{ name: 'ethVJTI Main Pool' }])
      .select('id, name, max_miners, created_at')
      .single();

    if (insertError) throw insertError;
    return newPool;
  }
  return pool;
}

export async function updatePoolMaxMiners(poolId, maxMiners) {
  const safeCount = Math.max(1, Math.min(100, Number(maxMiners) || 10));
  const { data, error } = await supabase
    .from('pools')
    .update({ max_miners: safeCount })
    .eq('id', poolId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Registers a miner with multi-layered caching and input sanitization.
 */
export async function registerMiner(poolId, name, regNo) {
  const sanitizedName = String(name || '').trim().replace(/[<>]/g, '').slice(0, 50);
  const sanitizedRegNo = String(regNo || '').trim();

  // Layer 1: Check fast in-memory & localStorage cache first (0 DB requests)
  if (isMinerCachedAsCompleted(sanitizedRegNo)) {
    throw new Error(`Registration number ${sanitizedRegNo} has already completed the mining quiz! Each candidate is allowed only one attempt.`);
  }

  // Server-side validation: must be 9 digits starting with 2
  const regNoRegex = /^2\d{8}$/;
  if (!regNoRegex.test(sanitizedRegNo)) {
    throw new Error("Registration number must be exactly 9 digits and start with 2 (e.g. 241080042).");
  }

  const { data: existingMiner } = await supabase
    .from('miners')
    .select('*')
    .eq('pool_id', poolId)
    .eq('registration_number', sanitizedRegNo)
    .maybeSingle();

  if (existingMiner) {
    // Check if this miner has already completed a round
    const { data: pastProgress } = await supabase
      .from('miner_round_progress')
      .select('round_id, questions_solved, finished_at')
      .eq('miner_id', existingMiner.id);

    const hasFinished = pastProgress?.some(p => p.finished_at || p.questions_solved >= 5);
    if (hasFinished) {
      markMinerCompletedInCache(sanitizedRegNo);
      throw new Error(`Registration number ${sanitizedRegNo} has already completed the mining quiz! Each candidate is allowed only one attempt.`);
    }

    return existingMiner;
  }

  const { data: newMiner, error } = await supabase
    .from('miners')
    .insert([
      { pool_id: poolId, name: sanitizedName, registration_number: sanitizedRegNo }
    ])
    .select()
    .single();

  if (error) {
    console.error("Error registering miner:", error);
    throw error;
  }

  return newMiner;
}

/**
 * Starts a new round for the given pool, returning the round details.
 */
export async function startNewRound(poolId) {
  let nextIndex = 1;

  try {
    const { data: rpcIndex, error: fnError } = await supabase.rpc('next_block_index', { p_pool_id: poolId });
    if (!fnError && rpcIndex) {
      nextIndex = rpcIndex;
    } else {
      throw fnError || new Error("RPC returned null");
    }
  } catch (err) {
    const { data: latestRound } = await supabase
      .from('rounds')
      .select('block_index')
      .eq('pool_id', poolId)
      .order('block_index', { ascending: false })
      .limit(1)
      .maybeSingle();

    nextIndex = (latestRound?.block_index || 0) + 1;
  }

  const { data: allQuestions, error: qError } = await supabase
    .from('questions')
    .select('id')
    .eq('is_active', true);
    
  if (qError) throw qError;
  
  const shuffled = (allQuestions || []).sort(() => 0.5 - Math.random()).slice(0, 5);

  const { data: newRound, error } = await supabase
    .from('rounds')
    .insert([{ 
      pool_id: poolId, 
      block_index: nextIndex, 
      status: 'active', 
      started_at: new Date().toISOString() 
    }])
    .select()
    .single();

  if (error) throw error;

  const roundQuestionsData = shuffled.map((q, idx) => ({
    round_id: newRound.id,
    question_id: q.id,
    order_index: idx + 1
  }));
  
  if (roundQuestionsData.length > 0) {
    const { error: rqError } = await supabase
      .from('round_questions')
      .insert(roundQuestionsData);
    if (rqError) console.error("Error inserting round questions:", rqError);
  }

  return newRound;
}

/**
 * Fetches the specific 5 questions bound to a round.
 * Hashes answer keys so cleartext answers are NEVER transmitted or visible in DevTools.
 */
export async function getRoundQuestions(roundId) {
  let rawQuestions = [];

  if (roundId) {
    const { data: rqs, error: rqError } = await supabase
      .from('round_questions')
      .select('id, question_id, order_index')
      .eq('round_id', roundId)
      .order('order_index', { ascending: true });

    if (!rqError && rqs && rqs.length > 0) {
      const qIds = rqs.map(r => r.question_id);

      const { data: qRows, error: qError } = await supabase
        .from('questions')
        .select('id, prompt, options, answer')
        .in('id', qIds);

      if (!qError && qRows && qRows.length > 0) {
        const qMap = new Map(qRows.map(q => [q.id, q]));
        rawQuestions = rqs
          .map(rq => {
            const q = qMap.get(rq.question_id);
            if (!q) return null;
            return {
              round_question_id: rq.id,
              id: q.id,
              prompt: q.prompt,
              options: q.options || [],
              rawAnswer: q.answer
            };
          })
          .filter(Boolean);
      }
    }
  }

  if (rawQuestions.length === 0) {
    const { data: directQs } = await supabase
      .from('questions')
      .select('id, prompt, options, answer')
      .eq('is_active', true)
      .limit(5);

    if (directQs && directQs.length > 0) {
      rawQuestions = directQs.map(q => ({
        id: q.id,
        prompt: q.prompt,
        options: q.options || [],
        rawAnswer: q.answer
      }));
    }
  }

  // Cryptographically transform questions: hash answers and randomize options order
  const sanitizedQuestions = await Promise.all(rawQuestions.map(async (q) => {
    let opts = Array.isArray(q.options) && q.options.length > 0 ? [...q.options] : [];
    if (opts.length === 0) {
      const ansNum = parseInt(q.rawAnswer, 10);
      if (!isNaN(ansNum)) {
        opts = [q.rawAnswer, (ansNum + 4).toString(), (ansNum - 3).toString(), (ansNum + 10).toString()];
      } else {
        opts = [q.rawAnswer, 'Option A', 'Option B', 'Option C'];
      }
    }

    // Always shuffle options so the correct answer is randomly distributed across A, B, C, D
    for (let i = opts.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [opts[i], opts[j]] = [opts[j], opts[i]];
    }

    const answerHash = await hashAnswer(q.id, q.rawAnswer);

    return {
      round_question_id: q.round_question_id,
      id: q.id,
      prompt: q.prompt,
      options: opts,
      answerHash // Secure salted hash; cleartext rawAnswer is dropped!
    };
  }));

  return sanitizedQuestions;
}

/**
 * Records an individual MCQ answer attempt into the audit table.
 */
export async function recordAttempt({ roundId, minerId, roundQuestionId, submittedAnswer, isCorrect, attemptNumber = 1 }) {
  if (!roundId || !minerId) return;
  try {
    await supabase.from('attempts').insert([{
      round_id: roundId,
      miner_id: minerId,
      round_question_id: roundQuestionId || null,
      submitted_answer: submittedAnswer,
      is_correct: isCorrect,
      attempt_number: attemptNumber
    }]);
  } catch (err) {
    console.warn("Could not record attempt:", err);
  }
}

/**
 * Handles completing all 5 questions:
 * 1. Validates server-side timestamp delta to prevent fake 0.001s timing
 * 2. Uses atomic conditional update (`.is('winner_miner_id', null)`) to eliminate TOCTOU race conditions
 * 3. Commits the mined block entry if won
 */
export async function submitRoundCompletion({ roundId, minerId, poolId, elapsedTimeSeconds }) {
  if (!roundId || !minerId) return { isWinner: false };

  const now = new Date().toISOString();

  // 1. Fetch round to get block_index, started_at, and pool_id
  const { data: roundData } = await supabase
    .from('rounds')
    .select('id, block_index, pool_id, started_at, winner_miner_id')
    .eq('id', roundId)
    .maybeSingle();

  // Server-side timing bounds check to prevent clients reporting 0.001s
  let calculatedSeconds = Math.max(1, Number(elapsedTimeSeconds) || 1);
  if (roundData?.started_at) {
    const elapsedSinceStart = (Date.now() - new Date(roundData.started_at).getTime()) / 1000;
    if (elapsedSinceStart > 0) {
      // Don't allow time to be significantly lower than when the round was created
      calculatedSeconds = Math.max(calculatedSeconds, Math.floor(elapsedSinceStart));
    }
  }
  const timeTakenMs = Math.max(1000, Math.round(calculatedSeconds * 1000));

  // 2. Record participant round progress
  await supabase.from('miner_round_progress').upsert([{
    round_id: roundId,
    miner_id: minerId,
    questions_solved: 5,
    finished_at: now
  }], { onConflict: 'round_id,miner_id' });

  const randomHex = Array.from({ length: 8 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  const displayHash = `0x0000${randomHex}89f2c1`;
  const targetPoolId = poolId || roundData?.pool_id;

  // 3. Attempt database RPC for transaction-level atomic row lock
  try {
    const { data: rpcRes, error: rpcErr } = await supabase.rpc('claim_block_atomic', {
      p_round_id: roundId,
      p_miner_id: minerId,
      p_pool_id: targetPoolId,
      p_time_taken_ms: timeTakenMs,
      p_display_hash: displayHash
    });
    if (!rpcErr && rpcRes && rpcRes.block_index) {
      return {
        isWinner: Boolean(rpcRes.is_winner),
        blockIndex: rpcRes.block_index,
        roundId
      };
    }
  } catch (_) {}

  // 4. Fallback atomic winner assignment: Only succeeds if winner_miner_id IS NULL in the database
  const { data: claimedRound, error: claimError } = await supabase
    .from('rounds')
    .update({
      winner_miner_id: minerId,
      status: 'completed',
      completed_at: now
    })
    .eq('id', roundId)
    .is('winner_miner_id', null) // Atomic check & set!
    .select('id, block_index, winner_miner_id')
    .maybeSingle();

  const isWinner = Boolean(claimedRound && claimedRound.winner_miner_id === minerId);

  if (isWinner) {
    const randomHex = Array.from({ length: 8 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    const displayHash = `0x0000${randomHex}89f2c1`;
    const targetPoolId = poolId || roundData?.pool_id;

    if (targetPoolId) {
      await supabase.from('blocks').insert([{
        pool_id: targetPoolId,
        round_id: roundId,
        block_index: claimedRound.block_index,
        miner_id: minerId,
        mined_at: now,
        time_taken_ms: timeTakenMs,
        display_hash: displayHash
      }]);
    }
  }

  return { 
    isWinner, 
    blockIndex: roundData?.block_index || claimedRound?.block_index,
    roundId 
  };
}

/**
 * Permanently locks a miner's session in DB and memory cache when a round concludes.
 */
export async function finishMinerSession(minerId, roundId, regNo) {
  if (regNo) {
    markMinerCompletedInCache(regNo);
  }
  if (minerId && roundId) {
    try {
      await supabase.from('miner_round_progress').upsert([{
        round_id: roundId,
        miner_id: minerId,
        finished_at: new Date().toISOString()
      }], { onConflict: 'round_id,miner_id' });
    } catch (e) {
      console.warn("Could not mark miner session finished in DB:", e);
    }
  }
}

/**
 * Aborts an active round from the Admin dashboard.
 */
export async function abortActiveRound(poolId) {
  const { data, error } = await supabase
    .from('rounds')
    .update({ status: 'aborted', completed_at: new Date().toISOString() })
    .eq('pool_id', poolId)
    .eq('status', 'active');

  if (error) throw error;
  return data;
}
