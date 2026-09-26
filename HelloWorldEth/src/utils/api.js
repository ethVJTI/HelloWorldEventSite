import { supabase } from './supabase';

/**
 * Fetches the default active pool.
 * If none exists, creates a default one (useful for first-time setup).
 */
export async function getDefaultPool() {
  let { data: pool, error } = await supabase
    .from('pools')
    .select('*')
    .limit(1)
    .maybeSingle(); // Prevents 406 Not Acceptable if 0 rows exist

  if (!pool) {
    // Create a default pool if the table is empty
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
 * Registers a miner or fetches their existing session if already registered.
 */
export async function registerMiner(poolId, name, regNo) {
  // First, check if miner already exists for this pool and regNo
  const { data: existingMiner } = await supabase
    .from('miners')
    .select('*')
    .eq('pool_id', poolId)
    .eq('registration_number', regNo)
    .maybeSingle(); // Prevents 406 Not Acceptable if they haven't registered yet

  if (existingMiner) {
    return existingMiner;
  }

  // Otherwise, insert new miner
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
  // 1. Get next block index using the postgres function
  const { data: nextIndex, error: fnError } = await supabase.rpc('next_block_index', { p_pool_id: poolId });
  if (fnError) throw fnError;

  // 2. Fetch active questions to randomly pick 5
  const { data: allQuestions, error: qError } = await supabase
    .from('questions')
    .select('id')
    .eq('is_active', true);
    
  if (qError) throw qError;
  
  // Shuffle and pick 5
  const shuffled = (allQuestions || []).sort(() => 0.5 - Math.random()).slice(0, 5);

  // 3. Insert new round
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

  // 4. Bind the 5 questions to this specific round
  const roundQuestionsData = shuffled.map((q, idx) => ({
    round_id: newRound.id,
    question_id: q.id,
    order_index: idx + 1
  }));
  
  if (roundQuestionsData.length > 0) {
    const { error: rqError } = await supabase
      .from('round_questions')
      .insert(roundQuestionsData);
    if (rqError) throw rqError;
  }

  return newRound;
}

/**
 * Fetches the specific 5 questions bound to a round.
 * Uses robust two-step lookup to avoid fragile Foreign Key join requirements.
 */
export async function getRoundQuestions(roundId) {
  let questions = [];

  if (roundId) {
    // Step 1: Get the list of question_ids for this round
    const { data: rqs, error: rqError } = await supabase
      .from('round_questions')
      .select('id, question_id, order_index')
      .eq('round_id', roundId)
      .order('order_index', { ascending: true });

    if (!rqError && rqs && rqs.length > 0) {
      const qIds = rqs.map(r => r.question_id);

      // Step 2: Fetch the actual question records
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

  // Fallback: If this round has 0 questions bound, fetch 5 active questions directly!
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

  // Guarantee every question has 4 valid options for the MCQ buttons
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
