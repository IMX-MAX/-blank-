import { useEffect, useState } from 'react';
import { loadStats, onStatsChange, type DayStats } from '../lib/stats';

/** The stored listening stats, reloaded whenever new listens are saved or the stats are reset. */
export function useStatsDays() {
  const [days, setDays] = useState<DayStats[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    const load = () =>
      loadStats()
        .then((next) => {
          if (live) setDays(next);
        })
        .catch(() => {
          if (live) setFailed(true);
        });
    void load();
    const stop = onStatsChange(() => void load());
    return () => {
      live = false;
      stop();
    };
  }, []);
  return { days, failed };
}
