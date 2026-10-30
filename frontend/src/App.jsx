import React, { useState, useEffect, useCallback, useRef } from 'react';

const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
  tg.setHeaderColor('#020a06');
  tg.setBackgroundColor('#020a06');
}

const API = ''; // same origin when deployed on CF

// Never use scientific notation (6.95e-9). Always plain decimal digits.
function formatNum(n, dec = 10) {
  if (n === undefined || n === null || n === '') return '0';
  const num = Number(n);
  if (!isFinite(num)) return '0';
  if (num === 0) return '0';
  // toFixed avoids e-notation for normal small rewards
  let s = num.toFixed(Math.min(Math.max(dec, 0), 18));
  // trim trailing zeros after decimal, keep at least one digit if pure integer
  if (s.includes('.')) {
    s = s.replace(/0+$/, '').replace(/\.$/, '');
  }
  return s || '0';
}

function formatTime(sec) {
  if (sec <= 0) return '00:00:00';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Lucide / Feather style SVG icons (JVault-like)
const SVGS = {
  zap: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  ),
  gift: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="8" width="18" height="4" rx="1" />
      <path d="M12 8v13" />
      <path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7" />
      <path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5" />
    </svg>
  ),
  users: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  trophy: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M4 22h16" />
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20 7 22" />
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20 17 22" />
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
    </svg>
  ),
  wallet: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
      <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
      <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
    </svg>
  ),
  crown: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14" />
    </svg>
  ),
  diamond: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.7 10.3a2.41 2.41 0 0 0 0 3.41l7.59 7.59a2.41 2.41 0 0 0 3.41 0l7.59-7.59a2.41 2.41 0 0 0 0-3.41l-7.59-7.59a2.41 2.41 0 0 0-3.41 0Z" />
    </svg>
  ),
  folder: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9l-.81-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </svg>
  ),
  chart: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18h18" />
      <path d="m19 9-5 5-4-4-3 3" />
    </svg>
  ),
  check: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  ),
  clock: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </svg>
  ),
  calendar: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="18" height="18" x="3" y="4" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.47a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  user: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  ),
  ban: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="m4.9 4.9 14.2 14.2" />
    </svg>
  ),
  megaphone: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m3 11 18-5v12L3 13v-2z" />
      <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
    </svg>
  ),
  image: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </svg>
  ),
  message: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
    </svg>
  ),
  rocket: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
      <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
      <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
      <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
    </svg>
  ),
  save: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
      <path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7" />
      <path d="M7 3v4a1 1 0 0 0 1 1h7" />
    </svg>
  ),
  flame: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
    </svg>
  ),
  coins: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="6" />
      <path d="M18.09 10.37A6 6 0 1 1 10.34 18" />
      <path d="M7 6h1v4" />
      <path d="m16.71 13.88.7.71-2.82 2.82" />
    </svg>
  ),
  medal: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7.21 15 2.66 7.14a2 2 0 0 1 .13-2.2L4.4 2.8A2 2 0 0 1 6 2h12a2 2 0 0 1 1.6.8l1.6 2.14a2 2 0 0 1 .14 2.2L17.79 15" />
      <path d="M11 12 5.12 2.2" />
      <path d="m13 12 5.88-9.8" />
      <path d="M8 7h8" />
      <circle cx="12" cy="17" r="5" />
      <path d="M12 18v-2h-.5" />
    </svg>
  ),
};

function Icon({ name, className = '', size = 18 }) {
  const svg = SVGS[name];
  if (!svg) return null;
  return (
    <span className={`svg-icon ${className}`.trim()} style={{ width: size, height: size }}>
      {svg}
    </span>
  );
}

