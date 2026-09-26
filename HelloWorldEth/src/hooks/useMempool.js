import { useEffect, useState, useRef } from 'react';
import { supabase } from '../utils/supabase';
import { getDefaultPool } from '../utils/api';

export function useMempool(minerInput, unusedRegNo, isAdmin = false, isPassive = false) {
  // Normalize input: supports either minerData object { name, registration_number, id } or (name, regNo)
  let minerName = null;
  let regNo = null;
  let minerId = null;

  if (minerInput && typeof minerInput === 'object') {
    minerName = minerInput.name;
    regNo = minerInput.registration_number || minerInput.regNo;
    minerId = minerInput.id;
  } else if (typeof minerInput === 'string') {
    minerName = minerInput;
    regNo = unusedRegNo;
  }

  const [miners, setMiners] = useState([]);
  const [gameState, setGameState] = useState('waiting');
  const [winnerInfo, setWinnerInfo] = useState(null);
  const [channelInstance, setChannelInstance] = useState(null);
  const [poolConfig, setPoolConfig] = useState({ maxMiners: 10 });

  const isSubscribedRef = useRef(false);
  const minerDataRef = useRef({ minerName, regNo, minerId });

  useEffect(() => {
    minerDataRef.current = { minerName, regNo, minerId };
  }, [minerName, regNo, minerId]);

  // 1. Initial Data Fetch: Pool config AND only active, UNFINISHED miners from database
  useEffect(() => {
    getDefaultPool().then(async (pool) => {
      if (pool) {
        if (pool.max_miners) {
          setPoolConfig(prev => ({ ...prev, maxMiners: pool.max_miners }));
        }

        // Hydrate only candidates who have NOT completed any round yet
        try {
          const { data: finishedProgress } = await supabase
            .from('miner_round_progress')
            .select('miner_id')
            .not('finished_at', 'is', null);

          const finishedIds = new Set((finishedProgress || []).map(p => p.miner_id));

          const { data: dbMiners } = await supabase
            .from('miners')
            .select('id, name, registration_number')
            .eq('pool_id', pool.id)
            .order('created_at', { ascending: false })
            .limit(pool.max_miners || 50);

          if (dbMiners && dbMiners.length > 0) {
            const activeMiners = dbMiners
              .filter(m => !finishedIds.has(m.id))
              .map(m => ({
                id: m.id,
                name: m.name,
                regNo: m.registration_number
              }));

            if (activeMiners.length > 0) {
              setMiners(activeMiners);
            }
          }
        } catch (dbErr) {
          console.warn("Could not hydrate miners from DB:", dbErr);
        }
      }
    }).catch(console.error);
  }, []);

  // 2. Realtime WebSocket Subscription (single persistent channel per hook)
  useEffect(() => {
    // Safety: clean up any existing channel with the same topic to avoid duplicate callback error
    const existing = supabase.getChannels().find(ch => ch.topic === 'realtime:pow_mempool');
    if (existing) {
      supabase.removeChannel(existing);
    }

    const presenceKey = isAdmin ? 'admin' : (minerDataRef.current.regNo || 'passive_' + Math.random().toString(36).slice(2, 9));

    const channel = supabase.channel('pow_mempool', {
      config: {
        broadcast: {
          self: true, // Echo broadcasts back to self so winner also receives BLOCK_MINED
        },
        presence: {
          key: presenceKey,
        },
      },
    });

    setChannelInstance(channel);

    channel
      // Presence Sync: Authoritative real-time list of currently connected active nodes
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        let foundAdminConfig = null;

        const presenceMiners = Object.values(state)
          .map((userPresence) => userPresence[0])
          .filter(m => {
            if (m.role === 'admin' || m.role === 'display') {
              if (m.role === 'admin') foundAdminConfig = m;
              return false;
            }
            return Boolean(m.name && m.regNo);
          });

        const map = new Map();
        presenceMiners.forEach(m => map.set(m.regNo || m.id, {
          id: m.id,
          name: m.name,
          regNo: m.regNo
        }));

        // Keep local miner in list if actively authenticated
        const cur = minerDataRef.current;
        if (cur?.minerName && cur?.regNo) {
          map.set(cur.regNo || cur.minerId, {
            id: cur.minerId,
            name: cur.minerName,
            regNo: cur.regNo
          });
        }

        setMiners(Array.from(map.values()));

        if (foundAdminConfig && foundAdminConfig.maxMiners) {
          setPoolConfig(prev => ({ ...prev, maxMiners: foundAdminConfig.maxMiners }));
        }
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
      .on('broadcast', { event: 'START_QUIZ' }, (payload) => {
        console.log('Transaction Broadcasted! Quiz starting...', payload);
        if (payload.payload?.round_id) {
          localStorage.setItem('pow_current_round', JSON.stringify(payload.payload));
        }
        localStorage.setItem('pow_quiz_index', '0');
        localStorage.setItem('pow_quiz_time', '0');
        setWinnerInfo(null);
        setGameState('quiz_started');
      })
      .on('broadcast', { event: 'BLOCK_MINED' }, (payload) => {
        console.log('Block mined broadcast received:', payload.payload);
        setWinnerInfo(payload.payload);
        setGameState('block_found');
        // Clear active mempool list since this round's participants have concluded
        setMiners([]);
      })
      .on('broadcast', { event: 'ABORT_ROUND' }, () => {
        console.log('Active round aborted by admin.');
        localStorage.removeItem('pow_current_round');
        localStorage.removeItem('pow_quiz_index');
        localStorage.removeItem('pow_quiz_time');
        setWinnerInfo(null);
        setGameState('waiting');
      });

    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        isSubscribedRef.current = true;
        if (isAdmin) {
          await channel.track({
            role: 'admin',
            maxMiners: poolConfig.maxMiners,
          });
        } else {
          const cur = minerDataRef.current;
          if (cur.minerName && cur.regNo) {
            await channel.track({
              id: cur.minerId,
              name: cur.minerName,
              regNo: cur.regNo,
              joinedAt: new Date().toISOString(),
            });
          }
        }
      }
    });

    return () => {
      isSubscribedRef.current = false;
      supabase.removeChannel(channel);
    };
  }, [isAdmin]);

  // 3. Dynamic Presence Tracking: track or UNTRACK presence when minerData changes
  useEffect(() => {
    if (!channelInstance || isAdmin) return;

    if (minerName && regNo) {
      if (isSubscribedRef.current) {
        channelInstance.track({
          id: minerId,
          name: minerName,
          regNo: regNo,
          joinedAt: new Date().toISOString(),
        }).catch(console.error);
      }
    } else {
      // User has logged out or completed round -> untrack so presence removes them immediately
      if (isSubscribedRef.current) {
        channelInstance.untrack().catch(console.error);
      }
    }
  }, [channelInstance, minerName, regNo, minerId, isAdmin]);

  const updateAdminConfig = async (config) => {
    if (channelInstance && isAdmin) {
      await channelInstance.track({ role: 'admin', ...config });
    }
  };

  const sendBroadcast = async (event, payload) => {
    if (channelInstance) {
      return channelInstance.send({
        type: 'broadcast',
        event,
        payload,
      });
    }
  };

  // Optimistic immediate add for the local client (0ms latency)
  const addLocalMiner = (newMiner) => {
    if (!newMiner || !newMiner.name) return;
    const key = newMiner.regNo || newMiner.registration_number;
    setMiners((prev) => {
      if (prev.some(item => (item.regNo || item.registration_number) === key)) {
        return prev;
      }
      return [{ id: newMiner.id, name: newMiner.name, regNo: key }, ...prev];
    });
  };

  return { miners, gameState, winnerInfo, channel: channelInstance, poolConfig, updateAdminConfig, sendBroadcast, addLocalMiner };
}

