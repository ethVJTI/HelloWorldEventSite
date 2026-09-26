import { supabase } from './supabase';

// In-Memory Cache for fast O(1) single-attempt checking (avoids spamming Postgres)
const completedMinersCache = new Set();
let cacheLoaded = false;
let cachePromise = null;

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
 * If none exists, creates a default one (useful for first-time setup).
 */
export async function getDefaultPool() {
  let { data: pool, error } = await supabase
    .from('pools')
    .select('*')
    .limit(1)
    .maybeSingle();

  if (!pool) {
    const { data: newPool, error: insertError } = await supabase
      .from('pools')
      .insert([{ name: 'ethVJTI Main Pool', admin_passcode: 'eth123' }])
      .select()
      .single();

    if (insertError) throw insertError;
    return newPool;
  }
  return pool;
}

export async function updatePoolMaxMiners(poolId, maxMiners) {
  const { data, error } = await supabase
    .from('pools')
    .update({ max_miners: maxMiners })
    .eq('id', poolId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Registers a miner with multi-layered caching to prevent Postgres query spikes.
 */
export async function registerMiner(poolId, name, regNo) {
  // Layer 1: Check fast in-memory & localStorage cache first (0 DB requests)
  if (isMinerCachedAsCompleted(regNo)) {
    throw new Error(`Registration number ${regNo} has already completed the mining quiz! Each candidate is allowed only one attempt.`);
  }

  // Server-side validation: must be 9 digits starting with 2
  const regNoRegex = /^2\d{8}$/;
  if (!regNoRegex.test(regNo)) {
    throw new Error("Registration number must be exactly 9 digits and start with 2 (e.g. 241080042).");
  }

  const { data: existingMiner } = await supabase
    .from('miners')
    .select('*')
    .eq('pool_id', poolId)
    .eq('registration_number', regNo)
    .maybeSingle();

  if (existingMiner) {
    // Check if this miner has already completed a round
    const { data: pastProgress } = await supabase
      .from('miner_round_progress')
      .select('round_id, questions_solved, finished_at')
      .eq('miner_id', existingMiner.id);

    const hasFinished = pastProgress?.some(p => p.finished_at || p.questions_solved >= 5);
    if (hasFinished) {
      markMinerCompletedInCache(regNo);
      throw new Error(`Registration number ${regNo} has already completed the mining quiz! Each candidate is allowed only one attempt.`);
    }

    return existingMiner;
  }

  const { data: newMiner, error } = await supabase
    .from('miners')
    .insert([
      { pool_id: poolId, name, registration_number: regNo }
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
 */
export async function getRoundQuestions(roundId) {
  let questions = [];

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
        questions = rqs
          .map(rq => {
            const q = qMap.get(rq.question_id);
            if (!q) return null;
            return {
              round_question_id: rq.id,
              id: q.id,
              prompt: q.prompt,
              options: q.options || [],
              answer: q.answer
            };
          })
          .filter(Boolean);
      }
    }
  }

  if (questions.length === 0) {
    const { data: directQs } = await supabase
      .from('questions')
      .select('id, prompt, options, answer')
      .eq('is_active', true)
      .limit(5);

    if (directQs && directQs.length > 0) {
      questions = directQs.map(q => ({
        id: q.id,
        prompt: q.prompt,
        options: q.options || [],
        answer: q.answer
      }));
    }
  }

  return questions.map(q => {
    let opts = Array.isArray(q.options) && q.options.length > 0 ? [...q.options] : [];
    if (opts.length === 0) {
      const ansNum = parseInt(q.answer, 10);
      if (!isNaN(ansNum)) {
        opts = [q.answer, (ansNum + 4).toString(), (ansNum - 3).toString(), (ansNum + 10).toString()];
      } else {
        opts = [q.answer, 'Option A', 'Option B', 'Option C'];
      }
      opts.sort(() => 0.5 - Math.random());
    }
    return { ...q, options: opts };
  });
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
 * 1. Updates miner_round_progress
 * 2. Checks if this miner is the 1st to finish (winner)
 * 3. Creates the block entry if they won
 */
export async function submitRoundCompletion({ roundId, minerId, poolId, elapsedTimeSeconds }) {
  if (!roundId || !minerId) return { isWinner: false };

  const timeTakenMs = (elapsedTimeSeconds || 0) * 1000;
  const now = new Date().toISOString();

  // 1. Record progress for this miner
  await supabase.from('miner_round_progress').upsert([{
    round_id: roundId,
    miner_id: minerId,
    questions_solved: 5,
    finished_at: now
  }], { onConflict: 'round_id,miner_id' });

  // 2. Check if a winner has already been declared for this round
  const { data: roundData } = await supabase
    .from('rounds')
    .select('id, block_index, winner_miner_id')
    .eq('id', roundId)
    .single();

  let isWinner = false;

  if (roundData && !roundData.winner_miner_id) {
    isWinner = true;

    await supabase
      .from('rounds')
      .update({
        winner_miner_id: minerId,
        status: 'completed',
        completed_at: now
      })
      .eq('id', roundId);

    const randomHex = Array.from({ length: 8 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    const displayHash = `0x0000${randomHex}89f2c1`;

    if (poolId) {
      await supabase.from('blocks').insert([{
        pool_id: poolId,
        round_id: roundId,
        block_index: roundData.block_index,
        miner_id: minerId,
        mined_at: now,
        time_taken_ms: timeTakenMs,
        display_hash: displayHash
      }]);
    }
  }

  return { isWinner, blockIndex: roundData?.block_index };
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