export default function App() {
  const [tab, setTab] = useState('tap');
  const [user, setUser] = useState(null);
  const [config, setConfig] = useState(null);
  const [price, setPrice] = useState(0);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');
  const [leaderboard, setLeaderboard] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [completedTasks, setCompletedTasks] = useState([]);
  const [referrals, setReferrals] = useState([]);
  const [withdrawals, setWithdrawals] = useState([]);
  const [energyLeft, setEnergyLeft] = useState(1000);
  const [resetAt, setResetAt] = useState(0);
  const [waitSec, setWaitSec] = useState(0);
  const [tapAnim, setTapAnim] = useState(0);
  const [coins, setCoins] = useState([]); // scatter coins on tap
  const [candles, setCandles] = useState([]); // OHLCV from Hyperliquid
  const [chartInterval, setChartInterval] = useState('1h');
  const [mcap, setMcap] = useState(0);
  const [dayChange, setDayChange] = useState(0);
  const [dayVol, setDayVol] = useState(0);
  const [dayHigh, setDayHigh] = useState(0);
  const [dayLow, setDayLow] = useState(0);
  const [chartLoading, setChartLoading] = useState(true);

  // Admin
  const [adminTab, setAdminTab] = useState('stats');
  const [adminStats, setAdminStats] = useState(null);
  const [adminWithdrawals, setAdminWithdrawals] = useState([]);
  const [adminTasks, setAdminTasks] = useState([]);
  const [adminSettings, setAdminSettings] = useState(null);
  const [adminLeaderboard, setAdminLeaderboard] = useState([]);
  const [adminReferrals, setAdminReferrals] = useState([]);
  const [editUserId, setEditUserId] = useState('');
  const [editUserData, setEditUserData] = useState({ balance: '', total_earned: '', total_taps: '', is_admin: false, invite_count: '' });
  const [settingsForm, setSettingsForm] = useState({ tap_reward: '', referral_reward: '', min_withdraw: '', energy_max: '', energy_cooldown: '', daily_checkin_reward: '' });
  const [canCheckin, setCanCheckin] = useState(true);
  const [checkinWait, setCheckinWait] = useState(0);
  const [broadcastMsg, setBroadcastMsg] = useState('');
  const [broadcastPhoto, setBroadcastPhoto] = useState('');
  const [broadcastSending, setBroadcastSending] = useState(false);
  const [newTask, setNewTask] = useState({ title: '', type: 'telegram', link: '', reward: '0.0085' });
  const [wdAmount, setWdAmount] = useState('');
  const [wdWallet, setWdWallet] = useState('');

  const tapQueue = useRef(0);
  const tapTimer = useRef(null);
  const energyRef = useRef(1000);
  const tapInFlight = useRef(false);
  const pendingFlush = useRef(false);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  };

  const headers = () => {
    const h = { 'Content-Type': 'application/json' };
    if (tg?.initData) h['X-Telegram-Init-Data'] = tg.initData;
    return h;
  };

  const api = async (path, opts = {}) => {
    const res = await fetch(API + path, {
      ...opts,
      headers: { ...headers(), ...(opts.headers || {}) },
    });
    return res.json();
  };

  // Load user
  const loadUser = useCallback(async () => {
    try {
      const startParam = tg?.initDataUnsafe?.start_param || null;
      const tgUser = tg?.initDataUnsafe?.user || { id: 0, first_name: 'Guest' };
      const data = await api('/api/user', {
        method: 'POST',
        body: JSON.stringify({ user: tgUser, start_param: startParam }),
      });
      if (data.user) {
        const e = Math.max(0, Number(data.user.energy) || 0);
        const ra = Number(data.user.energy_reset_at) || 0;
        setUser(data.user);
        energyRef.current = e;
        setEnergyLeft(e);
        setResetAt(ra);
        setConfig(data.config);
        setPrice(data.price || 0);
        setCanCheckin(data.user.can_checkin !== false);
        if (data.user.wallet_address) setWdWallet(data.user.wallet_address);
      }
    } catch (e) {
      console.error(e);
      showToast('Connection error');
    } finally {
      setLoading(false);
    }
  }, []);

  // Live HYPE market stats (price, mcap, 24h vol/change)
  const fetchMarket = useCallback(async () => {
    try {
      const res = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
      });
      const data = await res.json();
      const universe = data?.[0]?.universe || [];
      const ctxs = data?.[1] || [];
      const idx = universe.findIndex((u) => u.name === 'HYPE');
      if (idx < 0) return;
      const ctx = ctxs[idx] || {};
      const mark = parseFloat(ctx.markPx || ctx.midPx || 0);
      const prev = parseFloat(ctx.prevDayPx || 0);
      const vol = parseFloat(ctx.dayNtlVlm || 0);
      if (mark > 0) {
        setPrice(mark);
        // ~253.54M circulating supply (public figure)
        setMcap(mark * 253540000);
      }
      if (prev > 0 && mark > 0) setDayChange(((mark - prev) / prev) * 100);
      if (vol > 0) setDayVol(vol);
    } catch (_) {}
  }, []);

  // Candle chart data
  const fetchCandles = useCallback(async (interval) => {
    setChartLoading(true);
    try {
      const msMap = { '15m': 15 * 60e3, '30m': 30 * 60e3, '1h': 60 * 60e3, '4h': 4 * 60 * 60e3, '1d': 24 * 60 * 60e3 };
      const step = msMap[interval] || 60 * 60e3;
      const count = interval === '1d' ? 30 : 48;
      const end = Date.now();
      const start = end - step * count;
      const res = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'candleSnapshot',
          req: { coin: 'HYPE', interval, startTime: start, endTime: end },
        }),
      });
      const raw = await res.json();
      if (Array.isArray(raw) && raw.length > 0) {
        const mapped = raw.map((c) => ({
          t: c.t,
          o: parseFloat(c.o),
          h: parseFloat(c.h),
          l: parseFloat(c.l),
          c: parseFloat(c.c),
          v: parseFloat(c.v),
        }));
        setCandles(mapped);
        const highs = mapped.map((c) => c.h);
        const lows = mapped.map((c) => c.l);
        setDayHigh(Math.max(...highs));
        setDayLow(Math.min(...lows));
        const last = mapped[mapped.length - 1];
        if (last?.c > 0) setPrice(last.c);
      }
    } catch (_) {
    } finally {
      setChartLoading(false);
    }
  }, []);

  useEffect(() => {
    // Hide HTML boot splash once React is alive (single continuous loading)
    const boot = document.getElementById('boot-splash');
    if (boot) boot.classList.add('hide');

    loadUser();
    fetchMarket();
    fetchCandles(chartInterval);
    const iv = setInterval(() => {
      fetchMarket();
      fetchCandles(chartInterval);
    }, 30000);
    return () => clearInterval(iv);
  }, [loadUser, fetchMarket, fetchCandles, chartInterval]);

  // Keep energyRef in sync
  useEffect(() => {
    energyRef.current = energyLeft;
  }, [energyLeft]);

  // Energy countdown — timer chalta rahe jab energy 0 ho, 1 ghante baad renew
  useEffect(() => {
    // Energy > 0 aur koi active cooldown nahi → timer band
    if (energyLeft > 0 && (!resetAt || resetAt <= Math.floor(Date.now() / 1000))) {
      setWaitSec(0);
      return;
    }
    // Cooldown active nahi
    if (!resetAt || resetAt <= 0) {
      setWaitSec(0);
      return;
    }
    const tick = () => {
      const now = Math.floor(Date.now() / 1000);
      const left = Math.max(0, resetAt - now);
      setWaitSec(left);
      if (left <= 0) {
        // Timer khatam → energy full renew
        setEnergyLeft(config?.energy_max || 1000);
        setResetAt(0);
        setWaitSec(0);
        setUser((u) => (u ? { ...u, energy: config?.energy_max || 1000, energy_reset_at: 0 } : u));
      }
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [energyLeft, resetAt, config]);

  // Daily check-in countdown (until next UTC midnight)
  useEffect(() => {
    if (canCheckin) {
      setCheckinWait(0);
      return;
    }
    const tick = () => {
      const now = Math.floor(Date.now() / 1000);
      const todayDay = Math.floor(now / 86400);
      const nextReset = (todayDay + 1) * 86400;
      const left = Math.max(0, nextReset - now);
      setCheckinWait(left);
      if (left <= 0) setCanCheckin(true);
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [canCheckin]);

  const doCheckin = async () => {
    if (!canCheckin) {
      showToast(`Next check-in in ${formatTime(checkinWait)}`);
      return;
    }
    const data = await api('/api/checkin', {
      method: 'POST',
      body: JSON.stringify({ user: tg?.initDataUnsafe?.user }),
    });
    if (data.success) {
      showToast(`Daily Check-in +${formatNum(data.reward, 12)} HYPE`);
      setCanCheckin(false);
      loadUser();
    } else if (data.already) {
      setCanCheckin(false);
      if (data.wait_seconds) setCheckinWait(data.wait_seconds);
      showToast('Already checked in today');
    } else {
      showToast(data.error || 'Check-in failed');
    }
  };

  // Flush queued taps to server (one request at a time — no race)
  const flushTaps = async () => {
    if (tapInFlight.current) {
      pendingFlush.current = true;
      return;
    }
    const taps = tapQueue.current;
    if (taps <= 0) return;
    tapQueue.current = 0;
    tapInFlight.current = true;
    pendingFlush.current = false;
    try {
      const data = await api('/api/tap', {
        method: 'POST',
        body: JSON.stringify({ user: tg?.initDataUnsafe?.user, taps }),
      });
      if (data.success) {
        const serverEnergy = Math.max(0, Number(data.energy) || 0);
        // Local optimistic already decreased — take the LOWER of local vs server
        // so concurrent race kabhi energy badha na sake
        const local = energyRef.current;
        const finalEnergy = Math.min(local, serverEnergy);
        energyRef.current = finalEnergy;
        setEnergyLeft(finalEnergy);
        setUser((u) => ({
          ...u,
          balance: data.balance,
          energy: finalEnergy,
          energy_reset_at: data.energy_reset_at || 0,
        }));
        if (finalEnergy <= 0) {
          const ra =
            data.energy_reset_at ||
            Math.floor(Date.now() / 1000) + (config?.energy_cooldown || 3600);
          setResetAt(ra);
        } else {
          setResetAt(data.energy_reset_at || 0);
        }
        if (data.earned > 0) {
          tg?.HapticFeedback?.impactOccurred?.('light');
        }
      } else if (data.error) {
        showToast(data.error);
        const serverEnergy = Math.max(0, Number(data.energy) || 0);
        energyRef.current = serverEnergy;
        setEnergyLeft(serverEnergy);
        if (data.energy_reset_at) setResetAt(data.energy_reset_at);
      }
    } catch {
      showToast('Tap failed');
    } finally {
      tapInFlight.current = false;
      // Agar flush ke dauran naye taps aaye, dubara bhejo
      if (pendingFlush.current || tapQueue.current > 0) {
        pendingFlush.current = false;
        flushTaps();
      }
    }
  };

  // Batch taps — energy 0 tak gire, 0 pe ruk jaye, timer 1h
  const doTap = () => {
    if (energyRef.current <= 0) {
      showToast(`Energy empty • wait ${formatTime(waitSec)}`);
      return;
    }
    setTapAnim((a) => a + 1);

    // Spawn 4–5 small HYPE coins that scatter outward
    const id = Date.now() + Math.random();
    const count = 4 + Math.floor(Math.random() * 2); // 4 or 5
    const newCoins = Array.from({ length: count }, (_, i) => {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.6;
      const dist = 70 + Math.random() * 55;
      return {
        id: `${id}-${i}`,
        dx: Math.cos(angle) * dist,
        dy: Math.sin(angle) * dist - 20,
        rot: (Math.random() - 0.5) * 360,
        scale: 0.55 + Math.random() * 0.35,
      };
    });
    setCoins((c) => [...c, ...newCoins]);
    setTimeout(() => {
      setCoins((c) => c.filter((coin) => !String(coin.id).startsWith(String(id))));
    }, 900);

    // Optimistic decrease via ref (no stale state)
    const next = Math.max(0, energyRef.current - 1);
    energyRef.current = next;
    setEnergyLeft(next);
    if (next === 0) {
      const cooldown = config?.energy_cooldown || 3600;
      const until = Math.floor(Date.now() / 1000) + cooldown;
      setResetAt((prev) => (prev && prev > Math.floor(Date.now() / 1000) ? prev : until));
    }
    tapQueue.current += 1;

    if (tapTimer.current) clearTimeout(tapTimer.current);
    tapTimer.current = setTimeout(() => {
      flushTaps();
    }, 120);
  };

  // Load other pages
  useEffect(() => {
    if (tab === 'leaderboard') {
      api('/api/leaderboard').then((d) => setLeaderboard(d.leaderboard || []));
    }
    if (tab === 'tasks') {
      api('/api/tasks').then((d) => {
        setTasks(d.tasks || []);
        setCompletedTasks(d.completed || []);
      });
    }
    if (tab === 'friends') {
      api('/api/referrals').then((d) => {
        setReferrals(d.referrals || []);
        if (d.count != null) {
          setUser((u) => (u ? { ...u, invite_count: d.count } : u));
        }
      });
    }
    if (tab === 'wallet') {
      api('/api/withdrawals').then((d) => setWithdrawals(d.withdrawals || []));
    }
    if (tab === 'admin' && user?.is_admin) {
      loadAdmin();
    }
  }, [tab, user]);

  const loadAdmin = async () => {
    const [stats, wds, tks] = await Promise.all([
      api('/api/admin/stats'),
      api('/api/admin/withdrawals?status=pending'),
      api('/api/admin/tasks'),
    ]);
    setAdminStats(stats);
    setAdminWithdrawals(wds.withdrawals || []);
    setAdminTasks(tks.tasks || []);
  };

  const loadAdminSettings = async () => {
    const data = await api('/api/admin/settings');
    if (data && !data.error) {
      setAdminSettings(data);
      setSettingsForm({
        tap_reward: data.tap_reward != null ? formatNum(data.tap_reward, 12) : '',
        referral_reward: data.referral_reward != null ? formatNum(data.referral_reward, 12) : '',
        min_withdraw: data.min_withdraw != null ? formatNum(data.min_withdraw, 8) : '',
        energy_max: data.energy_max != null ? String(data.energy_max) : '',
        energy_cooldown: data.energy_cooldown != null ? String(data.energy_cooldown) : '',
        daily_checkin_reward: data.daily_checkin_reward != null ? formatNum(data.daily_checkin_reward, 12) : '',
      });
    }
  };

  const saveSettings = async () => {
    const body = {};
    if (settingsForm.tap_reward !== '') body.tap_reward = parseFloat(settingsForm.tap_reward);
    if (settingsForm.referral_reward !== '') body.referral_reward = parseFloat(settingsForm.referral_reward);
    if (settingsForm.min_withdraw !== '') body.min_withdraw = parseFloat(settingsForm.min_withdraw);
    if (settingsForm.energy_max !== '') body.energy_max = parseFloat(settingsForm.energy_max);
    if (settingsForm.energy_cooldown !== '') body.energy_cooldown = parseFloat(settingsForm.energy_cooldown);
    if (settingsForm.daily_checkin_reward !== '') body.daily_checkin_reward = parseFloat(settingsForm.daily_checkin_reward);
    const data = await api('/api/admin/settings', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (data.success) {
      showToast('Settings saved!');
      setAdminSettings(data.settings);
      loadUser(); // refresh config for tap
    } else {
      showToast(data.error || 'Failed');
    }
  };

  const loadAdminLeaderboard = async () => {
    const data = await api('/api/admin/leaderboard?limit=50');
    setAdminLeaderboard(data.leaderboard || []);
  };

  const loadAdminReferrals = async () => {
    const data = await api('/api/admin/referrals?limit=50');
    setAdminReferrals(data.referrals || []);
  };

  const loadUserDetails = async (id) => {
    if (!id) return;
    const data = await api(`/api/admin/users/${id}`);
    if (data.user) {
      setEditUserId(String(data.user.id));
      setEditUserData({
        balance: formatNum(data.user.balance ?? 0, 12),
        total_earned: formatNum(data.user.total_earned ?? 0, 12),
        total_taps: String(data.user.total_taps ?? 0),
        is_admin: !!data.user.is_admin,
        invite_count: String(data.user.invite_count ?? 0),
      });
    } else {
      showToast(data.error || 'User not found');
    }
  };

  const saveUserEdit = async () => {
    if (!editUserId) return;
    const body = {
      balance: parseFloat(editUserData.balance),
      total_earned: parseFloat(editUserData.total_earned),
      total_taps: parseInt(editUserData.total_taps),
      is_admin: editUserData.is_admin,
      invite_count: parseInt(editUserData.invite_count),
    };
    const data = await api(`/api/admin/users/${editUserId}`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (data.success) {
      showToast('User updated');
      loadAdminLeaderboard();
    } else {
      showToast(data.error || 'Failed');
    }
  };

  const deleteUser = async (id) => {
    if (!confirm('Delete this user permanently?')) return;
    const data = await api(`/api/admin/users/${id}`, { method: 'DELETE' });
    if (data.success) {
      showToast('User deleted');
      loadAdminLeaderboard();
      if (String(id) === editUserId) {
        setEditUserId('');
        setEditUserData({ balance: '', total_earned: '', total_taps: '', is_admin: false, invite_count: '' });
      }
    } else {
      showToast(data.error || 'Failed');
    }
  };

  // Load extra admin data when tab changes
  useEffect(() => {
    if (tab !== 'admin' || !user?.is_admin) return;
    if (adminTab === 'settings') loadAdminSettings();
    if (adminTab === 'users') loadAdminLeaderboard();
    if (adminTab === 'referrals') loadAdminReferrals();
  }, [adminTab, tab, user]);

  const completeTask = async (taskId) => {
    const data = await api('/api/tasks/complete', {
      method: 'POST',
      body: JSON.stringify({ user: tg?.initDataUnsafe?.user, task_id: taskId }),
    });
    if (data.success) {
      showToast(`+${formatNum(data.reward, 12)} HYPE`);
      setCompletedTasks((c) => [...c, taskId]);
      loadUser();
    } else {
      showToast(data.error || 'Failed');
    }
  };

  const requestWithdraw = async () => {
    const amount = parseFloat(wdAmount);
    if (!amount || amount < (config?.min_withdraw || 1)) {
      showToast(`Min ${config?.min_withdraw || 1} HYPE`);
      return;
    }
    if (!wdWallet || wdWallet.length < 10) {
      showToast('Enter valid wallet');
      return;
    }
    const data = await api('/api/withdraw', {
      method: 'POST',
      body: JSON.stringify({
        user: tg?.initDataUnsafe?.user,
        amount,
        wallet_address: wdWallet,
      }),
    });
    if (data.success) {
      showToast('Request submitted!');
      setWdAmount('');
      loadUser();
      api('/api/withdrawals').then((d) => setWithdrawals(d.withdrawals || []));
    } else {
      showToast(data.error || 'Failed');
    }
  };

  const adminAction = async (id, action) => {
    const data = await api(`/api/admin/withdrawals/${id}`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    });
    if (data.success) {
      showToast(`Marked ${action}`);
      loadAdmin();
    }
  };

  const addTask = async () => {
    if (!newTask.title || !newTask.link) return showToast('Fill all fields');
    const data = await api('/api/admin/tasks', {
      method: 'POST',
      body: JSON.stringify(newTask),
    });
    if (data.success) {
      showToast('Task added');
      setNewTask({ title: '', type: 'telegram', link: '', reward: '0.0085' });
      loadAdmin();
    }
  };

  const deleteTask = async (id) => {
    await api(`/api/admin/tasks/${id}`, { method: 'DELETE' });
    showToast('Deleted');
    loadAdmin();
  };

  const sendBroadcast = async () => {
    const msg = broadcastMsg.trim();
    const photo = broadcastPhoto.trim();
    if (!msg && !photo) {
      showToast('Message or photo URL required');
      return;
    }
    setBroadcastSending(true);
    showToast('Broadcasting to all users...');
    try {
      const data = await api('/api/admin/broadcast', {
        method: 'POST',
        body: JSON.stringify({ message: msg, photo: photo || undefined }),
      });
      if (data.success) {
        showToast(`✅ Sent to ${data.sent}/${data.total || data.sent} users` + (data.failed ? ` (${data.failed} failed)` : ''));
        setBroadcastMsg('');
        setBroadcastPhoto('');
      } else {
        showToast(data.error || 'Broadcast failed');
      }
    } catch (e) {
      showToast('Broadcast error');
    } finally {
      setBroadcastSending(false);
    }
  };

  // Mini App: use startapp so tg.initDataUnsafe.start_param is set ( ?start= only opens bot chat )
  const inviteLink = (config?.bot_username && user?.id)
    ? `https://t.me/${config.bot_username}?startapp=${user.id}`
    : (user?.id ? `https://t.me/share/url?url=&text=Join%20with%20ref%20${user.id}` : '');

  if (loading) {
    return (
      <div className="app loading-screen">
        <div className="loading-inner">
          <div className="loading-logo-wrap">
            <img src="/hype-logo.png" alt="HYPE" className="loading-logo" />
            <div className="loading-ring" />
          </div>
          <div className="loading-title">Hype Token</div>
          <div className="loading-sub">Mining engine starting…</div>
          <div className="loading-bar">
            <div className="loading-bar-fill" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      {toast && <div className="toast">{toast}</div>}

      {/* Header - matching Hype Token UI */}
      <div className="header">
        <div className="header-left">
          <div className="logo-title">
            <Icon name="crown" className="crown" size={20} /> Hype Token
          </div>
          <div className="header-badges">
            <span className="badge gold-lvl"><Icon name="crown" size={12} /> Lvl 1</span>
            <span className="badge online"><Icon name="zap" size={12} /> ONLINE</span>
          </div>
          {price > 0 && (
            <div className="lvl-progress">
              ≈ ${(Number(user?.balance || 0) * price).toFixed(4)}$ left to Lvl UP →
            </div>
          )}
        </div>
        <div className="header-right">
          <button className="connect-wallet-btn" onClick={() => setTab('wallet')}>
            <Icon name="diamond" size={14} /> Connect Wallet
          </button>
          <div className="uid-badge">
            <Icon name="folder" size={12} /> UID {user?.id || '—'}
          </div>
          {user?.is_admin && (
            <span className="badge gold" onClick={() => setTab('admin')} style={{ marginTop: 4 }}>
              ADMIN
            </span>
          )}
        </div>
      </div>

      {/* TAP PAGE */}
      {tab === 'tap' && (
        <>
          <div className="assets-card">
            <div className="assets-label">ASSETS</div>
            <div className="balance-row">
              <img src="/hype-logo.png" alt="HYPE" className="balance-icon" />
              <div className="balance-amount">{formatNum(user?.balance, 6)}</div>
              <div className="balance-symbol">HYPE</div>
            </div>
            <div className="earned-chip">
              <Icon name="chart" size={14} /> +{formatNum(user?.total_earned, 6)} HYPE
            </div>
            <div className="hl-price">
              <Icon name="chart" size={14} /> HYPE Live: {price > 0 ? `$${Number(price).toFixed(4)}` : '…'} <span style={{ opacity: 0.7 }}>· Hyperliquid</span>
            </div>
          </div>

          <div className="tap-area">
            <div
              className={`hype-logo ${tapAnim ? 'tapped' : ''}`}
              onPointerDown={(e) => {
                e.preventDefault();
                doTap();
              }}
              role="button"
              aria-label="Tap to mine"
            >
              <img src="/hype-logo.png" alt="HYPE Logo" className="logo-img" draggable={false} />
              {coins.map((c) => (
                <span
                  key={c.id}
                  className="tap-coin"
                  style={{
                    '--dx': `${c.dx}px`,
                    '--dy': `${c.dy}px`,
                    '--rot': `${c.rot}deg`,
                    '--sc': c.scale,
                  }}
                >
                  <img src="/hype-logo.png" alt="" draggable={false} />
                </span>
              ))}
            </div>
            <div className="tap-hint">
              {energyLeft > 0
                ? `Tap to Mine • 1 Tap = ${formatNum(config?.tap_reward || 0.0000000695, 12)} HYPE`
                : `Energy empty • Recharge in ${formatTime(waitSec)}`}
            </div>
          </div>

          {/* ATF-style golden energy pipe */}
          <div className="energy-wrap">
            <div className="energy-pipe">
              <div className="energy-pipe-end left"><Icon name="zap" size={16} /></div>
              <div className="energy-pipe-body">
                <div
                  className="energy-pipe-fill"
                  style={{
                    width: `${Math.min(100, Math.max(0, (energyLeft / (config?.energy_max || 1000)) * 100))}%`,
                  }}
                />
                <div className="energy-pipe-shine" />
              </div>
              <div className="energy-pipe-end right"><Icon name="zap" size={16} /></div>
            </div>
            <div className="energy-pct-badge">
              {Math.round(Math.min(100, Math.max(0, (energyLeft / (config?.energy_max || 1000)) * 100)))}%
            </div>
            <div className="energy-text">
              <span><Icon name="zap" size={13} /> {Math.max(0, energyLeft)}/{config?.energy_max || 1000}</span>
              {(energyLeft <= 0 || waitSec > 0) && (
                <span className="timer"><Icon name="clock" size={13} /> Renew in {formatTime(waitSec)}</span>
              )}
            </div>
          </div>

          <button
            className={`claim-btn ${!canCheckin ? 'claim-disabled' : ''}`}
            onClick={doCheckin}
            disabled={!canCheckin}
          >
            {canCheckin
              ? <><Icon name="calendar" size={18} /> DAILY CHECK-IN  +{formatNum(config?.daily_checkin_reward ?? 0.001, 12)}</>
              : <><Icon name="clock" size={18} /> Next in {formatTime(checkinWait)}</>}
          </button>
          <div className="hl-native-tag">
            Hyperliquid Native
          </div>

          {/* JVault-style live HYPE / USDT chart */}
          <div className="hl-live-card">
            <div className="hl-chart-top">
              <div className="hl-chart-title">
                <span className="hl-live-dot" />
                <span>HYPE / USDT</span>
                <span className="hl-live-badge">LIVE</span>
              </div>
              <div className="hl-intervals">
                {['15m', '30m', '1h', '4h', '1d'].map((iv) => (
                  <button
                    key={iv}
                    className={`hl-iv ${chartInterval === iv ? 'active' : ''}`}
                    onClick={() => setChartInterval(iv)}
                  >
                    {iv}
                  </button>
                ))}
              </div>
            </div>

            <div className="hl-stats-row">
              <div className="hl-stat">
                <div className="hl-stat-label">LIVE PRICE</div>
                <div className="hl-stat-val">
                  ${price > 0 ? Number(price).toFixed(4) : '—'}
                  <span className={`hl-chg ${dayChange >= 0 ? 'up' : 'down'}`}>
                    {dayChange >= 0 ? '+' : ''}{dayChange.toFixed(2)}%
                  </span>
                </div>
              </div>
              <div className="hl-stat">
                <div className="hl-stat-label">MARKET CAP</div>
                <div className="hl-stat-val gold">
                  {mcap > 0 ? `$${(mcap / 1e9).toFixed(2)}B` : '—'}
                </div>
              </div>
              <div className="hl-stat">
                <div className="hl-stat-label">24H VOLUME</div>
                <div className="hl-stat-val">
                  {dayVol > 0
                    ? dayVol >= 1e9
                      ? `$${(dayVol / 1e9).toFixed(2)}B`
                      : `$${(dayVol / 1e6).toFixed(0)}M`
                    : '—'}
                </div>
              </div>
              <div className="hl-stat">
                <div className="hl-stat-label">HIGH / LOW</div>
                <div className="hl-stat-val small">
                  {dayHigh > 0 ? `$${dayHigh.toFixed(2)}` : '—'}
                  <span className="hl-sep">/</span>
                  {dayLow > 0 ? `$${dayLow.toFixed(2)}` : '—'}
                </div>
              </div>
            </div>

            <div className="hl-chart-body">
              {chartLoading && candles.length === 0 ? (
                <div className="hl-spark-loading">Loading chart…</div>
              ) : candles.length > 1 ? (
                <svg viewBox="0 0 320 140" preserveAspectRatio="none" className="hl-full-svg">
                  <defs>
                    <linearGradient id="hlArea" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="rgba(0,255,136,0.35)" />
                      <stop offset="100%" stopColor="rgba(0,255,136,0)" />
                    </linearGradient>
                  </defs>
                  {(() => {
                    const closes = candles.map((c) => c.c);
                    const vols = candles.map((c) => c.v);
                    const minP = Math.min(...closes);
                    const maxP = Math.max(...closes);
                    const range = maxP - minP || 1;
                    const maxV = Math.max(...vols) || 1;
                    const n = candles.length;
                    const chartH = 100;
                    const volH = 28;
                    const topPad = 6;
                    const pts = candles.map((c, i) => {
                      const x = (i / (n - 1)) * 320;
                      const y = topPad + chartH - ((c.c - minP) / range) * chartH;
                      return [x, y];
                    });
                    const line = pts.map((p) => p.join(',')).join(' ');
                    const area = `0,${topPad + chartH} ${line} 320,${topPad + chartH}`;
                    const last = pts[pts.length - 1];
                    return (
                      <>
                        {/* volume bars */}
                        {candles.map((c, i) => {
                          const x = (i / (n - 1)) * 320;
                          const h = (c.v / maxV) * volH;
                          const up = c.c >= c.o;
                          return (
                            <rect
                              key={i}
                              x={x - 1.5}
                              y={140 - h}
                              width={3}
                              height={h}
                              fill={up ? 'rgba(0,255,136,0.35)' : 'rgba(255,80,80,0.35)'}
                            />
                          );
                        })}
                        <polygon points={area} fill="url(#hlArea)" />
                        <polyline
                          points={line}
                          fill="none"
                          stroke="#00ff88"
                          strokeWidth="2"
                          strokeLinejoin="round"
                          strokeLinecap="round"
                        />
                        {last && (
                          <circle cx={last[0]} cy={last[1]} r="3.5" fill="#00ff88" stroke="#020a06" strokeWidth="1.5" />
                        )}
                      </>
                    );
                  })()}
                </svg>
              ) : (
                <div className="hl-spark-loading">No chart data</div>
              )}
            </div>

            <div className="hl-live-footer">
              Hyperliquid · HYPE/USDT · Real-time
            </div>
          </div>
        </>
      )}

      {/* TASKS */}
      {tab === 'tasks' && (
        <div className="page">
          <h3 style={{ marginBottom: 12, color: '#00ff88' }}>Tasks & Rewards</h3>
          {tasks.length === 0 && <div className="card">No tasks yet. Check back later.</div>}
          {tasks.map((t) => {
            const done = completedTasks.includes(t.id);
            return (
              <div className="card" key={t.id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{t.title}</div>
                    <div style={{ fontSize: '0.8rem', color: '#00ff88', marginTop: 4 }}>
                      +{formatNum(t.reward, 12)} HYPE
                    </div>
                  </div>
                  {done ? (
                    <span style={{ color: '#00ff88' }}><Icon name="check" size={14} /> Done</span>
                  ) : (
                    <button
                      className="btn btn-primary"
                      style={{ padding: '8px 14px', fontSize: '0.85rem' }}
                      onClick={() => {
                        window.open(t.link, '_blank');
                        setTimeout(() => completeTask(t.id), 1500);
                      }}
                    >
                      Join
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* FRIENDS / REFERRAL */}
      {tab === 'friends' && (
        <div className="page">
          <div className="card">
            <div className="card-title">Your Invite Link</div>
            <div
              style={{
                background: 'rgba(0,20,10,0.6)',
                padding: 10,
                borderRadius: 8,
                wordBreak: 'break-all',
                fontSize: '0.85rem',
                marginBottom: 10,
              }}
            >
              {inviteLink}
            </div>
            <button
              className="btn btn-primary"
              style={{ width: '100%' }}
              onClick={() => {
                navigator.clipboard?.writeText(inviteLink);
                tg?.openTelegramLink?.(
                  `https://t.me/share/url?url=${encodeURIComponent(inviteLink)}&text=${encodeURIComponent('Join Hype Token Tap to Earn!')}`
                );
                showToast('Link copied!');
              }}
            >
              Share Invite
            </button>
            <div style={{ marginTop: 12, textAlign: 'center', color: '#00ff88' }}>
              +{formatNum(config?.referral_reward || 0.00008526, 12)} HYPE per new user
            </div>
            <div style={{ marginTop: 8, textAlign: 'center', fontSize: '0.75rem', color: 'rgba(160,255,192,0.65)', lineHeight: 1.4 }}>
              Only brand-new users count. Existing users / self-referral = no reward.
            </div>
          </div>

          <div className="card">
            <div className="card-title">Your Invites ({user?.invite_count || 0})</div>
            {referrals.length === 0 && (
              <div style={{ color: '#888', fontSize: '0.9rem' }}>
                No new referrals yet. Share your link with friends who never used the app.
              </div>
            )}
            {referrals.map((r) => (
              <div key={r.id || r.referred_id} style={{ padding: '8px 0', borderBottom: '1px solid rgba(0,255,136,0.1)', display: 'flex', justifyContent: 'space-between' }}>
                <span>@{r.username || r.first_name || r.referred_id || 'User'}</span>
                <span style={{ color: '#00ff88' }}>+{formatNum(r.reward, 12)} HYPE</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* LEADERBOARD */}
      {tab === 'leaderboard' && (
        <div className="page">
          <h3 style={{ marginBottom: 12, color: '#00ff88' }}><Icon name="trophy" size={18} /> Top 100 Players</h3>
          {leaderboard.map((p, i) => (
            <div
              key={p.id}
              className={`lb-item ${i === 0 ? 'top1' : i === 1 ? 'top2' : i === 2 ? 'top3' : ''}`}
            >
              <div className="lb-rank">{i + 1}</div>
              <div className="lb-name">
                {i < 3 && <span style={{ marginRight: 4 }}><Icon name="medal" size={16} /></span>}
                @{p.username || p.first_name || p.id}
              </div>
              <div className="lb-score">{formatNum(p.total_earned, 4)}</div>
            </div>
          ))}
        </div>
      )}

      {/* WALLET / WITHDRAW */}
      {tab === 'wallet' && (
        <div className="page">
          <div className="card">
            <div className="card-title"><Icon name="wallet" size={16} /> Withdraw HYPE</div>
            <div style={{ marginBottom: 10, fontSize: '0.9rem' }}>
              Balance: <strong style={{ color: '#00ff88' }}>{formatNum(user?.balance)} HYPE</strong>
            </div>
            <div style={{ marginBottom: 10, fontSize: '0.85rem', color: '#ffaa00' }}>
              Minimum withdraw is {config?.min_withdraw || 1} HYPE
            </div>
            <div style={{ marginBottom: 12, fontSize: '0.85rem', color: '#00ff88' }}>
              <Icon name="ban" size={14} /> We don’t charge any fees
            </div>
            <input
              className="input"
              placeholder="Amount (HYPE)"
              type="number"
              value={wdAmount}
              onChange={(e) => setWdAmount(e.target.value)}
            />
            <input
              className="input"
              placeholder="Your Hyperliquid / EVM wallet address"
              value={wdWallet}
              onChange={(e) => setWdWallet(e.target.value)}
            />
            <button className="btn btn-primary" style={{ width: '100%' }} onClick={requestWithdraw}>
              Request Withdrawal
            </button>
          </div>

          <div className="card">
            <div className="card-title">History</div>
            {withdrawals.length === 0 && <div style={{ color: '#666' }}>No requests yet</div>}
            {withdrawals.map((w) => (
              <div key={w.id} style={{ padding: '8px 0', borderBottom: '1px solid rgba(0,255,136,0.1)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>{w.amount} HYPE</span>
                  <span
                    style={{
                      color:
                        w.status === 'approved'
                          ? '#00ff88'
                          : w.status === 'rejected'
                          ? '#ff5566'
                          : '#ffaa00',
                    }}
                  >
                    {w.status}
                  </span>
                </div>
                <div style={{ fontSize: '0.75rem', color: '#666', marginTop: 2 }}>
                  {new Date(w.created_at * 1000).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ADMIN PANEL */}
      {tab === 'admin' && user?.is_admin && (
        <div className="page">
          <h3 style={{ color: '#f0d878', marginBottom: 12 }}><Icon name="settings" size={16} /> Admin Panel</h3>
          <div className="admin-tabs">
            {['stats', 'settings', 'users', 'referrals', 'withdrawals', 'tasks', 'broadcast'].map((t) => (
              <button
                key={t}
                className={`admin-tab ${adminTab === t ? 'active' : ''}`}
                onClick={() => setAdminTab(t)}
              >
                {t}
              </button>
            ))}
          </div>

          {adminTab === 'stats' && adminStats && (
            <div className="card">
              <div>Total Users: <strong>{adminStats.total_users}</strong></div>
              <div>Pending Withdrawals: <strong>{adminStats.pending_withdrawals}</strong></div>
              <div>Total Balance in App: <strong>{formatNum(adminStats.total_balance)}</strong></div>
              <div>Total Earned: <strong>{formatNum(adminStats.total_earned)}</strong></div>
            </div>
          )}

          {/* SETTINGS - manage tap reward, energy, etc. */}
          {adminTab === 'settings' && (
            <div className="card">
              <div className="card-title"><Icon name="settings" size={16} /> Live App Controls</div>
              <div style={{ fontSize: '0.78rem', color: '#888', marginBottom: 12 }}>
                Yahan change karoge → turant pure app par apply hoga (naye taps / naye referrals par)
              </div>

              <label style={{ fontSize: '0.8rem', color: '#a0ffc0' }}><Icon name="flame" size={14} /> Per Tap Points (HYPE)</label>
              <input className="input" type="number" step="any" value={settingsForm.tap_reward}
                onChange={(e) => setSettingsForm({ ...settingsForm, tap_reward: e.target.value })}
                placeholder="e.g. 0.0000000695" />

              <label style={{ fontSize: '0.8rem', color: '#a0ffc0' }}><Icon name="users" size={14} /> Per Referral Points (HYPE)</label>
              <input className="input" type="number" step="any" value={settingsForm.referral_reward}
                onChange={(e) => setSettingsForm({ ...settingsForm, referral_reward: e.target.value })}
                placeholder="e.g. 0.00008526" />

              <label style={{ fontSize: '0.8rem', color: '#a0ffc0' }}><Icon name="coins" size={14} /> Min Withdraw (HYPE)</label>
              <input className="input" type="number" step="any" value={settingsForm.min_withdraw}
                onChange={(e) => setSettingsForm({ ...settingsForm, min_withdraw: e.target.value })}
                placeholder="e.g. 2" />

              <label style={{ fontSize: '0.8rem', color: '#a0ffc0' }}><Icon name="zap" size={14} /> Max Energy</label>
              <input className="input" type="number" value={settingsForm.energy_max}
                onChange={(e) => setSettingsForm({ ...settingsForm, energy_max: e.target.value })}
                placeholder="e.g. 1000" />

              <label style={{ fontSize: '0.8rem', color: '#a0ffc0' }}><Icon name="clock" size={14} /> Energy Cooldown (seconds)</label>
              <input className="input" type="number" value={settingsForm.energy_cooldown}
                onChange={(e) => setSettingsForm({ ...settingsForm, energy_cooldown: e.target.value })}
                placeholder="e.g. 3600" />

              <label style={{ fontSize: '0.8rem', color: '#a0ffc0' }}><Icon name="calendar" size={14} /> Daily Check-in Reward (HYPE)</label>
              <input className="input" type="number" step="any" value={settingsForm.daily_checkin_reward}
                onChange={(e) => setSettingsForm({ ...settingsForm, daily_checkin_reward: e.target.value })}
                placeholder="e.g. 0.001" />

              <button className="btn btn-primary" style={{ width: '100%', marginTop: 8 }} onClick={saveSettings}>
                <Icon name="save" size={14} /> Save & Apply Live
              </button>
              {adminSettings && (
                <div style={{ marginTop: 12, fontSize: '0.8rem', color: 'rgba(0,255,136,0.7)', lineHeight: 1.5 }}>
                  <strong>Live values:</strong><br />
                  Tap: {formatNum(adminSettings.tap_reward, 12)} • Referral: {formatNum(adminSettings.referral_reward, 12)}<br />
                  Min WD: {formatNum(adminSettings.min_withdraw, 8)} • Energy: {adminSettings.energy_max} / {adminSettings.energy_cooldown}s<br />
                  Daily Check-in: {formatNum(adminSettings.daily_checkin_reward, 12)}
                </div>
              )}
            </div>
          )}

          {/* USERS / LEADERBOARD manage */}
          {adminTab === 'users' && (
            <>
              <div className="card">
                <div className="card-title"><Icon name="user" size={16} /> Edit User Points (Leaderboard control)</div>
                <div style={{ fontSize: '0.75rem', color: '#888', marginBottom: 8 }}>
                  Balance / Total Earned badalne se leaderboard rank turant change hoga
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input className="input" style={{ marginBottom: 0 }} placeholder="User Telegram ID" value={editUserId}
                    onChange={(e) => setEditUserId(e.target.value)} />
                  <button className="btn btn-outline" onClick={() => loadUserDetails(editUserId)}>Load</button>
                </div>
                {editUserId && editUserData.balance !== '' && (
                  <div style={{ marginTop: 12 }}>
                    <label style={{ fontSize: '0.8rem', color: '#a0ffc0' }}>Balance</label>
                    <input className="input" type="number" step="any" value={editUserData.balance}
                      onChange={(e) => setEditUserData({ ...editUserData, balance: e.target.value })} />
                    <label style={{ fontSize: '0.8rem', color: '#a0ffc0' }}>Total Earned</label>
                    <input className="input" type="number" step="any" value={editUserData.total_earned}
                      onChange={(e) => setEditUserData({ ...editUserData, total_earned: e.target.value })} />
                    <label style={{ fontSize: '0.8rem', color: '#a0ffc0' }}>Total Taps</label>
                    <input className="input" type="number" value={editUserData.total_taps}
                      onChange={(e) => setEditUserData({ ...editUserData, total_taps: e.target.value })} />
                    <label style={{ fontSize: '0.8rem', color: '#a0ffc0' }}>Invite Count</label>
                    <input className="input" type="number" value={editUserData.invite_count}
                      onChange={(e) => setEditUserData({ ...editUserData, invite_count: e.target.value })} />
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0' }}>
                      <input type="checkbox" checked={editUserData.is_admin}
                        onChange={(e) => setEditUserData({ ...editUserData, is_admin: e.target.checked })} />
                      Is Admin
                    </label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn btn-primary" style={{ flex: 1 }} onClick={saveUserEdit}>Save User</button>
                      <button className="btn btn-danger" style={{ flex: 1 }} onClick={() => deleteUser(editUserId)}>Delete</button>
                    </div>
                  </div>
                )}
              </div>

              <div className="card-title" style={{ margin: '12px 0 8px', color: '#00ff88' }}>Top Users (Leaderboard)</div>
              {adminLeaderboard.length === 0 && <div className="card">No users yet</div>}
              {adminLeaderboard.map((u, i) => (
                <div className="card" key={u.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px' }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>#{i + 1} @{u.username || u.first_name || u.id}</div>
                    <div style={{ fontSize: '0.8rem', color: '#00ff88' }}>
                      {formatNum(u.total_earned, 6)} earned • Bal {formatNum(u.balance, 4)} • Inv {u.invite_count || 0}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: '#666' }}>ID: {u.id}</div>
                  </div>
                  <button className="btn btn-outline" style={{ padding: '6px 10px', fontSize: '0.75rem' }}
                    onClick={() => { setEditUserId(String(u.id)); loadUserDetails(u.id); window.scrollTo(0, 0); }}>
                    Edit
                  </button>
                </div>
              ))}
            </>
          )}

          {/* REFERRALS admin list */}
          {adminTab === 'referrals' && (
            <>
              <div className="card-title" style={{ marginBottom: 8, color: '#00ff88' }}>All Referrals</div>
              {adminReferrals.length === 0 && <div className="card">No referrals yet</div>}
              {adminReferrals.map((r) => (
                <div className="card" key={r.id} style={{ padding: '10px 14px' }}>
                  <div style={{ fontWeight: 600 }}>
                    @{r.referrer_name || r.referrer_id} → @{r.referred_name || r.referred_id}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: '#00ff88' }}>
                    Reward: +{formatNum(r.reward, 12)} HYPE • ID: {r.id}
                  </div>
                </div>
              ))}
            </>
          )}

          {adminTab === 'withdrawals' && (
            <>
              {adminWithdrawals.length === 0 && <div className="card">No pending withdrawals</div>}
              {adminWithdrawals.map((w) => (
                <div className="card" key={w.id}>
                  <div>
                    @{w.username || w.user_id} • <strong>{w.amount} HYPE</strong>
                  </div>
                  <div style={{ fontSize: '0.8rem', wordBreak: 'break-all', margin: '6px 0' }}>
                    {w.wallet_address}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-primary" style={{ flex: 1, padding: 8 }} onClick={() => adminAction(w.id, 'approve')}>
                      Approve
                    </button>
                    <button className="btn btn-outline" style={{ flex: 1, padding: 8 }} onClick={() => adminAction(w.id, 'processing')}>
                      Processing
                    </button>
                    <button className="btn btn-danger" style={{ flex: 1, padding: 8 }} onClick={() => adminAction(w.id, 'reject')}>
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}

          {adminTab === 'tasks' && (
            <>
              <div className="card">
                <div className="card-title">Add New Task</div>
                <input className="input" placeholder="Title" value={newTask.title} onChange={(e) => setNewTask({ ...newTask, title: e.target.value })} />
                <select className="input" value={newTask.type} onChange={(e) => setNewTask({ ...newTask, type: e.target.value })}>
                  <option value="telegram">Telegram Channel</option>
                  <option value="youtube">YouTube</option>
                </select>
                <input className="input" placeholder="Link" value={newTask.link} onChange={(e) => setNewTask({ ...newTask, link: e.target.value })} />
                <input className="input" placeholder="Reward HYPE" value={newTask.reward} onChange={(e) => setNewTask({ ...newTask, reward: e.target.value })} />
                <button className="btn btn-primary" style={{ width: '100%' }} onClick={addTask}>
                  Add Task
                </button>
              </div>
              {adminTasks.map((t) => (
                <div className="card" key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div>{t.title}</div>
                    <div style={{ fontSize: '0.8rem', color: '#00ff88' }}>+{formatNum(t.reward, 12)} • {t.type}</div>
                  </div>
                  <button className="btn btn-danger" style={{ padding: '6px 12px' }} onClick={() => deleteTask(t.id)}>
                    Delete
                  </button>
                </div>
              ))}
            </>
          )}

          {adminTab === 'broadcast' && (
            <div className="card">
              <div className="card-title"><Icon name="megaphone" size={16} /> Advanced Broadcast</div>
              <div style={{ fontSize: '0.75rem', color: '#888', marginBottom: 10 }}>
                Text only, Photo only, ya dono — sab users ko Telegram par bheja jayega
              </div>

              <label style={{ fontSize: '0.8rem', color: '#a0ffc0' }}><Icon name="image" size={14} /> Photo URL (optional)</label>
              <input
                className="input"
                type="url"
                placeholder="https://example.com/image.jpg"
                value={broadcastPhoto}
                onChange={(e) => setBroadcastPhoto(e.target.value)}
              />
              {broadcastPhoto.trim() && (
                <div style={{ marginBottom: 12, textAlign: 'center' }}>
                  <img
                    src={broadcastPhoto.trim()}
                    alt="Preview"
                    style={{ maxWidth: '100%', maxHeight: 180, borderRadius: 12, border: '1px solid rgba(0,255,136,0.3)' }}
                    onError={(e) => { e.target.style.display = 'none'; }}
                  />
                </div>
              )}

              <label style={{ fontSize: '0.8rem', color: '#a0ffc0' }}><Icon name="message" size={14} /> Message / Caption</label>
              <textarea
                className="input"
                rows={4}
                placeholder="Message to all users... (photo ke saath caption bhi ban sakta hai)"
                value={broadcastMsg}
                onChange={(e) => setBroadcastMsg(e.target.value)}
                style={{ resize: 'vertical' }}
              />

              <button
                className="btn btn-gold"
                style={{ width: '100%', opacity: broadcastSending ? 0.7 : 1 }}
                onClick={sendBroadcast}
                disabled={broadcastSending}
              >
                {broadcastSending ? <><Icon name="clock" size={14} /> Sending to all users...</> : <><Icon name="rocket" size={14} /> Send Broadcast to Everyone</>}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Bottom Nav */}
      <div className="bottom-nav">
        <button className={`nav-item ${tab === 'tap' ? 'active' : ''}`} onClick={() => setTab('tap')}>
          <span className="nav-icon-wrap"><Icon name="zap" size={22} /></span>
          <span className="nav-label">Mine</span>
        </button>
        <button className={`nav-item ${tab === 'tasks' ? 'active' : ''}`} onClick={() => setTab('tasks')}>
          <span className="nav-icon-wrap"><Icon name="gift" size={22} /></span>
          <span className="nav-label">Tasks</span>
        </button>
        <button className={`nav-item ${tab === 'friends' ? 'active' : ''}`} onClick={() => setTab('friends')}>
          <span className="nav-icon-wrap"><Icon name="users" size={22} /></span>
          <span className="nav-label">Friends</span>
        </button>
        <button className={`nav-item ${tab === 'leaderboard' ? 'active' : ''}`} onClick={() => setTab('leaderboard')}>
          <span className="nav-icon-wrap"><Icon name="trophy" size={22} /></span>
          <span className="nav-label">Rank</span>
        </button>
        <button className={`nav-item ${tab === 'wallet' ? 'active' : ''}`} onClick={() => setTab('wallet')}>
          <span className="nav-icon-wrap"><Icon name="wallet" size={22} /></span>
          <span className="nav-label">Wallet</span>
        </button>
      </div>
    </div>
  );
}
