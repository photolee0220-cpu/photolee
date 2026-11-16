import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { todayIso } from './week';

/** 'today' that keeps up with the clock. If the page stayed open past midnight
 *  (phone left on the daily screen), a date still pointing at the old today
 *  moves to the new today; a date the user picked on purpose is left alone. */
export function useFollowToday(): [string, Dispatch<SetStateAction<string>>] {
  const [date, setDate] = useState(todayIso);
  const lastToday = useRef(todayIso());
  useEffect(() => {
    const check = () => {
      const now = todayIso();
      if (now === lastToday.current) return;
      const old = lastToday.current;
      lastToday.current = now;
      setDate((d) => (d === old ? now : d));
    };
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', check);
    const t = setInterval(check, 60_000);
    return () => { document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('focus', check); clearInterval(t); };
  }, []);
  return [date, setDate];
}
