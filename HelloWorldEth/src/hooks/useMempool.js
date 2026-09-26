import { useEffect, useState } from 'react';
import { supabase } from '../utils/supabase';
import { getDefaultPool } from '../utils/api';

export function useMempool(minerName, regNo, isAdmin = false, isPassive = false) {
  const [miners, setMiners] = useState([]);
  const [gameState, setGameState] = useState('waiting');
  const [channelInstance, setChannelInstance] = useState(null);
  const [poolConfig, setPoolConfig] = useState({ maxMiners: 10 });

  // Fetch initial pool config on mount
  useEffect(() => {
    getDefaultPool().then(pool => {
      if (pool && pool.max_miners) {
        setPoolConfig(prev => ({ ...prev, maxMiners: pool.max_miners }));
      }
    }).catch(console.error);
  }, []);

  useEffect(() => {
    // If not admin, not passive, and missing credentials, don't connect
    if (!isAdmin && !isPassive && (!minerName || !regNo)) return;

    // A unique key is needed for presence if tracking, otherwise random UUID is fine for passive
    const presenceKey = isAdmin ? 'admin' : (regNo || Math.random().toString());

    const channel = supabase.channel('pow_mempool', {
      config: {
        presence: {
          key: presenceKey,
        },
      },
    });

    setChannelInstance(channel);

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        
        let foundAdminConfig = null;
        
        const activeMiners = Object.values(state)
          .map((userPresence) => userPresence[0])
          .filter(m => {
            if (m.role === 'admin') {
              foundAdminConfig = m;
              return false; // exclude admin from miners list
            }
            return true;
          });
          
        setMiners(activeMiners);
        
        // If an admin is in the pool, sync their maxMiners config globally as an override
        if (foundAdminConfig && foundAdminConfig.maxMiners) {
          setPoolConfig(prev => ({ ...prev, maxMiners: foundAdminConfig.maxMiners }));
        }
      })
      .on('presence', { event: 'join' }, ({ key, newPresences }) => {
        if (newPresences[0]?.role !== 'admin') console.log('Miner joined:', newPresences[0]?.name);
      })
      .on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
        if (leftPresences[0]?.role !== 'admin') console.log('Miner left:', leftPresences[0]?.name);
      });

    channel
      .on('broadcast', { event: 'START_QUIZ' }, (payload) => {
        console.log('Transaction Broadcasted! Quiz starting...');
        if (payload.payload?.round_id) {
          localStorage.setItem('pow_current_round', JSON.stringify(payload.payload));
        }
        localStorage.setItem('pow_quiz_index', '0');
        localStorage.setItem('pow_quiz_time', '0');
        setGameState('quiz_started');
      })
      .on('broadcast', { event: 'BLOCK_MINED' }, (payload) => {
        setGameState('block_found');
      });

    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        if (isAdmin) {
          // We wait for the default pool fetch to set the actual maxMiners
          // If updateAdminConfig is called later, it tracks the new config
        } else if (!isPassive) {
          await channel.track({
            name: minerName,
            regNo: regNo,
            joinedAt: new Date().toISOString(),
          });
        }
      }
    });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [minerName, regNo, isAdmin, isPassive]);

  const updateAdminConfig = async (config) => {
    if (channelInstance && isAdmin) {
      await channelInstance.track({ role: 'admin', ...config });
    }
  };

  return { miners, gameState, channel: channelInstance, poolConfig, updateAdminConfig };
}
