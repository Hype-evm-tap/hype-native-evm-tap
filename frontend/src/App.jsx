import React, { useState, useEffect, useCallback, useRef } from 'react';

const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
  tg.setHeaderColor('#0a0804');
  tg.setBackgroundColor('#050403');
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
  ton: (<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="#0098EA"/><path d="M8.3 9.5h15.4c1.6 0 2.6 1.7 1.8 3.1L17.7 25c-.8 1.4-2.6 1.4-3.4 0L6.5 12.6c-.8-1.4.2-3.1 1.8-3.1Zm3.1 3.1 4.6 8 4.6-8h-9.2Z" fill="#fff"/></svg>),
  eth: (<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="#627EEA"/><path d="M16 4.5 8.8 16.3 16 20.5l7.2-4.2L16 4.5Zm0 17.4-7.2-4.2L16 27.5l7.2-9.8-7.2 4.2Z" fill="#fff" opacity=".95"/></svg>),
  usdt: (<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="#26A17B"/><path fill="#fff" d="M17.9 17.4v-.1c-.1 0-.8.1-2 .1s-1.9-.1-2-.1v.1c-4.4-.2-7.7-1-7.7-2s3.3-1.8 7.7-2v3.2c.1 0 1 .1 2 .1s1.9-.1 2-.1v-3.2c4.4.2 7.7 1 7.7 2s-3.3 1.8-7.7 2Zm0-5.2V9.4h6.2V6.5H7.9v2.9h6.2v2.8C9 12.4 5 13.6 5 15.1v3.1c0 1.5 4 2.7 9.1 2.9v4.4h3.8v-4.4c5.1-.2 9.1-1.4 9.1-2.9v-3.1c0-1.5-4-2.7-9.1-2.9Z"/></svg>),
  hype: (<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="#101510" stroke="#00E887" strokeWidth="1.5"/><path d="M8 7h4v7h8V7h4v18h-4v-7h-8v7H8V7Z" fill="#00E887"/></svg>),
  telegram: (<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21.7 3.3 18.6 20c-.2 1.2-.9 1.5-1.8.9l-5-3.7-2.4 2.3c-.3.3-.5.5-1 .5l.4-5.1 9.3-8.4c.4-.4-.1-.6-.6-.2L6 13.5 1 12c-1.1-.3-1.1-1 .2-1.5L20.5 3c.9-.3 1.6.2 1.2 1.3Z"/></svg>),
  youtube: (<svg viewBox="0 0 24 24" fill="currentColor"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8ZM9.6 15.6V8.4L15.8 12l-6.2 3.6Z"/></svg>),
  globe: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/></svg>),
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

function Icon({ name, className = '', size = 18, title = '' }) {
  const svg = SVGS[name];
  if (!svg) return null;
  return (
    <span className={`svg-icon ${className}`.trim()} style={{ width: size, height: size }} title={title || undefined} aria-label={title || undefined}>
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
  const [pendingTasks, setPendingTasks] = useState([]);
  const [taskVerification, setTaskVerification] = useState({});
  const taskVerificationRef = useRef(taskVerification);
  useEffect(() => { taskVerificationRef.current = taskVerification; }, [taskVerification]);
  const [taskCountdown, setTaskCountdown] = useState({});
  const [referrals, setReferrals] = useState([]);
  const [withdrawals, setWithdrawals] = useState([]);
  const [history, setHistory] = useState([]);
  const [adminHistory, setAdminHistory] = useState([]);
  const [tonWallet, setTonWallet] = useState(null);
  const tonConnectUIRef = useRef(null);
  const tonProofVerifyingRef = useRef(false);
  const [depositNetwork, setDepositNetwork] = useState('bep20');
  const [depositHash, setDepositHash] = useState('');
  const [depositBusy, setDepositBusy] = useState(false);
  const [depositData, setDepositData] = useState({ deposits: [], balances: { ton: 0, bep20: 0, trc20: 0 }, wallets: {} });
  const [energyLeft, setEnergyLeft] = useState(1000);
  const [resetAt, setResetAt] = useState(0);
  const [waitSec, setWaitSec] = useState(0);
  const [tapAnim, setTapAnim] = useState(0);
  const [coins, setCoins] = useState([]); // scatter coins on tap
  const [candles, setCandles] = useState([]); // OHLCV from Hyperliquid
  const [chartInterval, setChartInterval] = useState('1h');
  const [mcap, setMcap] = useState(0);
  const [supplyStats, setSupplyStats] = useState(null);
  const [dayChange, setDayChange] = useState(0);
  const [dayVol, setDayVol] = useState(0);
  const [dayHigh, setDayHigh] = useState(0);
  const [dayLow, setDayLow] = useState(0);
  const [chartLoading, setChartLoading] = useState(true);
  const [selectedMinerLevel, setSelectedMinerLevel] = useState(1);
  const [isOnline, setIsOnline] = useState(false); // start OFFLINE until verified
  const [onlineChecked, setOnlineChecked] = useState(false);

  // Admin
  const [adminTab, setAdminTab] = useState('stats');
  const [adminStats, setAdminStats] = useState(null);
  const [adminWithdrawals, setAdminWithdrawals] = useState([]);
  const [adminWdFilter, setAdminWdFilter] = useState('pending'); // pending | approved | rejected | processing
  const [adminTasks, setAdminTasks] = useState([]);
  const [adminSettings, setAdminSettings] = useState(null);
  const [adminLeaderboard, setAdminLeaderboard] = useState([]);
  const [adminReferrals, setAdminReferrals] = useState([]);
  const [editUserId, setEditUserId] = useState('');
  const [editUserData, setEditUserData] = useState({ balance: '', total_earned: '', total_taps: '', is_admin: false, invite_count: '' });
  const [settingsForm, setSettingsForm] = useState({ tap_reward: '', referral_reward: '', min_withdraw: '', energy_max: '', energy_cooldown: '', daily_checkin_reward: '', streak_bonus: '0', day1: '0.0000089', day2: '0.000002', day3: '0.000006', day4: '0.000007', day5: '0.0000079', day6: '0.0000089', day7: '0.0004' });
  const [canCheckin, setCanCheckin] = useState(true);
  const [checkinWait, setCheckinWait] = useState(0);
  const [checkinBusy, setCheckinBusy] = useState(false);
  const checkinInFlight = useRef(false);
  const [broadcastMsg, setBroadcastMsg] = useState('');
  const [broadcastPhoto, setBroadcastPhoto] = useState('');

const [broadcastSending, setBroadcastSending] = useState(false);
  const [newTask, setNewTask] = useState({ title: '', type: 'telegram', link: '', reward: '0.0085' });
  const [wdAmount, setWdAmount] = useState('');
  const [wdWallet, setWdWallet] = useState('');
  const [connectedWallet, setConnectedWallet] = useState('');
  const [walletConnecting, setWalletConnecting] = useState(false);
  const [swapTokens, setSwapTokens] = useState([]);
  const [swapTokenAddress, setSwapTokenAddress] = useState('');
  const [swapAmount, setSwapAmount] = useState('');
  const [swapQuote, setSwapQuote] = useState(null);
  const [swapBusy, setSwapBusy] = useState(false);
  const [swapStatus, setSwapStatus] = useState('');
  const swapProviderRef = useRef(null);
  // Daily check-in streak (7-day)
  const [streak, setStreak] = useState(0);
  const [streakTotalEarned, setStreakTotalEarned] = useState(0);
  const [checkinRewards, setCheckinRewards] = useState([0.0000089, 0.000002, 0.000006, 0.000007, 0.0000079, 0.0000089, 0.0004]);

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
    // Always read live initData from WebApp (not a stale const)
    const live = window.Telegram?.WebApp?.initData || tg?.initData || '';
    if (live) h['X-Telegram-Init-Data'] = live;
    return h;
  };

  const api = async (path, opts = {}) => {
    try {
      const res = await fetch(API + path, {
        ...opts,
        headers: { ...headers(), ...(opts.headers || {}) },
      });
      const text = await res.text();
      let data = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { error: text?.slice?.(0, 120) || `HTTP ${res.status}` };
      }
      if (!res.ok) {
        return { error: data.error || data.message || `Request failed (${res.status})`, status: res.status, ...data };
      }
      return data;
    } catch (e) {
      return { error: e?.message || 'Network error' };
    }
  };

  // Wait until Telegram WebApp initData is available (fixes empty header → Unauthorized)
  const waitForTelegram = () =>
    new Promise((resolve) => {
      const tgApp = window.Telegram?.WebApp;
      if (tgApp?.initData) {
        resolve(tgApp);
        return;
      }
      let tries = 0;
      const iv = setInterval(() => {
        tries += 1;
        const t = window.Telegram?.WebApp;
        if (t?.initData || tries >= 25) {
          clearInterval(iv);
          resolve(t || null);
        }
      }, 100);
    });

  // Load user
  const loadUser = useCallback(async () => {
    try {
      const tgApp = await waitForTelegram();
      if (tgApp) {
        try {
          tgApp.ready();
          tgApp.expand();
        } catch (_) {}
      }

      if (!tgApp?.initData) {
        showToast('Telegram se app open karo (initData missing)');
        setLoading(false);
        return;
      }

      const startParam = tgApp?.initDataUnsafe?.start_param || null;
      const tgUser = tgApp?.initDataUnsafe?.user || { id: 0, first_name: 'Guest' };
      const data = await api('/api/user', {
        method: 'POST',
        body: JSON.stringify({ user: tgUser, start_param: startParam }),
      });

      if (data.error || data.status === 401) {
        console.error('Auth failed:', data);
        showToast(data.error === 'Unauthorized' ? 'Unauthorized — BOT_TOKEN / bot mismatch' : (data.error || 'Unauthorized'));
        setLoading(false);
        return;
      }

      if (data.user) {
        const e = Math.max(0, Number(data.user.energy) || 0);
        const ra = Number(data.user.energy_reset_at) || 0;
        setUser(data.user);
        energyRef.current = e;
        setEnergyLeft(e);
        setResetAt(ra);
        setConfig(data.config);
        setPrice(data.price || 0);
        // Daily check-in: only once per 24h (server is source of truth)
        const lastCheckinAt = Number(data.user.last_checkin_at) || 0;
        const nowTs = Math.floor(Date.now() / 1000);
        const serverWaitFromField = Number(data.user.checkin_wait) || 0;
        const serverWaitCalc = lastCheckinAt > 0 ? Math.max(0, lastCheckinAt + 86400 - nowTs) : 0;
        const serverWait = Math.max(serverWaitFromField, serverWaitCalc);
        // If last claim was < 24h ago → locked
        if (lastCheckinAt > 0 && serverWait > 0) {
          setCanCheckin(false);
          setCheckinWait(serverWait);
        } else {
          setCanCheckin(true);
          setCheckinWait(0);
        }
        if (data.user.wallet_address) {
          setWdWallet(data.user.wallet_address);
          setConnectedWallet(data.user.wallet_address);
        }
        setStreak(data.user.checkin_streak || data.user.streak || 0);
        setStreakTotalEarned(data.user.checkin_total_earned || 0);
        if (data.config?.checkin_day_rewards) setCheckinRewards(data.config.checkin_day_rewards);
      }
    } catch (e) {
      console.error(e);
      showToast('Connection error');
    } finally {
      setLoading(false);
    }
  }, []);

  // Live global HYPE supply from CoinGecko, distinct from app rewards.
  const fetchSupply = useCallback(async () => {
    try {
      const res = await fetch('https://api.coingecko.com/api/v3/coins/hyperliquid?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false');
      if (!res.ok) return;
      const data = await res.json();
      const circulating = Number(data?.market_data?.circulating_supply) || 0;
      const max = Number(data?.market_data?.max_supply) || 1000000000;
      if (circulating > 0) setSupplyStats({ circulating, max });
    } catch (_) {}
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
      if (idx >= 0) {
        const ctx = ctxs[idx] || {};
        const mark = parseFloat(ctx.markPx || ctx.midPx || 0);
        const prev = parseFloat(ctx.prevDayPx || 0);
        const vol = parseFloat(ctx.dayNtlVlm || 0);
        if (mark > 0) {
          setPrice(mark);
          setMcap(mark * 253540000);
          if (prev > 0) setDayChange(((mark - prev) / prev) * 100);
          if (vol > 0) setDayVol(vol);
          return;
        }
      }
    } catch (_) {}

    // Fallback to backend /api/price when Hyperliquid fails (Telegram WebView etc.)
    try {
      const d = await api('/api/price');
      if (d?.price > 0) {
        setPrice(d.price);
        setMcap(d.price * 253540000);
      }
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
    fetchSupply();
    const iv = setInterval(() => {
      fetchMarket();
      fetchCandles(chartInterval);
      fetchSupply();
    }, 300000);
    return () => clearInterval(iv);
  }, [loadUser, fetchMarket, fetchCandles, fetchSupply, chartInterval]);

  // Keep energyRef in sync
  useEffect(() => {
    energyRef.current = energyLeft;
  }, [energyLeft]);

  // Online / Offline status verification (ATF style: show OFFLINE until verified)
  useEffect(() => {
    const check = () => {
      const online = typeof navigator !== 'undefined' ? navigator.onLine : true;
      const visible = typeof document !== 'undefined' ? document.visibilityState === 'visible' : true;
      const tgReady = !!(window.Telegram?.WebApp?.initData);
      setIsOnline(online && visible && tgReady);
      setOnlineChecked(true);
    };
    check();
    window.addEventListener('online', check);
    window.addEventListener('offline', check);
    document.addEventListener('visibilitychange', check);
    const iv = setInterval(check, 5000);
    return () => {
      window.removeEventListener('online', check);
      window.removeEventListener('offline', check);
      document.removeEventListener('visibilitychange', check);
      clearInterval(iv);
    };
  }, []);

  // Energy countdown — ONLY renew when server cooldown (resetAt) has actually expired
  useEffect(() => {
    const maxE = config?.energy_max || 1000;
    const now = Math.floor(Date.now() / 1000);

    // Still have energy → no countdown
    if (energyLeft > 0) {
      setWaitSec(0);
      return;
    }

    // Energy empty but no cooldown timestamp yet → wait (do NOT auto-fill; prevents reset loop)
    if (!resetAt || resetAt <= 0) {
      setWaitSec(0);
      return;
    }

    const tick = () => {
      const t = Math.floor(Date.now() / 1000);
      const left = Math.max(0, resetAt - t);
      setWaitSec(left);
      if (left <= 0) {
        // Cooldown finished → renew locally (server will also renew on next /api/user or /api/tap)
        setEnergyLeft(maxE);
        setResetAt(0);
        setWaitSec(0);
        energyRef.current = maxE;
        setUser((u) => (u ? { ...u, energy: maxE, energy_reset_at: 0 } : u));
      }
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [energyLeft, resetAt, config]);

  // Daily check-in countdown: 24 hours from the last successful claim.
  useEffect(() => {
    if (canCheckin) {
      setCheckinWait(0);
      return;
    }
    const tick = () => {
      setCheckinWait((current) => {
        const next = Math.max(0, current - 1);
        if (next === 0) setCanCheckin(true);
        return next;
      });
    };
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [canCheckin]);

  const wcProviderRef = useRef(null);

const persistWallet = async (addr, walletProvider = null) => {
    const clean = String(addr || '').trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(clean)) {
      showToast('Invalid EVM address');
      return false;
    }
    try {
      const challenge = await api('/api/wallet/challenge', {
        method: 'POST',
        body: JSON.stringify({ address: clean }),
      });
      if (!challenge?.message) throw new Error(challenge?.error || 'Could not prepare sign-in message');
      const signer = walletProvider || wcProviderRef.current || window.ethereum;
      if (!signer?.request) throw new Error('Wallet session unavailable. Reconnect your wallet.');
      // EIP-1193 personal_sign: encode the challenge as 0x-prefixed UTF-8 bytes.
      const messageHex = '0x' + Array.from(new TextEncoder().encode(challenge.message))
        .map((byte) => byte.toString(16).padStart(2, '0')).join('');
      const signature = await signer.request({
        method: 'personal_sign',
        params: [messageHex, clean],
      });
      const verified = await api('/api/wallet/verify', {
        method: 'POST',
        body: JSON.stringify({ address: clean, message: challenge.message, signature }),
      });
      if (verified?.error || !verified?.success) throw new Error(verified?.error || 'Signature verification failed');
      setConnectedWallet(clean);
      setWdWallet(clean);
      showToast('Wallet ownership verified and connected');
      return true;
    } catch (e) {
      // Let the connection flow display the real signing/API error instead of
      // replacing it with a generic "connect failed" message.
      throw e;
    }
  };

  /** Injected wallet (MetaMask / Rabby) when available */
  const connectInjected = async () => {
    let eth = window.ethereum;
    if (!eth) return null;
    if (eth.providers?.length) {
      eth = eth.providers.find((p) => p.isMetaMask) || eth.providers[0];
    }
    const accounts = await eth.request({ method: 'eth_requestAccounts' });
    if (!accounts?.[0]) throw new Error('Wallet returned no account');
    return { address: accounts[0], provider: eth };
  };

  /**
   * Resolve WalletConnect Project ID from:
   * 1) Vite build env  2) window inject  3) /api/config (Cloudflare [vars])
   */
  const getWcProjectId = async () => {
    try {
      const fromVite = (import.meta.env?.VITE_WALLETCONNECT_PROJECT_ID || '').trim();
      if (fromVite) return fromVite;
    } catch (_) {}
    const fromWindow =
      (typeof window !== 'undefined' &&
        (window.__WC_PROJECT_ID__ ||
          window.__ENV__?.VITE_WALLETCONNECT_PROJECT_ID ||
          window.__ENV__?.WALLETCONNECT_PROJECT_ID)) ||
      '';
    if (fromWindow) return String(fromWindow).trim();
    try {
      const cfg = await api('/api/config');
      const id = cfg?.walletConnectProjectId || cfg?.WALLETCONNECT_PROJECT_ID || '';
      if (id) return String(id).trim();
    } catch (_) {}
    return '';
  };

  /**
   * WalletConnect v2 — MetaMask / Trust / Binance / Rainbow via QR + deep link
   * npm i @walletconnect/ethereum-provider
   */
  const connectWalletConnect = async () => {
    const projectId = await getWcProjectId();
    if (!projectId) {
      throw new Error('WalletConnect Project ID missing — add /api/config route + WALLETCONNECT_PROJECT_ID in Worker vars');
    }

    const { default: EthereumProvider } = await import('@walletconnect/ethereum-provider');

    if (wcProviderRef.current) {
      try { await wcProviderRef.current.disconnect(); } catch (_) {}
      wcProviderRef.current = null;
    }

    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://localhost';
    const inTelegram = Boolean(window.Telegram?.WebApp?.initData);

    // In Telegram's Android WebView, the default WalletConnect modal can open
    // Trust Wallet without forwarding the pairing URI. Use Trust's documented
    // WalletConnect deep link so the exact pending session reaches the wallet.
    const provider = await EthereumProvider.init({
      projectId,
      // Wallet ownership signing is chain-independent. Use Ethereum Mainnet
      // as the broadly supported required namespace so Trust Wallet and other
      // WalletConnect apps can establish a session; HyperEVM remains optional
      // and is selected by the user when they perform a HYPE swap.
      chains: [1],
      optionalChains: [999, 56],
      // Keep the WalletConnect explorer modal enabled inside Telegram too.
      // It lists all compatible wallet apps (including Trust Wallet) rather
      // than hard-routing every user to Trust Wallet.
      showQrModal: true,
      // Only account access and personal message signing are needed.
      // No transaction signing or transfer permissions are requested.
      methods: ['personal_sign', 'eth_accounts', 'eth_requestAccounts', 'eth_sendTransaction', 'eth_call', 'eth_getTransactionReceipt', 'eth_chainId'],
      events: ['chainChanged', 'accountsChanged', 'disconnect', 'session_delete'],
      rpcMap: {
        999: 'https://rpc.hyperliquid.xyz/evm',
        1: 'https://ethereum.publicnode.com',
        56: 'https://bsc-dataseed.binance.org',
      },
      metadata: {
        name: 'Hype Token',
        description: 'Hype EVM Native — Tap to Earn',
        url: origin,
        icons: [`${origin}/hype-logo.png`],
      },
      qrModalOptions: {
        themeMode: 'dark',
        themeVariables: {
          '--wcm-z-index': '100000',
          '--w3m-z-index': '100000',
        },
      },
    });

    wcProviderRef.current = provider;

    provider.on('accountsChanged', (accounts) => {
      if (accounts?.[0]) { setConnectedWallet(''); setWdWallet(''); }
      else {
        setConnectedWallet('');
        setWdWallet('');
      }
    });
    provider.on('disconnect', () => {
      setConnectedWallet('');
      setWdWallet('');
      wcProviderRef.current = null;
    });
    provider.on('session_delete', () => {
      setConnectedWallet('');
      setWdWallet('');
      wcProviderRef.current = null;
    });

// enable() opens QR modal and waits for wallet approval
    await provider.enable();
    const accounts = provider.accounts?.length
      ? provider.accounts
      : await provider.request({ method: 'eth_accounts' });
    return accounts?.[0] || null;
  };

  const connectExternalWallet = async () => {
    if (connectedWallet || walletConnecting) return;
    setWalletConnecting(true);

    // Telegram Mini Apps run inside Telegram's WebView. An injected ethereum
    // provider there can hand off to Trust Wallet without creating a WalletConnect
    // session, which leaves Trust Wallet open with no sign-in request. Prefer
    // WalletConnect in Telegram; use injected providers in a normal wallet browser.
    const inTelegram = Boolean(window.Telegram?.WebApp?.initData);

    const connectWithWalletConnect = async () => {
      const addr = await connectWalletConnect();
      if (!addr) throw new Error('WalletConnect returned no account');
      const saved = await persistWallet(addr, wcProviderRef.current);
      if (!saved) throw new Error('Wallet ownership verification failed. Please try again.');
      swapProviderRef.current = wcProviderRef.current;
      return true;
    };

    const connectWithInjected = async () => {
      const injected = await connectInjected();
      if (!injected) return false;
      const saved = await persistWallet(injected.address, injected.provider);
      if (saved) swapProviderRef.current = injected.provider;
      return saved;
    };

    try {
      if (inTelegram) {
        try {
          await connectWithWalletConnect();
          return;
        } catch (e) {
          console.warn('Telegram WalletConnect failed:', e);
          const msg = e?.message || '';
          if (msg.includes('Project ID') || msg.includes('WALLETCONNECT')) {
            showToast('WalletConnect Project ID missing. Check Worker configuration.');
          } else if (msg.includes('User rejected') || msg.includes('denied') || msg.includes('cancelled')) {
            showToast('Wallet connection cancelled');
          } else {
            showToast(msg.slice(0, 150) || 'WalletConnect failed');
          }
          return;
        }
      }

      // Outside Telegram, prefer the wallet's injected provider.
      try {
        if (await connectWithInjected()) return;
      } catch (e) {
        console.warn('Injected wallet failed:', e);
      }

      try {
        await connectWithWalletConnect();
      } catch (e) {
        console.warn('WalletConnect failed:', e);
        showToast(String(e?.message || 'Wallet connection failed').slice(0, 150));
      }
    } catch (e) {
      showToast(String(e?.message || 'Connection failed').slice(0, 150));
    } finally {
      setWalletConnecting(false);
    }
  };

  const disconnectWallet = async () => {
    try {
      if (wcProviderRef.current) {
        await wcProviderRef.current.disconnect();
        wcProviderRef.current = null;
      }
    } catch (_) {}
    setConnectedWallet('');
    setWdWallet('');
    swapProviderRef.current = null;
    setSwapQuote(null);
    try {
      await api('/api/wallet', {
        method: 'POST',
        body: JSON.stringify({ user: tg?.initDataUnsafe?.user, wallet_address: '' }),
      });
    } catch (_) {}
    showToast('Wallet disconnected');
  };
  const HYPE_NATIVE_TOKEN = '0x0000000000000000000000000000000000000000';
  const LI_FI_API = 'https://li.quest/v1';

  const loadSwapTokens = async () => {
    try {
      const response = await fetch(LI_FI_API + '/tokens?chains=999');
      const data = await response.json();
      if (!response.ok) throw new Error(data?.message || 'Could not load HyperEVM tokens');
      const list = (data?.tokens?.['999'] || []).filter(t => t && t.address && t.symbol && t.address.toLowerCase() !== HYPE_NATIVE_TOKEN);
      setSwapTokens(list);
      if (list.length && !list.some(t => t.address.toLowerCase() === swapTokenAddress.toLowerCase())) setSwapTokenAddress(list[0].address);
    } catch (e) { showToast(String(e?.message || 'Token list unavailable').slice(0, 90)); }
  };

  useEffect(() => { loadSwapTokens(); }, []);

  const decimalToUnits = (value, decimals) => {
    const raw = String(value || '').trim();
    if (!/^\d+(\.\d*)?$/.test(raw)) throw new Error('Enter a valid amount');
    const parts = raw.split('.');
    const whole = parts[0], fraction = parts[1] || '';
    if (fraction.length > decimals) throw new Error('Too many decimal places');
    return (BigInt(whole) * (10n ** BigInt(decimals)) + BigInt((fraction + '0'.repeat(decimals)).slice(0, decimals) || '0')).toString();
  };

  const unitsToDecimal = (value, decimals, precision = 8) => {
    const n = BigInt(value || '0'), base = 10n ** BigInt(decimals);
    const whole = n / base;
    const frac = (n % base).toString().padStart(decimals, '0').slice(0, precision).replace(/0+$/, '');
    return frac ? whole.toString() + '.' + frac : whole.toString();
  };

  const getSwapProvider = () => {
    const provider = swapProviderRef.current || wcProviderRef.current || window.ethereum;
    if (!provider?.request) throw new Error('Reconnect your wallet to enable swaps');
    return provider;
  };

  const requestSwapQuote = async () => {
    try {
      if (!connectedWallet) throw new Error('Connect your wallet first');
      const token = swapTokens.find(t => t.address.toLowerCase() === swapTokenAddress.toLowerCase());
      if (!token) throw new Error('Choose a supported HyperEVM token');
      const fromAmount = decimalToUnits(swapAmount, Number(token.decimals));
      if (BigInt(fromAmount) <= 0n) throw new Error('Amount must be greater than zero');
      setSwapBusy(true); setSwapStatus('Getting live route…'); setSwapQuote(null);
      const params = new URLSearchParams({
        fromChain: '999', toChain: '999', fromToken: token.address,
        toToken: HYPE_NATIVE_TOKEN, fromAmount, fromAddress: connectedWallet,
        slippage: '0.005', order: 'RECOMMENDED'
      });
      const response = await fetch(LI_FI_API + '/quote?' + params.toString());
      const quote = await response.json();
      if (!response.ok || quote?.message || !quote?.transactionRequest) throw new Error(quote?.message || quote?.error || 'No executable route found for this token and amount');
      if (Number(quote.fromChainId) !== 999 || Number(quote.toChainId) !== 999) throw new Error('Unexpected network in quote');
      setSwapQuote(quote); setSwapStatus('Quote ready. Review the estimate and confirm in your wallet.');
    } catch (e) { setSwapQuote(null); setSwapStatus(''); showToast(String(e?.message || 'Quote failed').slice(0, 110)); }
    finally { setSwapBusy(false); }
  };

  const waitForSwapReceipt = async (provider, hash) => {
    for (let i = 0; i < 90; i++) {
      const receipt = await provider.request({ method: 'eth_getTransactionReceipt', params: [hash] });
      if (receipt) {
        if (receipt.status === '0x0') throw new Error('Transaction reverted on-chain');
        return receipt;
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    throw new Error('Transaction sent; confirmation is delayed. Check your wallet activity.');
  };

  const executeNativeHypeSwap = async () => {
    if (!swapQuote || swapBusy) return;
    const provider = getSwapProvider();
    setSwapBusy(true);
    try {
      setSwapStatus('Checking wallet network…');
      const chainHex = await provider.request({ method: 'eth_chainId' });
      if (Number.parseInt(chainHex, 16) !== 999) throw new Error('Switch wallet to HyperEVM (Chain ID 999) and request a fresh quote');
      const accounts = await provider.request({ method: 'eth_accounts' });
      if (!accounts?.[0] || accounts[0].toLowerCase() !== connectedWallet.toLowerCase()) throw new Error('Connected wallet changed. Reconnect.');
      const token = swapTokens.find(t => t.address.toLowerCase() === swapTokenAddress.toLowerCase());
      if (!token) throw new Error('Token is no longer available');
      const word = v => v.toLowerCase().replace(/^0x/, '').padStart(64, '0');
      const approvalAddress = swapQuote.estimate?.approvalAddress;
      if (approvalAddress) {
        if (!/^0x[a-fA-F0-9]{40}$/.test(approvalAddress)) throw new Error('Invalid approval contract in route');
        setSwapStatus('Checking token allowance…');
        const allowanceData = '0xdd62ed3e' + word(connectedWallet) + word(approvalAddress);
        const allowanceHex = await provider.request({method:'eth_call',params:[{to:token.address,data:allowanceData},'latest']});
        const required = BigInt(swapQuote.action?.fromAmount || '0');
        if (BigInt(allowanceHex || '0x0') < required) {
          setSwapStatus('Approve token spending in your wallet…');
          const approveData = '0x095ea7b3' + word(approvalAddress) + 'f'.repeat(64);
          const approveHash = await provider.request({method:'eth_sendTransaction',params:[{from:connectedWallet,to:token.address,data:approveData,value:'0x0'}]});
          await waitForSwapReceipt(provider, approveHash);
        }
      }
      setSwapStatus('Refreshing executable route…');
      const params = new URLSearchParams({
        fromChain:'999',toChain:'999',fromToken:token.address,toToken:HYPE_NATIVE_TOKEN,
        fromAmount:decimalToUnits(swapAmount,Number(token.decimals)),fromAddress:connectedWallet,
        slippage:'0.005',order:'RECOMMENDED'
      });
      const response = await fetch(LI_FI_API + '/quote?' + params.toString());
      const quote = await response.json();
      if (!response.ok || !quote?.transactionRequest) throw new Error(quote?.message || 'Route expired. Request a new quote.');
      const tx = quote.transactionRequest;
      if (Number(tx.chainId) !== 999 || !/^0x[a-fA-F0-9]{40}$/.test(tx.to || '') ||
          !/^0x[a-fA-F0-9]*$/.test(tx.data || '') ||
          (tx.from && tx.from.toLowerCase() !== connectedWallet.toLowerCase())) throw new Error('Route failed transaction safety checks');
      const transaction = {from:connectedWallet,to:tx.to,data:tx.data || '0x',value:tx.value || '0x0'};
      if (tx.gasLimit) transaction.gas = tx.gasLimit;
      if (tx.gasPrice) transaction.gasPrice = tx.gasPrice;
      setSwapStatus('Confirm the swap transaction in your wallet…');
      const hash = await provider.request({method:'eth_sendTransaction',params:[transaction]});
      setSwapStatus('Transaction sent. Waiting for HyperEVM confirmation…');
      await waitForSwapReceipt(provider, hash);
      setSwapQuote(null); setSwapAmount('');
      setSwapStatus('Swap complete · ' + hash);
      showToast('Native HYPE swap completed');
    } catch (e) { setSwapStatus(''); showToast(String(e?.message || 'Swap failed').slice(0, 110)); }
    finally { setSwapBusy(false); }
  };


  const shortAddr = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');

  const doCheckin = async () => {
    // Prevent duplicate requests while a claim is being processed.
    if (checkinInFlight.current) return;
    if (!canCheckin) {
      showToast(`Next check-in in ${formatTime(checkinWait)}`);
      return;
    }
    checkinInFlight.current = true;
    setCheckinBusy(true);
    try {
      const tgUser = tg?.initDataUnsafe?.user || { id: 0, first_name: 'Guest' };
      const data = await api('/api/checkin', {
        method: 'POST',
        body: JSON.stringify({ user: tgUser }),
      });

      if (data?.success) {
        const day = Number(data.day || data.streak || (streak + 1));
        showToast(`Day ${day} Check-in +${formatNum(data.reward, 12)} HYPE`);
        setCanCheckin(false);
        setCheckinWait(86400);
        if (data.streak != null) setStreak(Number(data.streak));
        else setStreak((x) => Math.min(7, x + 1));
        if (data.streak_total != null) setStreakTotalEarned(Number(data.streak_total));
        if (data.balance != null) {
          setUser((u) =>
            u
              ? {
                  ...u,
                  balance: data.balance,
                  total_earned: Number(u.total_earned || 0) + Number(data.reward || 0),
                  last_checkin_at: data.last_checkin_at || Math.floor(Date.now() / 1000),
                }
              : u
          );
        }
        await loadUser();
      } else if (data?.already) {
        setCanCheckin(false);
        setCheckinWait(Math.max(1, Number(data.wait_seconds) || 86400));

showToast(data.error || 'Already checked in today');
      } else if (data?.reset) {
        setStreak(0);
        showToast('Streak reset — start again from Day 1');
        await loadUser();
      } else {
        // Show real backend error (404 = route missing, 500 = DB column missing, etc.)
        const msg = data?.error || data?.message || 'Check-in failed';
        console.error('Check-in failed payload:', data);
        showToast(msg);
      }
    } catch (error) {
      console.error('Check-in request failed:', error);
      showToast(error?.message || 'Check-in request failed');
    } finally {
      checkinInFlight.current = false;
      setCheckinBusy(false);
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
        // Keep local energy if user kept tapping during the request
        const local = energyRef.current;
        const finalEnergy = Math.min(local, serverEnergy);
        energyRef.current = finalEnergy;
        setEnergyLeft(finalEnergy);
        // Never decrease displayed balance below what server confirms
        setUser((u) => {
          if (!u) return u;
          const serverBal = data.balance != null ? Number(data.balance) : Number(u.balance || 0);
          const earnedAdd = Number(data.earned) || 0;
          return {
            ...u,
            balance: serverBal,
            total_earned: Number(u.total_earned || 0) + earnedAdd,
            energy: finalEnergy,
            energy_reset_at: data.energy_reset_at || 0,
          };
        });
        if (finalEnergy <= 0) {
          const ra =
            Number(data.energy_reset_at) ||
            Math.floor(Date.now() / 1000) + (config?.energy_cooldown || 3600);
          setResetAt(ra);
        } else {
          setResetAt(Number(data.energy_reset_at) || 0);
        }
        if (data.earned > 0) {
          tg?.HapticFeedback?.impactOccurred?.('light');
        }
      } else if (data.error) {
        // Don't spam toast on every failed batch
        if (data.error !== 'Energy depleted') showToast(data.error);
        const serverEnergy = Math.max(0, Number(data.energy) || 0);
        energyRef.current = serverEnergy;
        setEnergyLeft(serverEnergy);
        if (data.energy_reset_at) {
          setResetAt(Number(data.energy_reset_at));
        } else if (serverEnergy <= 0) {
          setResetAt(Math.floor(Date.now() / 1000) + (config?.energy_cooldown || 3600));
        }
        // Re-queue taps that never reached the server (except pure energy empty)
        if (data.status === 409 && taps > 0) {
          tapQueue.current += taps;
        }
      }
    } catch {
      // Network fail — put taps back so they aren't lost
      tapQueue.current += taps;
      showToast('Tap failed — retrying');
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

    // Optimistic balance so UI doesn't stay at 0 while taps are queued
    const reward = Number(config?.tap_reward ?? 0.0000000695);
    setUser((u) =>
      u
        ? {
            ...u,
            balance: Number(u.balance || 0) + reward,
            total_earned: Number(u.total_earned || 0) + reward,
            total_taps: (u.total_taps || 0) + 1,
          }
        : u
    );

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
        setTaskVerification(Object.fromEntries((d.completed || []).map((id) => [id, 'claimed'])));
      });
    }
    if (tab === 'friends') {
      api('/api/referrals').then((d) => {
        if (d.error) {
          console.error('referrals error', d.error);
          return;
        }
        const list = Array.isArray(d.referrals) ? d.referrals : [];
        setReferrals(list);
        if (d.count != null) {
          setUser((u) => {
            if (!u) return u;
            const next = Math.max(Number(u.invite_count) || 0, Number(d.count) || 0, list.length);
            return { ...u, invite_count: next };
          });
        }
      });
    }
    if (tab === 'wallet') {
      api('/api/ton-wallet').then((d) => setTonWallet(d.wallet || null)).catch(() => {});
      api('/api/history').then((d) => setHistory(d.history || [])).catch(() => {});
      api('/api/withdrawals', {
        method: 'POST',
        body: JSON.stringify({ user: window.Telegram?.WebApp?.initDataUnsafe?.user || tg?.initDataUnsafe?.user }),
      }).then((d) => {
        if (!d.error) setWithdrawals(d.withdrawals || []);
      });
    }
    if (tab === 'admin' && user?.is_admin) {
      loadAdmin();
    }
  // IMPORTANT: do NOT depend on full `user` — every tap updates balance and would re-fire this effect
  }, [tab, user?.is_admin]);

  const loadAdmin = async () => {
    const [stats, wds, tks, activity] = await Promise.all([
      api('/api/admin/stats'),
      api(`/api/admin/withdrawals?status=${adminWdFilter || 'pending'}`),
      api('/api/admin/tasks'),
      api('/api/admin/history'),
    ]);
    setAdminStats(stats);
    setAdminWithdrawals(wds.withdrawals || []);
    setAdminTasks(tks.tasks || []);
    setAdminHistory(activity.history || []);
  };

  const loadAdminSettings = async () => {
    const raw = await api('/api/admin/settings');
    // Support both { settings: {...} } and raw settings object
    const data = raw?.settings && !raw.error ? raw.settings : raw;
    if (data && !data.error) {
      setAdminSettings(data);
      const days = Array.isArray(data.checkin_day_rewards) && data.checkin_day_rewards.length === 7
        ? data.checkin_day_rewards.map(Number)
        : [0.0000089, 0.000002, 0.000006, 0.000007, 0.0000079, 0.0000089, 0.0004];
      setCheckinRewards(days);
      setSettingsForm({
        tap_reward: data.tap_reward != null ? formatNum(data.tap_reward, 12) : '',
        referral_reward: data.referral_reward != null ? formatNum(data.referral_reward, 12) : '',
        min_withdraw: data.min_withdraw != null ? formatNum(data.min_withdraw, 8) : '',
        energy_max: data.energy_max != null ? String(data.energy_max) : '',
        energy_cooldown: data.energy_cooldown != null ? String(data.energy_cooldown) : '',
        daily_checkin_reward: data.daily_checkin_reward != null ? formatNum(data.daily_checkin_reward, 12) : '',
        streak_bonus: '0',
        day1: days[0] != null ? String(days[0]) : '',
        day2: days[1] != null ? String(days[1]) : '',
        day3: days[2] != null ? String(days[2]) : '',
        day4: days[3] != null ? String(days[3]) : '',
        day5: days[4] != null ? String(days[4]) : '',
        day6: days[5] != null ? String(days[5]) : '',
        day7: days[6] != null ? String(days[6]) : '',
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
    body.streak_bonus = 0; // No additional 7-day bonus; Day 7 reward is the full reward.
    const dayRewards = [settingsForm.day1, settingsForm.day2, settingsForm.day3, settingsForm.day4, settingsForm.day5, settingsForm.day6, settingsForm.day7]

.map((v) => (v !== '' ? parseFloat(v) : null));
    if (dayRewards.some((v) => v != null)) body.checkin_day_rewards = dayRewards.map((v, i) => v != null ? v : (checkinRewards[i] || 0));
    const numericValues = Object.entries(body).filter(([key]) => key !== 'checkin_day_rewards');
    if (numericValues.some(([, value]) => !Number.isFinite(value)) ||
        (body.checkin_day_rewards && body.checkin_day_rewards.some((value) => !Number.isFinite(value)))) {
      showToast('Please enter valid numbers in all settings fields');
      return;
    }
    const data = await api('/api/admin/settings', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (data.success) {
      showToast('Settings saved!');
      setAdminSettings(data.settings);
      if (Array.isArray(body.checkin_day_rewards)) {
        setCheckinRewards(body.checkin_day_rewards);
      }
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
      balance: Number(editUserData.balance),
      total_earned: Number(editUserData.total_earned),
      total_taps: Number(editUserData.total_taps),
      is_admin: editUserData.is_admin,
      invite_count: Number(editUserData.invite_count),
    };
    if (!Number.isFinite(body.balance) || body.balance < 0 ||
        !Number.isFinite(body.total_earned) || body.total_earned < 0 ||
        !Number.isSafeInteger(body.total_taps) || body.total_taps < 0 ||
        !Number.isSafeInteger(body.invite_count) || body.invite_count < 0) {
      showToast('Enter valid non-negative numbers in every user field');
      return;
    }
    const data = await api(`/api/admin/users/${editUserId}`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (data.success) {
      showToast('User updated');
      loadAdminLeaderboard();
      api('/api/leaderboard').then((d) => setLeaderboard(d.leaderboard || []));
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

  const verifyTask = async (taskId) => {
    setTaskVerification((s) => ({ ...s, [taskId]: 'checking' }));
    const data = await api('/api/tasks/verify', { method: 'POST', body: JSON.stringify({ task_id: taskId }) });
    if (data.wait_seconds > 0 && data.manual) {
      setTaskVerification((s) => ({ ...s, [taskId]: 'waiting' }));
      for (let seconds = Math.min(5, Number(data.wait_seconds)); seconds > 0; seconds -= 1) {
        setTaskCountdown((s) => ({ ...s, [taskId]: seconds }));
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      setTaskCountdown((s) => ({ ...s, [taskId]: 0 }));
      return verifyTask(taskId);
    }
    if (data.verified) {
      setTaskVerification((s) => ({ ...s, [taskId]: data.claimed ? 'claimed' : 'verified' }));
      setPendingTasks((p) => (p.includes(taskId) ? p : [...p, taskId]));
      if (data.claimed) showToast('Task already claimed earlier. No repeat reward.');
      else showToast(data.manual ? '5-second wait complete. Claim your reward!' : 'Membership verified! Claim your reward.');
    } else {
      setTaskVerification((s) => ({ ...s, [taskId]: 'not_member' }));
      setPendingTasks((p) => p.filter((id) => id !== taskId));
      showToast(data.error || 'Channel join nahi mila. Join karke dobara try karein.');
    }
  };

  const joinTask = async (task) => {
    const taskId = task.id;
    if (!task.link) return showToast('Task link missing');
    const isYouTube = String(task.type || '').toLowerCase() === 'youtube' || /youtube\.com|youtu\.be/i.test(task.link);
    setTaskVerification((s) => ({ ...s, [taskId]: isYouTube ? 'waiting_return' : 'waiting' }));
    try {
      if (window.Telegram?.WebApp?.openTelegramLink && /t\.me\//i.test(task.link)) {
        window.Telegram.WebApp.openTelegramLink(task.link);
      } else if (window.Telegram?.WebApp?.openLink) {
        window.Telegram.WebApp.openLink(task.link);
      } else {
        window.open(task.link, '_blank', 'noopener,noreferrer');
      }
    } catch (_) {}
    if (isYouTube) {
      showToast('YouTube par jaakar wapas HYPE Tap me aayein. Phir 5-second timer chalega.');
      return;
    }
    for (let seconds = 5; seconds > 0; seconds -= 1) {
      setTaskCountdown((s) => ({ ...s, [taskId]: seconds }));
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    setTaskCountdown((s) => ({ ...s, [taskId]: 0 }));
    await verifyTask(taskId);
  };

  const completeTask = async (taskId) => {
    if (completedTasks.includes(taskId) || taskVerification[taskId] !== 'verified') return;
    setTaskVerification((s) => ({ ...s, [taskId]: 'claiming' }));
    const data = await api('/api/tasks/complete', {
      method: 'POST',
      body: JSON.stringify({ task_id: taskId }),
    });
    if (data.success) {
      setCompletedTasks((c) => (c.includes(taskId) ? c : [...c, taskId]));
      setTaskVerification((s) => ({ ...s, [taskId]: 'claimed' }));
      showToast(data.already_claimed ? 'Reward pehle hi mil chuka hai.' : `+${formatNum(data.reward, 12)} HYPE`);
      loadUser();
    } else {
      setTaskVerification((s) => ({ ...s, [taskId]: 'not_member' }));
      setPendingTasks((p) => p.filter((id) => id !== taskId));
      showToast(data.error || 'Verification failed. Join karke dobara try karein.');
    }
  };

  const refreshTaskMembership = async () => {
    const telegramTasks = tasks.filter((task) => String(task.type || '').toLowerCase() !== 'youtube');
    const results = await Promise.all(telegramTasks.map(async (task) => {
      const data = await api('/api/tasks/verify', { method: 'POST', body: JSON.stringify({ task_id: task.id }) });
      return [task.id, data.verified && data.claimed ? 'claimed' : 'not_member'];
    }));
    setTaskVerification((s) => ({ ...s, ...Object.fromEntries(results) }));
    setPendingTasks([]);
  };

  const resumeYouTubeTasks = async () => {
    if (document.visibilityState !== 'visible') return;
    for (const task of tasks) {
      if (String(task.type || '').toLowerCase() === 'youtube' && taskVerificationRef.current[task.id] === 'waiting_return') {
        await verifyTask(task.id);
      }
    }
  };

  useEffect(() => {
    if (tab !== 'tasks' || !tasks.length) return;
    refreshTaskMembership();
    const onReturn = () => {
      if (document.visibilityState === 'visible') resumeYouTubeTasks();
    };
    document.addEventListener('visibilitychange', onReturn);
    window.addEventListener('focus', onReturn);
    return () => {
      document.removeEventListener('visibilitychange', onReturn);
      window.removeEventListener('focus', onReturn);
    };
  }, [tab, tasks]);


  const loadHistory = async () => {
    const data = await api('/api/history');
    if (!data.error) setHistory(data.history || []);
  };

  const connectTonWallet = async () => {
    try {
      setWalletConnecting(true);
      let ui = tonConnectUIRef.current;
      if (!ui) {
        const tonConnectModule = await import('@tonconnect/ui');
        const TonConnectUI = tonConnectModule.TonConnectUI || tonConnectModule.default?.TonConnectUI;
        if (typeof TonConnectUI !== 'function') throw new Error('TON Connect UI failed to load. Please refresh and try again.');
        ui = new TonConnectUI({
          manifestUrl: window.location.origin + '/tonconnect-manifest.json',
          enableAndroidBackHandler: false,
        });
        ui.setConnectionNetwork('-239');
        ui.onStatusChange(async (wallet) => {
          if (!wallet) return;
          const item = wallet.connectItems?.tonProof;
          if (!item || !('proof' in item)) {
            showToast('This TON wallet did not return TON proof. Try Tonkeeper or another TON mainnet wallet.');
            try { await ui.disconnect(); } catch (_) {}
            return;
          }
          if (tonProofVerifyingRef.current) return;
          tonProofVerifyingRef.current = true;
          try {
            const walletStateInit = wallet.account?.walletStateInit;
            if (!walletStateInit) throw new Error('TON wallet did not provide wallet state. Reconnect and approve the proof.');
            const result = await api('/api/ton-proof/verify', {
              method: 'POST',
              body: JSON.stringify({
                address: wallet.account.address,
                network: wallet.account.chain,
                public_key: wallet.account.publicKey || undefined,
                wallet_state_init: walletStateInit,
                proof: item.proof,
              }),
            });
            if (!result.success) throw new Error(result.error || 'TON ownership proof failed');
            setTonWallet({ address_friendly: result.address, address_raw: result.address_raw });
            showToast('TON wallet ownership verified');
          } catch (e) {
            showToast(String(e?.message || 'TON verification failed').slice(0, 100));
            try { await ui.disconnect(); } catch (_) {}
          } finally {
            tonProofVerifyingRef.current = false;
          }
        });
        tonConnectUIRef.current = ui;
      }
      if (ui.connected) {
        await ui.disconnect();
      }
      ui.setConnectRequestParameters({ state: 'loading' });
      const challenge = await api('/api/ton-proof/payload', { method: 'POST', body: '{}' });
      if (!challenge.payload) {
        ui.setConnectRequestParameters(null);
        throw new Error(challenge.error || 'Could not prepare TON wallet proof');
      }
      ui.setConnectRequestParameters({ state: 'ready', value: { tonProof: challenge.payload } });
      await ui.openModal();
    } catch (e) {
      showToast(String(e?.message || 'TON wallet connection failed').slice(0, 100));
    } finally {
      setWalletConnecting(false);
    }
  };

  const disconnectTonWallet = async () => {
    try { if (tonConnectUIRef.current?.connected) await tonConnectUIRef.current.disconnect(); } catch (_) {}
    await api('/api/ton-wallet/disconnect', { method: 'POST', body: '{}' });
    setTonWallet(null);
    showToast('TON wallet disconnected');
  };

  const loadDeposits = async () => {
    const data = await api('/api/deposits');
    if (!data.error) setDepositData(data);
  };

  useEffect(() => { if (tab === 'wallet') loadDeposits(); }, [tab]);

  const verifyDeposit = async () => {
    const hash = depositHash.trim();
    if (!hash) return showToast('Paste your transaction hash first');
    setDepositBusy(true);
    const data = await api('/api/deposits/verify', {
      method: 'POST', body: JSON.stringify({ network: depositNetwork, tx_hash: hash }),
    });
    setDepositBusy(false);
    if (data.success) {
      setDepositHash('');
      setDepositData((old) => ({ ...old, deposits: data.deposits || old.deposits, balances: data.balances || old.balances }));
      await loadHistory();
      showToast('Verified: +' + data.amount + ' ' + (data.token || 'USDT'));
    } else {
      showToast(data.error || 'Verification failed');
    }
  };

  const requestWithdraw = async () => {
    const amount = parseFloat(wdAmount);
    if (!amount || amount < (config?.min_withdraw || 2)) {
      showToast(`Min ${config?.min_withdraw || 2} HYPE`);
      return;
    }
    if (!connectedWallet || connectedWallet.length < 10) {
      showToast('Connect your wallet first');
      return;
    }
    const data = await api('/api/withdraw', {
      method: 'POST',
      body: JSON.stringify({

user: tg?.initDataUnsafe?.user,
        amount,
        wallet_address: connectedWallet,
      }),
    });
    if (data.success) {
      showToast('Request submitted!');
      setWdAmount('');
      loadUser();
      api('/api/withdrawals').then((d) => setWithdrawals(d.withdrawals || []));
      await loadHistory();
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
      // Refresh current filter list + stats
      const [stats, wds] = await Promise.all([
        api('/api/admin/stats'),
        api(`/api/admin/withdrawals?status=${adminWdFilter || 'pending'}`),
      ]);
      if (stats && !stats.error) setAdminStats(stats);
      if (wds && !wds.error) setAdminWithdrawals(wds.withdrawals || []);
    } else {
      showToast(data.error || 'Action failed');
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
      await loadAdmin();
    } else {
      showToast(data.error || 'Task could not be added');
    }
  };

  const deleteTask = async (id) => {
    if (!confirm('Delete this task?')) return;
    const data = await api(`/api/admin/tasks/${id}`, { method: 'DELETE' });
    if (data.success) {
      showToast('Task deleted');
      await loadAdmin();
    } else {
      showToast(data.error || 'Task could not be deleted');
    }
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
        showToast(`Sent to ${data.sent}/${data.total || data.sent} users` + (data.failed ? ` (${data.failed} failed)` : ''));
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
        {/* ATF dark gold loading — no crystals */}
        <div className="ls-bg" aria-hidden="true">
          <div className="ls-glow" />
        </div>

        <div className="loading-inner">
          <div className="loading-logo-wrap">
            <div className="loading-ring" />
            <div className="loading-ring loading-ring-2" />
            <img src="/hype-logo.png" alt="HYPE" className="loading-logo" />
          </div>
          <div className="loading-title">Hype Evm Native</div>
          <div className="loading-tagline">MINE · EARN · GROW</div>
          <div className="loading-sub">Loading Your Engine…</div>
          <div className="loading-bar">
            <div className="loading-bar-fill" />
          </div>
          <div className="loading-features">
            <span>Decentralized</span>
            <span>Secure</span>
            <span>EVM Native</span>
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
            <button type="button" className="badge gold-lvl level-open-btn" onClick={() => setTab('miner')}><Icon name="crown" size={12} /> Lvl {Number(user?.level || 1)} <span className="level-open-cue">›</span></button>
            <span className={`badge ${onlineChecked && isOnline ? 'online' : 'offline'}`}>
              <Icon name="zap" size={12} /> {onlineChecked ? (isOnline ? 'ONLINE' : 'OFFLINE') : 'OFFLINE'}
            </span>
          </div>
          {price > 0 && (
            <button type="button" className="lvl-progress level-progress-open" onClick={() => setTab('miner')}>
              ≈ ${(Number(user?.balance || 0) * price).toFixed(4)}$ left to Lvl UP →
            </button>
          )}
        </div>
        <div className="header-right">
          {connectedWallet ? (
            <button className="connect-wallet-btn connected" onClick={disconnectWallet} title={connectedWallet}>

<Icon name="wallet" size={14} /> Connected
            </button>
          ) : (
            <button className="connect-wallet-btn" onClick={connectExternalWallet} disabled={walletConnecting}>
              <Icon name="wallet" size={14} /> {walletConnecting ? 'Connecting…' : 'Connect Wallet'}
            </button>
          )}
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
          <div className="assets-card atf-assets">
            {/* Full ornate ASSETS banner image (already has ASSETS text + decoration) */}
            <div className="assets-ornate-header">
              <img className="assets-banner-img" src="/assets-banner.png" alt="ASSETS" draggable={false} />
            </div>
            <div className="atf-balance-banner">
              <div className="balance-amount">{formatNum(user?.balance, 10)}</div>
              <div className="balance-symbol">HYPE</div>
            </div>
            <div className="earned-chip atf-earned">
              <Icon name="chart" size={14} /> +{formatNum(user?.total_earned, 10)} HYPE
            </div>
            <div className="hl-price">
              <Icon name="chart" size={14} /> HYPE Live: {price > 0 ? `$${Number(price).toFixed(4)}` : '…'} <span style={{ opacity: 0.7 }}>· Hyperliquid</span>
            </div>
          </div>

          <div className="tap-area atf-stage">
            {/* Ambient (green theme) */}
            <div className="tap-bg" aria-hidden="true" />

            <div
              className={`hype-logo ${tapAnim ? 'tapped' : ''}`}
              onPointerDown={(e) => {
                e.preventDefault();
                doTap();
              }}
              role="button"
              aria-label="Tap to mine"
            >
              {/* Coin only — no side rings, no yellow crown */}
              <div className="atf-coin-wrap">
                <div className="atf-coin-glow" />
                <img src="/hype-logo.png" alt="HYPE Logo" className="logo-img" draggable={false} />
              </div>

              {/* Vertical lighting beam from platform up to coin */}
              <div className="platform-beam" aria-hidden="true" />

              {/* New cyan high-tech platform (user provided) */}
              <img
                src="/hype-platform.png"
                alt=""
                className="hype-platform-img"
                aria-hidden="true"
                draggable={false}
              />

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

          {/* ATF bright gold energy glass bar */}
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

<div className="hl-native-tag"><Icon name="globe" size={15} /> HYPERLIQUID NATIVE</div>
          <div className="global-supply-card">
            <div className="global-supply-head"><div><div className="global-supply-kicker">NETWORK TOKENOMICS</div><div className="global-supply-title">Global HYPE Supply</div></div><span className="global-supply-live"><i /> LIVE DATA</span></div>
            <div className="global-supply-main"><div><span>Circulating supply</span><strong>{supplyStats ? (supplyStats.circulating / 1e6).toFixed(2) + 'M' : '—'} <small>HYPE</small></strong></div><div><span>Max supply</span><strong>{supplyStats ? (supplyStats.max / 1e9).toFixed(2) + 'B' : '1.00B'} <small>HYPE</small></strong></div></div>
            <div className="supply-track"><div style={{width: supplyStats ? Math.min(100, supplyStats.circulating / supplyStats.max * 100) + '%' : '0%'}} /></div>
            <div className="supply-foot"><span>{supplyStats ? (supplyStats.circulating / supplyStats.max * 100).toFixed(2) + '% circulating' : 'Loading supply data…'}</span><span>Not mined by this app</span></div>
            <div className="app-rewards-strip"><Icon name="wallet" size={16}/><span>Your Hype Tap balance</span><strong>{formatNum(user?.balance || 0, 12)} HYPE</strong></div>
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

      {/* MINER LEVELS — presentation layer only; existing mining/reward APIs are untouched */}
      {tab === 'miner' && (
        <section className="miner-page">
          <div className="miner-heading-row">
            <div>
              <div className="miner-eyebrow">HYPE EVM · MINING STATION</div>
              <h1>Miner <span>Levels</span></h1>
              <p>Track HYPE market movement and explore the 1–1000 level journey.</p>
            </div>
            <button className="miner-back-btn" onClick={() => setTab('tap')}>← Mine</button>
          </div>

          <div className="miner-market-card">
            <div className="miner-market-head">
              <div><span className="hl-live-dot" /> HYPE / USDT <span className="hl-live-badge">LIVE</span></div>
              <span className="miner-market-source">HYPERLIQUID</span>
            </div>
            <div className="miner-price-line">
              <strong>{price > 0 ? `$${Number(price).toFixed(4)}` : 'Loading price…'}</strong>
              <span className={`hl-chg ${dayChange >= 0 ? 'up' : 'down'}`}>{dayChange >= 0 ? '+' : ''}{Number(dayChange || 0).toFixed(2)}%</span>
            </div>
            <div className="hl-intervals miner-intervals">
              {['15m', '30m', '1h', '4h', '1d'].map((iv) => (
                <button key={iv} className={`hl-iv ${chartInterval === iv ? 'active' : ''}`} onClick={() => setChartInterval(iv)}>{iv}</button>
              ))}
            </div>
            <div className="miner-chart-area">
              {chartLoading && candles.length === 0 ? <div className="hl-spark-loading">Loading live market chart…</div> : candles.length > 1 ? (
                <svg viewBox="0 0 320 120" preserveAspectRatio="none" className="hl-full-svg" role="img" aria-label="HYPE live price chart">
                  <defs><linearGradient id="minerChartFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="rgba(38,220,135,.28)"/><stop offset="100%" stopColor="rgba(38,220,135,0)"/></linearGradient></defs>
                  {(() => {
                    const values = candles.map((c) => Number(c.c));
                    const min = Math.min(...values); const max = Math.max(...values); const range = max - min || 1;
                    const pts = values.map((v, i) => [i / (values.length - 1) * 320, 8 + 88 - ((v - min) / range) * 88]);
                    const line = pts.map((pt) => pt.join(',')).join(' ');
                    const area = `0,108 ${line} 320,108`;
                    return <><polygon points={area} fill="url(#minerChartFill)"/><polyline points={line} fill="none" stroke="#39d98a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></>;
                  })()}
                </svg>
              ) : <div className="hl-spark-loading">Live chart data is temporarily unavailable</div>}
            </div>
            <div className="miner-market-foot"><span>24H VOL <b>{dayVol >= 1e9 ? `$${(dayVol / 1e9).toFixed(2)}B` : dayVol > 0 ? `$${(dayVol / 1e6).toFixed(1)}M` : '—'}</b></span><span>HIGH <b>{dayHigh > 0 ? `$${dayHigh.toFixed(3)}` : '—'}</b></span><span>LOW <b>{dayLow > 0 ? `$${dayLow.toFixed(3)}` : '—'}</b></span></div>
          </div>

          <div className="miner-overview-grid">
            <div className="miner-stat-card"><span>CURRENT LEVEL</span><strong>LVL {Number(user?.level || 1)}</strong><small>Mining profile</small></div>
            <div className="miner-stat-card"><span>MINING POINTS</span><strong>{formatNum(user?.total_taps || 0, 0)}</strong><small>Recorded taps</small></div>
          </div>

          <div className="miner-energy-card">
            <div className="miner-energy-copy"><span className="miner-eyebrow">ENERGY CORE</span><strong>Energy Reserve</strong><small>{Math.max(0, energyLeft).toLocaleString()} / {(config?.energy_max || 1000).toLocaleString()} available</small></div>
            <div className="energy-cylinder" role="img" aria-label={`${Math.round(Math.max(0, energyLeft) / (config?.energy_max || 1000) * 100)} percent energy available`}>
              <div className="energy-cylinder-liquid" style={{height:`${Math.min(100, Math.max(0, energyLeft / (config?.energy_max || 1000) * 100))}%`}} />
              <div className="energy-cylinder-glass" /><span>{Math.round(Math.min(100, Math.max(0, energyLeft / (config?.energy_max || 1000) * 100)))}%</span>
            </div>
            <div className="miner-energy-foot"><span><i /> Live energy</span><span>{energyLeft <= 0 ? `Recharge ${formatTime(waitSec)}` : 'Regenerates on cooldown'}</span></div>
          </div>

          {/* ATF-style Miner Store Levels 1–1000 */}
          <div className="miner-levels-head">
            <div>
              <span className="miner-eyebrow">MINER STORE</span>
              <h2>Levels <span>1–1000</span></h2>
            </div>
            <span className="miner-level-count">1000 LEVELS</span>
          </div>
          <div className="miner-level-note">ATF-style machine cards. Active level is unlocked. Higher levels require more HYPE (visual roadmap — server rules unchanged).</div>

          <div className="atf-level-grid">
            {Array.from({ length: 1000 }, (_, i) => i + 1).map((level) => {
              const current = Number(user?.level || 1);
              const isActive = level === current;
              const isUnlocked = level <= current;
              // Approximate ATF-style pricing & speed curve (scaled to 1000)
              const priceUsd = (0.02 + level * 0.0012 + Math.pow(level / 80, 1.55) * 0.012).toFixed(4);
              const speedTh = (0.18 + level * 0.0038 + Math.pow(level / 90, 1.35) * 0.1).toFixed(2);
              const needHype = Math.max(0, Math.round((level - current) * 6 + level * 0.9));
              let statusClass = 'locked';
              let statusText = `NEED ${needHype} HYPE`;
              if (isActive) { statusClass = 'active'; statusText = 'ACTIVE'; }
              else if (isUnlocked) { statusClass = 'unlocked'; statusText = 'UNLOCKED'; }

              return (
                <button
                  key={level}
                  type="button"
                  className={`atf-machine-card ${statusClass} ${selectedMinerLevel === level ? 'selected' : ''}`}
                  onClick={() => setSelectedMinerLevel(level)}
                >
                  <div className="atf-machine-top">
                    <span className="atf-lvl">Lvl {level}</span>
                    <span className="atf-machine-icon"><Icon name="crown" size={16} /></span>
                  </div>
                  <div className="atf-machine-price">${priceUsd}</div>
                  <div className="atf-machine-speed">Speed <b>{speedTh} TH/s</b></div>
                  <div className={`atf-machine-status ${statusClass}`}>{statusText}</div>
                </button>
              );
            })}
          </div>

          <div className="miner-selected-level atf-selected">
            <div>
              <span className="miner-eyebrow">SELECTED MACHINE</span>
              <strong>LEVEL {selectedMinerLevel}</strong>
            </div>
            <div className="miner-requirements">
              <span>
                <Icon name="zap" size={12} /> {(0.18 + selectedMinerLevel * 0.0045).toFixed(2)} TH/s
                <small>Hashrate</small>
              </span>
              <span>
                <Icon name="coins" size={12} /> ${(0.02 + selectedMinerLevel * 0.0015).toFixed(4)}
                <small>Est. value</small>
              </span>
            </div>
            <div className="miner-level-status">
              {selectedMinerLevel <= Number(user?.level || 1)
                ? 'This machine is active / unlocked'
                : `Need ~${Math.max(0, Math.round((selectedMinerLevel - Number(user?.level || 1)) * 8))} more HYPE (illustrative)`}
            </div>
          </div>
        </section>
      )}

      {/* TASKS */}
      {tab === 'tasks' && (
        <div className="page">
          {/* 7-Day Daily Check-in */}
          <div className="checkin-card">
            <div className="checkin-hero">
              <div className="checkin-logo-wrap">
                <img src="/hype-logo.png" alt="" className="checkin-logo" />
              </div>
              <div className="checkin-hero-text">
                <div className="checkin-title">DAILY<br/>CHECK-IN</div>
                <div className="checkin-sub">Log in Daily · Earn Rewards · Grow Faster</div>
              </div>
            </div>

            <div className="checkin-stats">
              <div className="checkin-stat">
                <Icon name="flame" size={16} />
                <div>
                  <div className="cs-label">Current Streak</div>
                  <div className="cs-val">{streak} Days</div>
                </div>
              </div>
              <div className="checkin-stat">
                <Icon name="gift" size={16} />
                <div>
                  <div className="cs-label">Total Earned</div>
                  <div className="cs-val">+{formatNum(streakTotalEarned || 0, 2)} HYPE</div>
                </div>
              </div>
            </div>

            <div className="checkin-daily-head">
              <div>
                <div className="cdh-title"><Icon name="zap" size={14} /> DAILY REWARD</div>
                <div className="cdh-sub">Check in every day and get bigger rewards!</div>
              </div>
              <div className="next-reward-pill">
                Next Reward<br/>Day {Math.min(7, (streak % 7) + 1)}
              </div>
            </div>

            <div className="checkin-days">
              {[1,2,3,4,5,6,7].map((d) => {
                const claimed = streak >= d;
                const current = canCheckin && streak + 1 === d;

const locked = !claimed && !current;
                const reward = checkinRewards[d - 1] ?? (d * 50);
                return (
                  <div
                    key={d}
                    className={`checkin-day ${claimed ? 'claimed' : ''} ${current ? 'current' : ''} ${locked ? 'locked' : ''}`}
                  >
                    <div className="cd-icon">
                      {claimed ? <Icon name="check" size={18} /> : <Icon name="gift" size={16} />}
                    </div>
                    <div className="cd-label">Day {d}</div>
                    <div className="cd-reward">+{formatNum(reward, 12)}</div>
                  </div>
                );
              })}
            </div>

            <div className="streak-bonus-card">
              <div className="sb-gift"><Icon name="calendar" size={28} /></div>
              <div className="sb-body">
                <div className="sb-title">7 DAY REWARD CYCLE</div>
                <div className="sb-desc">Claim each day in sequence. Day 7 pays <strong>0.0004 HYPE</strong>. No extra bonus.</div>
              </div>
              <div className="sb-progress">
                <div className="sb-count">{Math.min(streak, 7)}/7</div>
                <div className="sb-bar"><div style={{ width: `${(Math.min(streak, 7) / 7) * 100}%` }} /></div>
              </div>
            </div>

            <div className="checkin-note">
              Miss a day? Your streak will reset, but you can always start again!
            </div>

            <button
              type="button"
              className={`claim-btn checkin-now ${(!canCheckin || checkinBusy) ? 'claim-disabled' : ''}`}
              onClick={doCheckin}
              disabled={!canCheckin || checkinBusy}
              aria-label={checkinBusy ? 'Processing daily check-in' : canCheckin ? 'Claim daily check-in' : `Next check-in in ${formatTime(checkinWait)}`}
            >
              {checkinBusy
                ? <><Icon name="clock" size={18} /> Processing…</>
                : canCheckin
                  ? <><Icon name="check" size={18} /> Check In Now</>
                  : <><Icon name="clock" size={18} /> Next in {formatTime(checkinWait)}</>}
            </button>
          </div>

          <h3 className="section-heading"><Icon name="gift" size={18} /> Tasks & Rewards</h3>
          {tasks.length === 0 && <div className="card">No tasks yet. Check back later.</div>}
          {tasks.map((t) => {
            const status = taskVerification[t.id] || 'not_member';
            const verified = status === 'verified' || pendingTasks.includes(t.id);
            const waiting = status === 'waiting' || status === 'checking';
            const taskLink = String(t.link || '').toLowerCase();
            const taskType = String(t.type || '').toLowerCase();
            const platformIcon = taskType === 'youtube' || /youtube\.com|youtu\.be/.test(taskLink) ? 'youtube' : taskType === 'telegram' || /t\.me\//.test(taskLink) ? 'telegram' : 'globe';
            return (
              <div className="card task-card" key={t.id}>
                <div className="task-card-content">
                  <div className="task-platform-icon"><Icon name={platformIcon} size={22} /></div>
                  <div className="task-info">
                    <div className="task-title">{t.title}</div>
                    {taskType === 'youtube' && <a href={t.link} onClick={(e) => { e.preventDefault(); joinTask(t); }} style={{ display: 'block', fontSize: 11, opacity: 0.78, overflowWrap: 'anywhere', marginTop: 4 }}>YouTube link ↗</a>}
                    <div className="task-reward">+{formatNum(t.reward, 12)} HYPE</div>
                  </div>
                  <div className="task-action">
                    {status === 'claimed' ? (
                      <span className="task-done-badge"><Icon name="check" size={14} /> Claimed</span>
                    ) : verified ? (
                      <button className="btn btn-primary task-action-btn" disabled={status === 'claiming'} onClick={() => completeTask(t.id)}>
                        {status === 'claiming' ? 'Claiming…' : 'Claim'}
                      </button>
                    ) : (
                      <button className="btn btn-primary task-action-btn" disabled={waiting || status === 'waiting_return'} onClick={() => joinTask(t)}>
                        {waiting ? `Wait ${taskCountdown[t.id] || ''}s` : status === 'waiting_return' ? 'Return to HYPE Tap' : 'Join'}
                      </button>
                    )}
                  </div>
                </div>
                {waiting && <div className="task-verify-note">{taskCountdown[t.id] > 0 ? `Wait ${taskCountdown[t.id]}s to claim` : 'Checking task…'}</div>}
                {status === 'waiting_return' && <div className="task-verify-note">YouTube link opened. Return here to start the 5-second claim timer.</div>}
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
            <div className="card-title">
              Your Invites ({Math.max(Number(user?.invite_count) || 0, referrals.length)})
            </div>
            {referrals.length === 0 && (
              <div style={{ color: '#888', fontSize: '0.9rem' }}>
                {(Number(user?.invite_count) || 0) > 0
                  ? `${user.invite_count} invite(s) counted, list loading… Pull to refresh or reopen Friends tab.`
                  : 'No referrals yet. Share your link with friends who never used the app.'}
              </div>
            )}
            {referrals.map((r) => (
              <div
                key={r.id || r.referred_id}
                style={{
                  padding: '10px 0',
                  borderBottom: '1px solid rgba(0,255,136,0.1)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <div>
                  <div style={{ fontWeight: 700 }}>
                    @{r.username || r.first_name || r.referred_id || 'User'}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#666' }}>
                    ID: {r.referred_id}
                    {r.legacy_record ? ' • legacy' : ''}
                  </div>
                </div>
                <span style={{ color: '#00ff88', fontWeight: 700, whiteSpace: 'nowrap' }}>
                  +{formatNum(r.reward || 0, 12)} HYPE
                </span>
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
              <div className="lb-score">{formatNum(p.balance, 4)}</div>
            </div>
          ))}
        </div>
      )}

      {/* WALLET / WITHDRAW */}
      {tab === 'wallet' && (
        <div className="page">
          <div className="card">
            <div className="card-title"><Icon name="wallet" size={16} /> Wallet</div>
            {connectedWallet ? (
              <div className="wallet-connected-box">
                <div className="wc-status"><span className="wc-dot" /> Connected</div>
                <div className="wc-addr">{connectedWallet}</div>
                <button className="btn btn-secondary" style={{ width: '100%', marginTop: 10 }} onClick={disconnectWallet}>
                  Disconnect
                </button>
              </div>
            ) : (
              <div className="wallet-connect-box">
                <p style={{ color: '#a0ffc0', fontSize: '0.85rem', marginBottom: 12 }}>
                  Connect your external wallet (MetaMask / WalletConnect) to withdraw.
                </p>
                <button className="btn btn-primary" style={{ width: '100%' }} onClick={connectExternalWallet} disabled={walletConnecting}>
                  <Icon name="wallet" size={16} /> {walletConnecting ? 'Connecting…' : 'Connect Wallet'}
                </button>
                <div style={{ marginTop: 14, borderTop: '1px solid rgba(0,255,136,0.15)', paddingTop: 12 }}>
                  <div style={{ fontSize: '0.78rem', color: '#888', marginBottom: 6 }}>Or paste address manually</div>
                  <input
                    className="input"
                    placeholder="0x..."
                    value={wdWallet}
                    onChange={(e) => setWdWallet(e.target.value.trim())}
                  />
                  <button
                    className="btn btn-secondary"
                    style={{ width: '100%', marginTop: 8 }}
                    onClick={() => persistWallet(wdWallet)}
                  >
                    Save Address
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-title"><img src="/hype-coin.svg" alt="HYPE" style={{width:24,height:24,objectFit:'contain'}} /> HyperEVM Swap · Native HYPE</div>
            <div style={{fontSize:'0.78rem',color:'#a0ffc0',marginBottom:10}}>Swap tokens you already hold in your connected wallet on HyperEVM (Chain ID 999) into native HYPE. This is a swap screen — it does not accept deposits.</div>
            <div style={{fontSize:'0.76rem',color:'#ffd27a',background:'#211a0c',border:'1px solid #59451d',borderRadius:9,padding:10,marginBottom:12}}>
              <strong>Where do I deposit USDT / USDC / ETH?</strong><br/>
              Use the separate Deposit section and its displayed deposit address. Do not send funds to the token shown here. Funds deposited on Ethereum or another network will not automatically appear in this HyperEVM swap. To swap here, the selected token must already be in your connected wallet on HyperEVM.
            </div>
            <label style={{display:'block',fontSize:'0.78rem',color:'#9aa',marginBottom:5}}>Token to swap (from your HyperEVM wallet)</label>
            <select className="input" value={swapTokenAddress} onChange={e=>{setSwapTokenAddress(e.target.value);setSwapQuote(null);}} disabled={swapBusy || !swapTokens.length}>
              {swapTokens.map(token=><option key={token.address} value={token.address}>{token.symbol} · {token.name || token.address.slice(0,8)}</option>)}
            </select>
            <input className="input" style={{marginTop:8}} type="number" min="0" step="any" inputMode="decimal" placeholder="Enter amount of selected token" value={swapAmount} onChange={e=>{setSwapAmount(e.target.value);setSwapQuote(null);}} disabled={swapBusy}/>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',margin:'12px 0 8px'}}>
              <span style={{fontSize:'0.78rem',color:'#9aa'}}>You receive</span>
              <strong style={{color:'#00ff88'}}>{swapQuote?.estimate?.toAmount ? unitsToDecimal(swapQuote.estimate.toAmount,Number(swapQuote.action?.toToken?.decimals || 18),8)+' HYPE' : 'Native HYPE'}</strong>
            </div>
            {swapQuote?.estimate && <div style={{fontSize:'0.72rem',color:'#9aa',marginBottom:10}}>Estimated minimum: {unitsToDecimal(swapQuote.estimate.toAmountMin || swapQuote.estimate.toAmount,Number(swapQuote.action?.toToken?.decimals || 18),8)} HYPE · {swapQuote.toolDetails?.name || swapQuote.tool || 'LI.FI'}</div>}
            <button className="btn btn-secondary" style={{width:'100%'}} onClick={requestSwapQuote} disabled={swapBusy || !connectedWallet || !swapTokenAddress || !swapAmount || !swapTokens.length}>{swapBusy && !swapQuote ? 'Getting quote…' : 'Get Swap Quote'}</button>
            {swapQuote && <button className="btn btn-primary" style={{width:'100%',marginTop:8}} onClick={executeNativeHypeSwap} disabled={swapBusy}>{swapBusy ? 'Processing…' : 'Confirm & Swap to Native HYPE'}</button>}
            {swapStatus && <div style={{marginTop:10,fontSize:'0.75rem',color:'#a0ffc0',overflowWrap:'anywhere'}}>{swapStatus}</div>}
            {!connectedWallet && <div style={{marginTop:8,fontSize:'0.72rem',color:'#ffaa00'}}>Connect a wallet above to swap.</div>}
            <div style={{marginTop:8,fontSize:'0.68rem',color:'#777'}}>Quotes depend on live liquidity. Network gas fees may apply. Never share your seed phrase or private key.</div>
          </div>

          <div className="card">
            <div className="card-title"><Icon name="ton" size={20} title="TON" /> TON Wallet Ownership</div>
            {tonWallet?.address_friendly ? (
              <div className="wallet-connected-box">
                <div className="wc-status"><span className="wc-dot" /> TON ownership verified</div>
                <div className="wc-addr">{tonWallet.address_friendly}</div>
                <button className="btn btn-secondary" style={{ width: '100%', marginTop: 10 }} onClick={disconnectTonWallet}>Disconnect TON Wallet</button>
              </div>
            ) : (
              <>
                <div style={{ fontSize: '0.8rem', color: '#a0ffc0', marginBottom: 10 }}>Connect TON wallet and approve a TON Connect ownership proof. No transaction or token transfer is requested.</div>
                <button className="btn btn-primary" style={{ width: '100%' }} onClick={connectTonWallet} disabled={walletConnecting}>
                  <Icon name="ton" size={18} /> {walletConnecting ? 'Connecting…' : 'Connect TON Wallet'}
                </button>
              </>
            )}
          </div>

          <div className="card">
            <div className="card-title"><Icon name="coins" size={16} /> Deposit</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              {['ton', 'bep20', 'trc20', 'eth', 'usdc_eth'].map((network) => (
                <button key={network} className={`admin-tab ${depositNetwork === network ? 'active' : ''}`} onClick={() => setDepositNetwork(network)} title={network === 'ton' ? 'TON / GRAM' : network === 'bep20' ? 'USDT BNB Smart Chain' : network === 'trc20' ? 'USDT TRON' : network === 'eth' ? 'ETH Ethereum' : 'USDC Ethereum ERC20'} aria-label={network === 'ton' ? 'TON / GRAM' : network === 'bep20' ? 'USDT BEP20' : network === 'trc20' ? 'USDT TRC20' : network === 'eth' ? 'ETH Ethereum' : 'USDC Ethereum ERC20'}>
                  <Icon name={network === 'ton' ? 'ton' : network === 'eth' ? 'eth' : 'usdt'} size={22} />
                  <span style={{ fontSize: '0.72rem', marginLeft: 4 }}>{network === 'ton' ? 'TON' : network === 'bep20' ? 'BEP20' : network === 'trc20' ? 'TRC20' : network === 'eth' ? 'ETH' : 'USDC'}</span>
                </button>
              ))}
            </div>
            <div style={{ fontSize: '0.8rem', color: '#a0ffc0', marginBottom: 6 }}>
              {depositNetwork === 'ton' ? <>Send native <Icon name="ton" size={17} title="TON" /> only (TON / GRAM uses this same address). Jettons are not accepted.</> : depositNetwork === 'eth' ? <>Send native <Icon name="eth" size={17} title="ETH" /> only on Ethereum Mainnet to this address:</> : depositNetwork === 'usdc_eth' ? <>Send only <Icon name="usdt" size={17} title="USDC" /> (USDC ERC20) on Ethereum Mainnet to this address:</> : <>Send only <Icon name="usdt" size={17} title="USDT" /> on {depositNetwork.toUpperCase()} network to this address:</>}
            </div>
            <div style={{ padding: 10, borderRadius: 8, background: 'rgba(0,255,136,0.07)', wordBreak: 'break-all', fontSize: '0.78rem' }}>
              {depositNetwork === 'ton' ? 'UQBtBjwUwBXKsJuRr1UFdba_B1Rh8gXo0uFBzuT9-mVC17yl' : depositNetwork === 'bep20' ? '0xaaa40bd792bd26c1e5f6481b25ac1f8d4cf62f4a' : depositNetwork === 'trc20' ? 'THcEQMCe1eyfajz7TyFUe8EmW2AQuCc1do' : '0x87Ad7Fe8Be9eeEa2E388F80f4C5fcF450E037463'}
            </div>
            <button className="btn btn-secondary" style={{ width: '100%', marginTop: 8 }} onClick={() => {
              const address = depositNetwork === 'ton' ? 'UQBtBjwUwBXKsJuRr1UFdba_B1Rh8gXo0uFBzuT9-mVC17yl' : depositNetwork === 'bep20' ? '0xaaa40bd792bd26c1e5f6481b25ac1f8d4cf62f4a' : depositNetwork === 'trc20' ? 'THcEQMCe1eyfajz7TyFUe8EmW2AQuCc1do' : '0x87Ad7Fe8Be9eeEa2E388F80f4C5fcF450E037463';
              navigator.clipboard?.writeText(address).then(() => showToast('Deposit address copied')).catch(() => showToast('Copy address manually'));
            }}>Copy Deposit Address</button>
            <input className="input" style={{ marginTop: 12 }} placeholder="Paste transaction hash" value={depositHash} onChange={(e) => setDepositHash(e.target.value.trim())} />
            <button className="btn btn-primary" style={{ width: '100%' }} onClick={verifyDeposit} disabled={depositBusy}>
              {depositBusy ? 'Checking blockchain…' : 'Verify Deposit'}
            </button>
            <div style={{ marginTop: 12, fontSize: '0.85rem', color: '#a0ffc0' }}>
              Verified balance: <Icon name={depositNetwork === 'ton' ? 'ton' : depositNetwork === 'eth' ? 'eth' : 'usdt'} size={20} title={depositNetwork === 'ton' ? 'TON' : depositNetwork === 'eth' ? 'ETH' : depositNetwork === 'usdc_eth' ? 'USDC' : 'USDT'} /> {Number(depositData.balances?.[depositNetwork] || 0).toFixed(depositNetwork === 'ton' || depositNetwork === 'eth' ? 9 : 6)} {depositNetwork === 'usdc_eth' ? 'USDC' : depositNetwork === 'eth' ? 'ETH' : depositNetwork === 'ton' ? 'TON' : 'USDT'}
            </div>
            <div style={{ fontSize: '0.72rem', color: '#888', marginTop: 5 }}>
              {depositNetwork === 'ton' ? 'TON sender must match your TON Connect signature-verified wallet. Connect your TON wallet above before submitting a deposit.' : 'Ethereum deposits require ETH or native USDC ERC20 on Ethereum Mainnet. The sender must match your signature-verified EVM wallet. Each transaction hash can be credited once.'}
            </div>
          </div>

          <div className="card">
            <div className="card-title"><img src="/hype-coin.svg" alt="HYPE" style={{width:26,height:26,objectFit:'contain'}} /> Withdraw</div>
            <div style={{ marginBottom: 10, fontSize: '0.9rem' }}>
              <img src="/hype-coin.svg" alt="HYPE" style={{width:24,height:24,objectFit:'contain',verticalAlign:'middle'}} /> <strong style={{ color: '#00ff88' }}>{formatNum(user?.balance, 10)}</strong>
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
            {connectedWallet && (
              <div style={{ fontSize: '0.8rem', color: '#a0ffc0', marginBottom: 10 }}>
                To: {shortAddr(connectedWallet)}
              </div>
            )}
            <button
              className="btn btn-primary"
              style={{ width: '100%' }}
              onClick={requestWithdraw}
              disabled={!connectedWallet}
            >
              {connectedWallet ? 'Request Withdrawal' : 'Connect wallet first'}
            </button>
          </div>

          <div className="card">
            <div className="card-title"><Icon name="chart" size={16} /> Transaction History</div>
            {history.length === 0 && <div style={{ color: '#777', fontSize: '0.85rem' }}>No deposit, swap or withdrawal activity yet.</div>}
            {history.map((item) => {
              const name = [item.first_name, item.last_name].filter(Boolean).join(' ') || (item.username ? '@' + item.username : 'User #' + item.user_id);
              const assetIcon = String(item.asset || '').toUpperCase() === 'TON' ? 'ton' : String(item.asset || '').toUpperCase().includes('USDT') ? 'usdt' : 'hype';
              const stamp = Number(item.created_at) * 1000;
              return (
                <div key={item.type + '-' + item.id} style={{ padding: '11px 0', borderBottom: '1px solid rgba(0,255,136,0.12)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
                      {assetIcon === 'hype' ? <img src="/hype-coin.svg" alt="HYPE" style={{width:24,height:24,objectFit:'contain'}} /> : <Icon name={assetIcon} size={22} title={item.asset} />}
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: '0.86rem', fontWeight: 800 }}>{item.type === 'deposit' ? 'Deposit' : item.type === 'withdrawal' ? 'Withdrawal' : 'Swap'}</div>
                        <div style={{ fontSize: '0.72rem', color: '#9aa' }}>{name} {item.username ? '· @' + item.username : ''}</div>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontWeight: 800, color: item.type === 'deposit' ? '#00ff88' : '#e0ffe8' }}>
                        {item.type === 'deposit' ? '+' : item.type === 'withdrawal' ? '−' : ''}{formatNum(item.amount, item.asset === 'TON' ? 9 : 10)} {item.asset}
                      </div>
                      {item.type === 'swap' && <div style={{ fontSize: '0.72rem', color: '#9aa' }}>→ {formatNum(item.to_amount, 10)} {item.to_asset}</div>}
                      <div style={{ fontSize: '0.7rem', color: item.status === 'approved' || item.status === 'completed' ? '#00ff88' : item.status === 'rejected' ? '#ff6677' : '#ffaa00' }}>{item.status}</div>
                    </div>
                  </div>
                  <div style={{ fontSize: '0.7rem', color: '#777', marginTop: 5 }}>{item.network} · {Number.isFinite(stamp) && stamp > 0 ? new Date(stamp).toLocaleString() : ''}</div>
                  {item.tx_hash && <div style={{ fontSize: '0.68rem', color: '#667', overflowWrap: 'anywhere' }}>TX: {item.tx_hash}</div>}
                  {item.type === 'withdrawal' && item.to_address && <div style={{ fontSize: '0.68rem', color: '#667', overflowWrap: 'anywhere' }}>To: {item.to_address}</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ADMIN PANEL */}
      {tab === 'admin' && user?.is_admin && (
        <div className="page">
          <h3 style={{ color: '#f0d878', marginBottom: 12 }}><Icon name="settings" size={16} /> Admin Panel</h3>
          <div className="admin-tabs">
            {['stats', 'activity', 'settings', 'users', 'referrals', 'withdrawals', 'tasks', 'broadcast'].map((t) => (
              <button
                key={t}
                className={`admin-tab ${adminTab === t ? 'active' : ''}`}
                onClick={() => setAdminTab(t)}
              >
                {t}
              </button>
            ))}
          </div>

          {adminTab === 'activity' && (
            <div className="card">
              <div className="card-title"><Icon name="chart" size={16} /> All User Transactions</div>
              {adminHistory.length === 0 && <div style={{ color: '#777' }}>No transactions recorded yet.</div>}
              {adminHistory.map((item) => {
                const name = [item.first_name, item.last_name].filter(Boolean).join(' ') || (item.username ? '@' + item.username : 'User #' + item.user_id);
                const icon = String(item.asset || '').toUpperCase() === 'TON' ? 'ton' : String(item.asset || '').toUpperCase().includes('USDT') ? 'usdt' : 'hype';
                return <div key={item.type + '-' + item.id} style={{ padding: '10px 0', borderBottom: '1px solid rgba(0,255,136,0.12)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Icon name={icon} size={21} /><div><div>{name}</div><div style={{ fontSize: '0.7rem', color: '#888' }}>@{item.username || item.user_id} · {item.type}</div></div></div>
                    <div style={{ textAlign: 'right' }}><strong>{formatNum(item.amount, 10)} {item.asset}</strong>{item.type === 'swap' && <div style={{ fontSize: '0.72rem' }}>→ {formatNum(item.to_amount, 10)} {item.to_asset}</div>}<div style={{ color: item.status === 'completed' || item.status === 'approved' ? '#00ff88' : item.status === 'rejected' ? '#ff6677' : '#ffaa00', fontSize: '0.72rem' }}>{item.status}</div></div>
                  </div>
                  <div style={{ fontSize: '0.7rem', color: '#777', marginTop: 4 }}>{item.network} · {new Date(Number(item.created_at) * 1000).toLocaleString()}</div>
                  {item.tx_hash && <div style={{ fontSize: '0.68rem', color: '#667', overflowWrap: 'anywhere' }}>TX: {item.tx_hash}</div>}
                </div>;
              })}
            </div>
          )}

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

              <label style={{ fontSize: '0.8rem', color: '#a0ffc0' }}><Icon name="calendar" size={14} /> Default Daily Check-in (fallback)</label>
              <input className="input" type="number" step="any" value={settingsForm.daily_checkin_reward}
                onChange={(e) => setSettingsForm({ ...settingsForm, daily_checkin_reward: e.target.value })}
                placeholder="e.g. 0.001" />

              <div style={{ marginTop: 10, marginBottom: 6, fontWeight: 800, color: '#f0d878', fontSize: '0.85rem' }}>
                7-Day Streak Rewards (HYPE)
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {[1,2,3,4,5,6,7].map((d) => (
                  <div key={d}>
                    <label style={{ fontSize: '0.72rem', color: '#a0ffc0' }}>Day {d}</label>
                    <input className="input" type="number" step="any" value={settingsForm[`day${d}`]}
                      onChange={(e) => setSettingsForm({ ...settingsForm, [`day${d}`]: e.target.value })}
                      placeholder={`Day ${d} reward`} />
                  </div>
                ))}
              </div>
              <button className="btn btn-primary" style={{ width: '100%', marginTop: 8 }} onClick={saveSettings}>
                <Icon name="save" size={14} /> Save & Apply Live
              </button>
              {adminSettings && (
                <div style={{ marginTop: 12, fontSize: '0.8rem', color: 'rgba(0,255,136,0.7)', lineHeight: 1.5 }}>

<strong>Live values:</strong><br />
                  Tap: {formatNum(adminSettings.tap_reward, 12)} • Referral: {formatNum(adminSettings.referral_reward, 12)}<br />
                  Min WD: {formatNum(adminSettings.min_withdraw, 8)} • Energy: {adminSettings.energy_max} / {adminSettings.energy_cooldown}s<br />
                  Day 1–7 rewards: {formatNum(checkinRewards[0], 12)}, {formatNum(checkinRewards[1], 12)}, {formatNum(checkinRewards[2], 12)}, {formatNum(checkinRewards[3], 12)}, {formatNum(checkinRewards[4], 12)}, {formatNum(checkinRewards[5], 12)}, {formatNum(checkinRewards[6], 12)} HYPE
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
              <div className="card" style={{ marginBottom: 10 }}>
                <div className="card-title">Withdrawal History Control</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {['pending', 'processing', 'approved', 'rejected'].map((s) => (
                    <button
                      key={s}
                      className={`admin-tab ${adminWdFilter === s ? 'active' : ''}`}
                      onClick={() => {
                        setAdminWdFilter(s);
                        api(`/api/admin/withdrawals?status=${s}`).then((d) => {
                          if (!d.error) setAdminWithdrawals(d.withdrawals || []);
                        });
                      }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
              {adminWithdrawals.length === 0 && (
                <div className="card">No {adminWdFilter} withdrawals</div>
              )}
              {adminWithdrawals.map((w) => (
                <div className="card" key={w.id}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      @{w.username || w.user_id} • <strong>{formatNum(w.amount, 8)} HYPE</strong>
                    </div>
                    <span style={{
                      fontSize: '0.75rem',
                      fontWeight: 800,
                      color:
                        w.status === 'approved' ? '#00ff88'
                        : w.status === 'rejected' ? '#ff5566'
                        : w.status === 'processing' ? '#66aaff'
                        : '#ffaa00',
                    }}>
                      {w.status}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.78rem', wordBreak: 'break-all', margin: '6px 0', color: '#a0ffc0' }}>
                    {w.wallet_address}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: '#666', marginBottom: 8 }}>
                    ID: {w.id} • User: {w.user_id}
                    {w.created_at ? ` • ${new Date((w.created_at > 1e12 ? w.created_at : w.created_at * 1000)).toLocaleString()}` : ''}
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {w.status !== 'approved' && (
                      <button className="btn btn-primary" style={{ flex: 1, padding: 8, minWidth: 90 }} onClick={() => adminAction(w.id, 'approve')}>
                        Approve
                      </button>
                    )}
                    {w.status !== 'processing' && (
                      <button className="btn btn-outline" style={{ flex: 1, padding: 8, minWidth: 90 }} onClick={() => adminAction(w.id, 'processing')}>
                        Processing
                      </button>
                    )}
                    {w.status !== 'rejected' && (
                      <button className="btn btn-danger" style={{ flex: 1, padding: 8, minWidth: 90 }} onClick={() => adminAction(w.id, 'reject')}>
                        Reject / Refund
                      </button>
                    )}
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
                  <option value="youtube">YouTube Visit Task</option>
                </select>
                <input className="input" placeholder="Link" value={newTask.link} onChange={(e) => setNewTask({ ...newTask, link: e.target.value })} />
                <div className="muted" style={{ fontSize: 12 }}>{newTask.type === 'telegram' ? 'Public t.me channel link required. Add the bot as a channel admin for automatic membership verification.' : 'YouTube link opens for the user; they return to HYPE Tap and wait 5 seconds before claiming.'}</div>

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
