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
  video: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="13" height="14" rx="2"/><path d="m16 10 5-3v10l-5-3"/></svg>),
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
  activity: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12h4l3-8 4 16 3-8h4" />
    </svg>
  ),
  "arrow-left-right": (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 3l4 4-4 4M3 7h18M7 21l-4-4 4-4M21 17H3" />
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
  const [evmSessionAddress, setEvmSessionAddress] = useState('');
  const tonConnectUIRef = useRef(null);
  const tonProofVerifyingRef = useRef(false);
  const [depositNetwork, setDepositNetwork] = useState('eth');
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
  const [assistantMessages, setAssistantMessages] = useState([]);
  const [assistantInput, setAssistantInput] = useState('');
  const [assistantBusy, setAssistantBusy] = useState(false);
  const assistantScrollRef = useRef(null);
  const [adminStats, setAdminStats] = useState(null);
  const [adminWithdrawals, setAdminWithdrawals] = useState([]);
  const [adminDepositSwaps, setAdminDepositSwaps] = useState([]);
  const [adminWdFilter, setAdminWdFilter] = useState('pending'); // pending | approved | rejected | processing
  const [adminTasks, setAdminTasks] = useState([]);
  const [adminSettings, setAdminSettings] = useState(null);
  const [adminLeaderboard, setAdminLeaderboard] = useState([]);
  const [adminReferrals, setAdminReferrals] = useState([]);
  const [editUserId, setEditUserId] = useState('');
  const [editUserData, setEditUserData] = useState({ balance: '', total_earned: '', total_taps: '', is_admin: false, invite_count: '' });
  const [settingsForm, setSettingsForm] = useState({ tap_reward: '', referral_reward: '', min_withdraw: '', energy_max: '', energy_cooldown: '', daily_checkin_reward: '', ad_reward: '0.0000007854', ads_enabled: true, streak_bonus: '0', day1: '0.0000089', day2: '0.000002', day3: '0.000006', day4: '0.000007', day5: '0.0000079', day6: '0.0000089', day7: '0.0004' });
  const [canCheckin, setCanCheckin] = useState(true);
  const [checkinWait, setCheckinWait] = useState(0);
  const [checkinBusy, setCheckinBusy] = useState(false);
  const checkinInFlight = useRef(false);
  const [broadcastMsg, setBroadcastMsg] = useState('');
  const [broadcastPhoto, setBroadcastPhoto] = useState('');

const [broadcastSending, setBroadcastSending] = useState(false);
  const [newTask, setNewTask] = useState({ title: '', type: 'telegram', link: '', reward: '0.0085' });
  const [wdAmount, setWdAmount] = useState('');
  const [withdrawBusy, setWithdrawBusy] = useState(false);
  const [wdWallet, setWdWallet] = useState('');
  const [connectedWallet, setConnectedWallet] = useState('');
  const [walletConnecting, setWalletConnecting] = useState(false);
  const [showWalletChoices, setShowWalletChoices] = useState(false);
  const [depositOrders, setDepositOrders] = useState([]);
  const [depositOrdersBusy, setDepositOrdersBusy] = useState(false);
  const swapProviderRef = useRef(null);
  // Daily check-in streak (7-day)
  const [streak, setStreak] = useState(0);
  const [streakTotalEarned, setStreakTotalEarned] = useState(0);
  const [checkinRewards, setCheckinRewards] = useState([0.0000089, 0.000002, 0.000006, 0.000007, 0.0000079, 0.0000089, 0.0004]);
  const [adBusy, setAdBusy] = useState(false);
  const [adStatus, setAdStatus] = useState('');
  const [adUsage, setAdUsage] = useState({ daily_limit: 1000, ads_used: 0, ads_remaining: 1000, retry_after: 0 });
  const [adResetCountdown, setAdResetCountdown] = useState(0);
  const [adHistory, setAdHistory] = useState([]);
  const [adHistoryOpen, setAdHistoryOpen] = useState(false);
  const [adHistoryBusy, setAdHistoryBusy] = useState(false);

  const tapQueue = useRef(0);
  const tapTimer = useRef(null);
  const energyRef = useRef(1000);
  const tapInFlight = useRef(false);
  const pendingFlush = useRef(false);

  const copyText = async (value) => {
    const text = String(value ?? '');
    if (!text) throw new Error('Nothing to copy');
    try {
      if (navigator.clipboard?.writeText && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) {}
    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.opacity = '0';
    field.style.pointerEvents = 'none';
    document.body.appendChild(field);
    field.select();
    field.setSelectionRange(0, field.value.length);
    let copied = false;
    try { copied = document.execCommand('copy'); } catch (_) {}
    field.remove();
    if (!copied) throw new Error('Copy unavailable; please copy manually');
    return true;
  };

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

      // WalletConnect / Trust Wallet expect personal_sign payloads as hex.
      // This is an ownership proof only; it does not authorize transactions.
      const messageHex = '0x' + Array.from(new TextEncoder().encode(challenge.message))
        .map((byte) => byte.toString(16).padStart(2, '0')).join('');
      let signature;
      try {
        signature = await signer.request({ method: 'personal_sign', params: [messageHex, clean] });
      } catch (hexErr) {
        // Some injected providers accept UTF-8 text instead of hex.
        signature = await signer.request({ method: 'personal_sign', params: [challenge.message, clean] });
      }

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
      const providers = eth.providers;
      eth = providers.find((p) => p.isTrust || p.isTrustWallet) || providers.find((p) => p.isMetaMask && !p.isBraveWallet) || providers.find((p) => p.isRabby) || providers.find((p) => p.isCoinbaseWallet) || providers[0];
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
  const connectWalletConnect = async (useWalletPicker = false) => {
    const projectId = await getWcProjectId();
    if (!projectId) {
      throw new Error('WalletConnect Project ID missing — add /api/config route + WALLETCONNECT_PROJECT_ID in Worker vars');
    }

    const { default: EthereumProvider } = await import('@walletconnect/ethereum-provider');

    // Reuse an already-approved WalletConnect session. Disconnecting it here
    // used to destroy the Trust Wallet session every time the user retried.
    if (wcProviderRef.current) {
      try {
        const existingAccounts = wcProviderRef.current.accounts?.length
          ? wcProviderRef.current.accounts
          : await wcProviderRef.current.request({ method: 'eth_accounts' });
        if (existingAccounts?.[0]) return existingAccounts[0];
      } catch (_) {}
    }

    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://localhost';
    const inTelegram = Boolean(window.Telegram?.WebApp?.initData);

    // In Telegram's Android WebView, the default WalletConnect modal can open
    // Trust Wallet without forwarding the pairing URI. Use Trust's documented
    // WalletConnect deep link so the exact pending session reaches the wallet.
    const provider = await EthereumProvider.init({
      projectId,
      // HYPE is the native asset on HyperEVM. Request only HyperEVM;
      // do not negotiate Ethereum Mainnet or BNB Chain for this wallet.
      // Treat HyperEVM as optional during pairing so wallets that do not
      // advertise chain 999 as a required chain can still approve the session.
      // The app accepts an account only when the approved session includes 999.
      chains: [],
      optionalChains: [999],
      // Keep the WalletConnect explorer modal enabled inside Telegram too.
      // It lists all compatible wallet apps (including Trust Wallet) rather
      // than hard-routing every user to Trust Wallet.
      showQrModal: useWalletPicker || !inTelegram,
      // Only account access and personal message signing are needed.
      // No transaction signing or transfer permissions are requested.
      methods: ['personal_sign', 'eth_sendTransaction'],
      optionalMethods: ['eth_signTypedData', 'eth_signTypedData_v4'],
      events: ['chainChanged', 'accountsChanged', 'disconnect', 'session_delete'],
      rpcMap: {
        999: 'https://rpc.hyperliquid.xyz/evm',
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
      if (accounts?.[0]) { setConnectedWallet(''); setWdWallet(''); setEvmSessionAddress(accounts[0]); }
      else {
        setConnectedWallet('');
        setWdWallet('');
        setEvmSessionAddress('');
      }
    });
    provider.on('disconnect', () => {
      setConnectedWallet('');
      setWdWallet('');
      setEvmSessionAddress('');
      wcProviderRef.current = null;
    });
    provider.on('session_delete', () => {
      setConnectedWallet('');
      setWdWallet('');
      wcProviderRef.current = null;
    });

// In Telegram WebView, pass the exact WalletConnect URI to Trust Wallet.
    // Trust Wallet documents this /wc deep link for WalletConnect v2.
    if (inTelegram && !useWalletPicker) {
      provider.on('display_uri', (uri) => {
        if (!uri) return;
        const trustLink = `https://link.trustwallet.com/wc?uri=${encodeURIComponent(uri)}`;
        // Telegram WebView cannot handle Trust's redirected trust:// scheme.
        // openLink hands the HTTPS universal link to Android outside the WebView.
        const telegramWebApp = window.Telegram?.WebApp;
        if (typeof telegramWebApp?.openLink === 'function') {
          telegramWebApp.openLink(trustLink);
        } else {
          window.open(trustLink, '_blank', 'noopener,noreferrer');
        }
      });
    }

    // enable() waits for explicit wallet approval; no address is accepted before it.
    await provider.enable();

    // Telegram Android WebView + Trust Wallet often needs a short settle time
    // before personal_sign / eth_accounts are reliably available on the session.
    await new Promise((r) => setTimeout(r, 900));

    // EthereumProvider filters approved WalletConnect accounts to the
    // configured HyperEVM chain. Do not fall back to an Ethereum account.
    const accounts = provider.accounts || [];
    return accounts[0] || null;
  };

  const connectExternalWallet = async () => {
    if (connectedWallet || evmSessionAddress || walletConnecting) return;
    setWalletConnecting(true);

    // Telegram Mini Apps run inside Telegram's WebView. An injected ethereum
    // provider there can hand off to Trust Wallet without creating a WalletConnect
    // session, which leaves Trust Wallet open with no sign-in request. Prefer
    // WalletConnect in Telegram; use injected providers in a normal wallet browser.
    const inTelegram = Boolean(window.Telegram?.WebApp?.initData);

    const connectWithWalletConnect = async () => {
      const addr = await connectWalletConnect();
      if (!addr) throw new Error('WalletConnect returned no account');
      setEvmSessionAddress(addr);
      // A wallet connection is enough to show the address in the app.
      // Keep ownership verification separate for actions that require it.
      swapProviderRef.current = wcProviderRef.current;
      return true;
    };

    const connectWithInjected = async () => {
      const injected = await connectInjected();
      if (!injected) return false;
      setEvmSessionAddress(injected.address);
      // Do not request a sign-in message just to connect the wallet.
      swapProviderRef.current = injected.provider;
      return true;
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

  const connectAllWallets = async () => {
    if (connectedWallet || evmSessionAddress || walletConnecting) return;
    setWalletConnecting(true);
    setShowWalletChoices(false);
    try {
      const addr = await connectWalletConnect(true);
      if (!addr) throw new Error('WalletConnect returned no account');
      setEvmSessionAddress(addr);
      swapProviderRef.current = wcProviderRef.current;
    } catch (e) {
      console.warn('All-wallet connection failed:', e);
      const msg = e?.message || 'Wallet connection failed';
      if (msg.includes('User rejected') || msg.includes('denied') || msg.includes('cancelled')) {
        showToast('Wallet connection cancelled');
      } else {
        showToast(String(msg).slice(0, 150));
      }
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
    setEvmSessionAddress('');
    try {
      await api('/api/wallet', {
        method: 'POST',
        body: JSON.stringify({ user: tg?.initDataUnsafe?.user, wallet_address: '' }),
      });
    } catch (_) {}
    showToast('Wallet disconnected');
  };
  const shortAddr = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');
  // Recover approved wallet sessions when the Mini App returns from Trust Wallet
  // or Telegram Wallet. Query-only calls never open a wallet or request approval.
  useEffect(() => {
    let disposed = false;
    let syncing = false;
    const syncWalletsOnReturn = async () => {
      if (disposed || syncing) return;
      syncing = true;
      try {
        let evmAddress = '';
        let activeProvider = wcProviderRef.current;

        if (activeProvider) {
          try {
            const accounts = activeProvider.accounts?.length
              ? activeProvider.accounts
              : await activeProvider.request({ method: 'eth_accounts' });
            evmAddress = accounts?.[0] || '';
          } catch (_) {}
        }

        // Trust Wallet's injected provider can appear only after returning from
        // its app. eth_accounts checks an existing grant without showing a prompt.
        if (!evmAddress && window.ethereum) {
          const providers = window.ethereum.providers?.length
            ? window.ethereum.providers
            : [window.ethereum];
          const injected = providers.find((p) => p.isTrust || p.isTrustWallet) ||
            providers.find((p) => p.isMetaMask && !p.isBraveWallet) ||
            providers.find((p) => p.isRabby) || providers[0];
          try {
            const accounts = await injected.request({ method: 'eth_accounts' });
            if (accounts?.[0]) {
              evmAddress = accounts[0];
              activeProvider = injected;
            }
          } catch (_) {}
        }

        // WalletConnect can restore its persisted session after a Telegram
        // WebView resumes. Do not call enable() here: that would open a modal.
        if (!evmAddress) {
          try {
            const projectId = await getWcProjectId();
            if (projectId) {
              const { default: EthereumProvider } = await import('@walletconnect/ethereum-provider');
              const restored = await EthereumProvider.init({
                projectId,
                // Restore only an account explicitly approved for HyperEVM.
                chains: [],
                optionalChains: [999],
                showQrModal: false,
                methods: ['personal_sign', 'eth_sendTransaction'],
                optionalMethods: ['eth_signTypedData', 'eth_signTypedData_v4'],
                events: ['chainChanged', 'accountsChanged', 'disconnect', 'session_delete'],
                rpcMap: {
                  999: 'https://rpc.hyperliquid.xyz/evm',
                },
                metadata: {
                  name: 'Hype Token',
                  description: 'Hype EVM Native — Tap to Earn',
                  url: window.location.origin,
                  icons: [`${window.location.origin}/hype-logo.png`],
                },
              });
              // Never treat an account on another EVM chain as HyperEVM.
              const accounts = restored.accounts || [];
              if (accounts?.[0]) {
                activeProvider = restored;
                evmAddress = accounts[0];
                wcProviderRef.current = restored;
                swapProviderRef.current = restored;
                restored.on('accountsChanged', (next) => {
                  const address = next?.[0] || '';
                  setEvmSessionAddress(address);
                  if (!address) { setConnectedWallet(''); setWdWallet(''); }
                });
                restored.on('disconnect', () => {
                  setEvmSessionAddress('');
                  setConnectedWallet('');
                  setWdWallet('');
                  wcProviderRef.current = null;
                });
                restored.on('session_delete', () => {
                  setEvmSessionAddress('');
                  setConnectedWallet('');
                  setWdWallet('');
                  wcProviderRef.current = null;
                });
              }
            }
          } catch (error) {
            console.warn('WalletConnect session restore pending:', error);
          }
        }

        if (!disposed && evmAddress) {
          setEvmSessionAddress(evmAddress);
          swapProviderRef.current = activeProvider || swapProviderRef.current;
        }

        // TON Connect keeps its approved session in the WebView while the
        // external Telegram Wallet/Tonkeeper app is in the foreground.
        const tonUI = tonConnectUIRef.current || window.__HYPE_TONCONNECT_UI__;
        const tonAddress = tonUI?.connected ? String(tonUI.account?.address || '') : '';
        if (!disposed && tonAddress) {
          let verifiedWallet = null;
          try {
            const saved = await api('/api/ton-wallet');
            const linked = saved?.wallet;
            if (linked?.address_raw && linked.address_raw === tonAddress) verifiedWallet = linked;
          } catch (_) {}
          setTonWallet({
            address_friendly: verifiedWallet?.address_friendly || tonAddress,
            address_raw: tonAddress,
            verified: Boolean(verifiedWallet),
          });
        }
      } finally {
        syncing = false;
      }
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') syncWalletsOnReturn();
    };
    syncWalletsOnReturn();
    window.addEventListener('pageshow', syncWalletsOnReturn);
    window.addEventListener('focus', syncWalletsOnReturn);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      disposed = true;
      window.removeEventListener('pageshow', syncWalletsOnReturn);
      window.removeEventListener('focus', syncWalletsOnReturn);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // Initialize TON Connect on app startup so its persisted session can restore
  // without requiring the user to press Connect again. A saved server link alone
  // is never treated as a live connection; only TonConnect's active account counts.
  useEffect(() => {
    let disposed = false;
    const restoreTonConnect = async () => {
      if (window.__HYPE_TONCONNECT_UI__) {
        tonConnectUIRef.current = window.__HYPE_TONCONNECT_UI__;
        return;
      }
      if (!window.__HYPE_TONCONNECT_LOAD_PROMISE__) {
        window.__HYPE_TONCONNECT_LOAD_PROMISE__ = (async () => {
          const sources = [
            'https://unpkg.com/@tonconnect/ui@2.0.9/dist/tonconnect-ui.min.js',
            'https://cdn.jsdelivr.net/npm/@tonconnect/ui@2.0.9/dist/tonconnect-ui.min.js',
            'https://unpkg.com/@tonconnect/ui@2.2.4/dist/tonconnect-ui.min.js',
            'https://cdn.jsdelivr.net/npm/@tonconnect/ui@2.2.4/dist/tonconnect-ui.min.js',
          ];
          let lastError;
          for (const src of sources) {
            try {
              if (window.TON_CONNECT_UI?.TonConnectUI) return true;
              if (window.customElements?.get('tc-root')) throw new Error('TON Connect UI is partially initialized');
              await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                const timeout = setTimeout(() => {
                  script.remove();
                  reject(new Error('TON Connect UI download timed out'));
                }, 15000);
                script.src = src;
                script.async = true;
                script.dataset.tonconnectUi = 'true';
                script.onload = () => {
                  clearTimeout(timeout);
                  setTimeout(() => window.TON_CONNECT_UI?.TonConnectUI ? resolve() : reject(new Error('TON Connect UI did not initialize')), 50);
                };
                script.onerror = () => {
                  clearTimeout(timeout);
                  script.remove();
                  reject(new Error('TON Connect UI CDN unavailable'));
                };
                document.head.appendChild(script);
              });
              if (window.TON_CONNECT_UI?.TonConnectUI) return true;
            } catch (error) {
              lastError = error;
              if (window.customElements?.get('tc-root')) throw error;
            }
          }
          throw lastError || new Error('Could not load TON Connect UI');
        })();
      }
      await window.__HYPE_TONCONNECT_LOAD_PROMISE__;
      if (disposed || window.__HYPE_TONCONNECT_UI__) return;
      const TonConnectUI = window.TON_CONNECT_UI?.TonConnectUI;
      if (typeof TonConnectUI !== 'function') throw new Error('TON Connect UI unavailable');
      const ui = new TonConnectUI({
        manifestUrl: window.location.origin + '/tonconnect-manifest.json',
        enableAndroidBackHandler: false,
      });
      ui.setConnectionNetwork('-239');
      tonConnectUIRef.current = ui;
      window.__HYPE_TONCONNECT_UI__ = ui;
      ui.onStatusChange(async (wallet) => {
        if (!wallet?.account?.address) {
          setTonWallet(null);
          return;
        }
        const address = String(wallet.account.address);
        let linked = null;
        try {
          const saved = await api('/api/ton-wallet');
          if (saved?.wallet?.address_raw === address) linked = saved.wallet;
        } catch (_) {}
        if (!disposed) {
          setTonWallet({
            address_friendly: linked?.address_friendly || address,
            address_raw: address,
            verified: Boolean(linked),
          });
        }
      });
      // TonConnectUI restores its persisted session internally; this also
      // covers clients that emit status before the React listener is attached.
      if (ui.connected && ui.account?.address) {
        const address = String(ui.account.address);
        let linked = null;
        try {
          const saved = await api('/api/ton-wallet');
          if (saved?.wallet?.address_raw === address) linked = saved.wallet;
        } catch (_) {}
        if (!disposed) setTonWallet({
          address_friendly: linked?.address_friendly || address,
          address_raw: address,
          verified: Boolean(linked),
        });
      } else if (!disposed) {
        setTonWallet(null);
      }
    };
    // React StrictMode mounts effects twice in development/Telegram WebView.
    // Publish one shared promise before initialization starts so only one
    // TonConnectUI instance can register the global tc-root element.
    if (!window.__HYPE_TONCONNECT_INIT_PROMISE__) {
      window.__HYPE_TONCONNECT_INIT_PROMISE__ = Promise.resolve().then(restoreTonConnect).catch((error) => {
        console.warn('TON Connect session restore unavailable:', error);
        if (!window.customElements?.get('tc-root')) {
          window.__HYPE_TONCONNECT_LOAD_PROMISE__ = null;
        }
        window.__HYPE_TONCONNECT_INIT_PROMISE__ = null;
        throw error;
      });
    }
    window.__HYPE_TONCONNECT_INIT_PROMISE__.catch(() => {});
    return () => { disposed = true; };
  }, []);


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
        });        if (finalEnergy <= 0) {
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
    const [stats, wds, tks, activity, swaps] = await Promise.all([
      api('/api/admin/stats'),
      api(`/api/admin/withdrawals?status=${adminWdFilter || 'pending'}`),
      api('/api/admin/tasks'),
      api('/api/admin/history'),
      api('/api/admin/deposit-swaps?status=all'),
    ]);
    setAdminStats(stats);
    setAdminWithdrawals(wds.withdrawals || []);
    setAdminTasks(tks.tasks || []);
    setAdminHistory(activity.history || []);
    setAdminDepositSwaps((swaps.orders || []).filter((o) => ['queued', 'processing'].includes(o.status)));
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
        ad_reward: data.ad_reward != null ? formatNum(data.ad_reward, 18) : '0.0000007854',
        ads_enabled: data.ads_enabled !== false,
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
    if (settingsForm.ad_reward !== '') body.ad_reward = parseFloat(settingsForm.ad_reward);
    body.ads_enabled = Boolean(settingsForm.ads_enabled);
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


  const sendHypeAssistant = async (textOverride) => {
    const content = String(textOverride ?? assistantInput).trim();
    if (!content || assistantBusy) return;
    const initData = window.Telegram?.WebApp?.initData || tg?.initData || '';
    if (!initData) {
      showToast('Open HYPE inside Telegram to verify admin access');
      return;
    }
    const nextMessages = [...assistantMessages, { role: 'user', content }];
    setAssistantMessages(nextMessages);
    setAssistantInput('');
    setAssistantBusy(true);
    try {
      const response = await fetch('https://hype.rajtilakbbu1.workers.dev/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Telegram-Init-Data': initData,
        },
        body: JSON.stringify({ messages: nextMessages.slice(-12) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.answer) {
        throw new Error(data.error || 'HYPE AI request failed');
      }
      setAssistantMessages((prev) => [...prev, { role: 'assistant', content: data.answer }]);
    } catch (error) {
      setAssistantMessages((prev) => [...prev, {
        role: 'assistant',
        content: '⚠️ ' + (error?.message || 'Could not connect to HYPE AI. Please try again.'),
      }]);
    } finally {
      setAssistantBusy(false);
    }
  };

  // Load extra admin data when tab changes
  useEffect(() => {
    if (tab !== 'admin' || !user?.is_admin) return;
    if (adminTab === 'settings') loadAdminSettings();
    if (adminTab === 'users') loadAdminLeaderboard();
    if (adminTab === 'referrals') loadAdminReferrals();
  }, [adminTab, tab, user]);

  const loadAdUsage = async () => {
    const usage = await api('/api/ads/usage');
    if (!usage.error) {
      setAdUsage({
        daily_limit: Number(usage.daily_limit) || 1000,
        ads_used: Number(usage.ads_used) || 0,
        ads_remaining: Math.max(0, Number(usage.ads_remaining) || 0),
        retry_after: Math.max(0, Number(usage.retry_after) || 0),
      });
    }
  };

  useEffect(() => {
    if (tab === 'tap' && user && config?.ads_enabled !== false) loadAdUsage();
  }, [tab, user, config?.ads_enabled]);

  useEffect(() => {
    setAdResetCountdown(adUsage.retry_after || 0);
    if (!adUsage.retry_after) return;
    const timer = setInterval(() => setAdResetCountdown((v) => Math.max(0, v - 1)), 1000);
    return () => clearInterval(timer);
  }, [adUsage.retry_after]);

  const loadAdHistory = async () => {
    setAdHistoryBusy(true);
    try {
      const data = await api('/api/ads/history');
      if (data.error) {
        showToast(data.error);
        return;
      }
      setAdHistory(Array.isArray(data.history) ? data.history : []);
      setAdHistoryOpen(true);
    } finally {
      setAdHistoryBusy(false);
    }
  };

  const watchRewardedAd = async () => {
    if (adBusy || adUsage.ads_remaining <= 0) return;
    setAdBusy(true);
    setAdStatus('Preparing ad…');
    try {
      const session = await api('/api/ads/start', { method: 'POST', body: JSON.stringify({}) });
      if (session.ads_used !== undefined) {
        setAdUsage({ daily_limit: 1000, ads_used: Number(session.ads_used) || 0, ads_remaining: Number(session.ads_remaining) || 0, retry_after: 0 });
      }
      if (session.error || !session.ymid) {
        await loadAdUsage();
        throw new Error(session.error || 'Could not start ad session');
      }
      const showAd = window.show_12178167;
      if (typeof showAd !== 'function') throw new Error('Monetag SDK is still loading. Please try again.');
      const result = await showAd({ ymid: session.ymid, requestVar: 'tasks_watch_ad' });
      if (result?.reward_event_type !== 'valued') {
        setAdStatus('Ad was not monetized. No HYPE reward was added.');
        return;
      }
      setAdStatus('Ad verified by Monetag. Waiting for secure reward confirmation…');
      for (let i = 0; i < 12; i++) {
        await new Promise((resolve) => setTimeout(resolve, 2500));
        const status = await api('/api/ads/status/' + encodeURIComponent(session.ymid));
        if (status.status === 'credited') {
          setAdStatus('Reward credited: +' + formatNum(status.reward, 18) + ' HYPE');
          showToast('+' + formatNum(status.reward, 18) + ' HYPE ad reward');
          await loadUser();
          return;
        }
      }
      setAdStatus('Monetag confirmed the ad; reward is pending server postback. Check balance shortly.');
    } catch (e) {
      setAdStatus(e?.message || 'Ad could not be shown. Please try again.');
    } finally { await loadAdUsage(); setAdBusy(false); }
  };

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
    const taskType = String(task.type || '').toLowerCase();
    const isYouTube = taskType === 'youtube' || /youtube\.com|youtu\.be/i.test(task.link);
    const isManualLink = taskType === 'link';
    setTaskVerification((s) => ({ ...s, [taskId]: (isYouTube || isManualLink) ? 'waiting_return' : 'waiting' }));
    try {
      if (window.Telegram?.WebApp?.openTelegramLink && /t\.me\//i.test(task.link)) {
        window.Telegram.WebApp.openTelegramLink(task.link);
      } else if (window.Telegram?.WebApp?.openLink) {
        window.Telegram.WebApp.openLink(task.link);
      } else {
        window.open(task.link, '_blank', 'noopener,noreferrer');
      }
    } catch (_) {}
    if (isYouTube || isManualLink) {
      showToast('Link open hua. Wapas HYPE Tap me aayein; phir 5-second verification timer chalega.');
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
      if (['youtube', 'link'].includes(String(task.type || '').toLowerCase()) && taskVerificationRef.current[task.id] === 'waiting_return') {
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
    // A synchronous window-level lock prevents two taps/remounts from constructing
    // TonConnectUI twice before React state has time to update.
    if (window.__HYPE_TONCONNECT_CONNECTING__) return;
    window.__HYPE_TONCONNECT_CONNECTING__ = true;
    let activeTonUI = tonConnectUIRef.current || window.__HYPE_TONCONNECT_UI__ || null;
    try {
      setWalletConnecting(true);
      if (!activeTonUI && window.__HYPE_TONCONNECT_INIT_PROMISE__) {
        await window.__HYPE_TONCONNECT_INIT_PROMISE__.catch(() => {});
        activeTonUI = tonConnectUIRef.current || window.__HYPE_TONCONNECT_UI__ || null;
      }
      // TonConnectUI registers the global custom element "tc-root".
      // Keep one instance across React remounts to prevent duplicate registration.
      let ui = activeTonUI;
      if (!ui) {
        // Load the official browser bundle outside Vite's module graph.
        // This avoids Solid/Vite interop errors such as "src is not a function".
        if (!window.TON_CONNECT_UI?.TonConnectUI) {
          // Share one loader promise across taps. Never remove/re-execute a bundle
          // that may already have registered the global "tc-root" custom element.
          if (!window.__HYPE_TONCONNECT_LOAD_PROMISE__) {
            window.__HYPE_TONCONNECT_LOAD_PROMISE__ = (async () => {
              // Prefer 2.x UMD builds — 5.x often triggers "src is not a function"
              // inside Telegram WebView / Vite Solid interop.
              const sources = [
                'https://unpkg.com/@tonconnect/ui@2.0.9/dist/tonconnect-ui.min.js',
                'https://cdn.jsdelivr.net/npm/@tonconnect/ui@2.0.9/dist/tonconnect-ui.min.js',
                'https://unpkg.com/@tonconnect/ui@2.2.4/dist/tonconnect-ui.min.js',
                'https://cdn.jsdelivr.net/npm/@tonconnect/ui@2.2.4/dist/tonconnect-ui.min.js',
              ];
              let lastError;
              for (const src of sources) {
                try {
                  // Skip if a previous failed attempt already registered tc-root
                  if (window.customElements?.get('tc-root') && !window.TON_CONNECT_UI?.TonConnectUI) {
                    throw new Error('TON Connect UI was partially initialized. Fully close Telegram and reopen the Mini App.');
                  }
                  await new Promise((resolve, reject) => {
                    // Re-use an existing script tag if present
                    const existing = document.querySelector('script[data-tonconnect-ui="true"]');
                    if (existing && window.TON_CONNECT_UI?.TonConnectUI) {
                      resolve();
                      return;
                    }
                    const script = document.createElement('script');
                    const timeout = setTimeout(() => {
                      script.remove();
                      reject(new Error('TON Connect UI download timed out'));
                    }, 15000);
                    script.src = src;
                    script.async = true;
                    script.dataset.tonconnectUi = 'true';
                    script.onload = () => {
                      clearTimeout(timeout);
                      // Give the UMD bundle a tick to attach globals
                      setTimeout(() => {
                        if (window.TON_CONNECT_UI?.TonConnectUI) resolve();
                        else reject(new Error('TON Connect bundle loaded but its API was not exposed; reload the app before retrying.'));
                      }, 50);
                    };
                    script.onerror = () => {
                      clearTimeout(timeout);
                      script.remove();
                      reject(new Error('TON Connect UI CDN unavailable'));
                    };
                    document.head.appendChild(script);
                  });
                  if (window.TON_CONNECT_UI?.TonConnectUI) return true;
                } catch (error) {
                  lastError = error;
                  // A successfully executed bundle can register tc-root even if
                  // its global export is missing. Never load a second copy then.
                  if (window.customElements?.get('tc-root')) throw error;
                }
              }
              throw new Error(lastError?.message || 'Could not load TON Connect UI. Check your connection and retry.');
            })();
          }
          await window.__HYPE_TONCONNECT_LOAD_PROMISE__;
        }
        const TonConnectUI = window.TON_CONNECT_UI?.TonConnectUI;
        if (typeof TonConnectUI !== 'function') {
          // Clear the broken promise so a full page reload can retry cleanly
          window.__HYPE_TONCONNECT_LOAD_PROMISE__ = null;
          throw new Error('TON Connect UI failed to initialize. Fully close Telegram Mini App and reopen.');
        }
        // If a previous constructor partially registered tc-root then failed,
        // creating another instance cannot recover and would throw the same error.
        if (!window.__HYPE_TONCONNECT_UI__ && window.customElements?.get('tc-root')) {
          throw new Error('TON Connect UI was partially initialized. Fully close Telegram, then open the Mini App again.');
        }
        ui = new TonConnectUI({
          manifestUrl: window.location.origin + '/tonconnect-manifest.json',
          enableAndroidBackHandler: false,
        });
        activeTonUI = ui;
        tonConnectUIRef.current = ui;
        window.__HYPE_TONCONNECT_UI__ = ui;
        ui.setConnectionNetwork('-239');
        ui.onStatusChange(async (wallet) => {
          if (!wallet) {
            setTonWallet(null);
            return;
          }
          const liveTonAddress = String(wallet.account?.address || '');
          if (liveTonAddress) setTonWallet({ address_friendly: liveTonAddress, address_raw: liveTonAddress, verified: false });

          // TonConnect restores an existing session when Telegram returns from
          // Tonkeeper. Restored Wallet objects do not contain connectItems/tonProof;
          // that proof is only supplied during the original connection handshake.
          // Do not disconnect a valid, previously verified wallet on session restore.
          const item = wallet.connectItems?.tonProof;
          if (!item || !('proof' in item)) {
            try {
              const saved = await api('/api/ton-wallet');
              const linked = saved?.wallet;
              const walletAddress = String(wallet.account?.address || '');
              if (linked?.address_raw && linked.address_raw === walletAddress) {
                setTonWallet({
                  address_friendly: linked.address_friendly,
                  address_raw: linked.address_raw,
                  verified: true,
                });
                return;
              }
            } catch (error) {
              console.warn('TON wallet session restore check failed:', error);
            }
            // Keep the session connected; ask for a fresh proof only if it has
            // never been verified by this app. Disconnecting here causes a loop
            // every time Telegram restores the Mini App.
            showToast('TON wallet connected. Ownership verification pending.');
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
            setTonWallet({ address_friendly: result.address, address_raw: result.address_raw, verified: true });
            showToast('TON wallet ownership verified');
          } catch (e) {
            showToast(String(e?.message || 'TON verification failed').slice(0, 100));
            try { await ui.disconnect(); } catch (_) {}
          } finally {
            tonProofVerifyingRef.current = false;
          }
        });
        tonConnectUIRef.current = ui;
        window.__HYPE_TONCONNECT_UI__ = ui;
      } else {
        tonConnectUIRef.current = ui;
      }

      // TON Connect needs an explicit Telegram return URL in Mini Apps.
      // Use the bot's canonical Telegram link (not a referral startapp value),
      // so returning from Tonkeeper does not alter referral attribution.
      const botUsername = String(config?.bot_username || '').replace(/^@/, '').trim();
      if (botUsername) {
        ui.uiOptions = {
          ...(ui.uiOptions || {}),
          actionsConfiguration: {
            ...(ui.uiOptions?.actionsConfiguration || {}),
            twaReturnUrl: `https://t.me/${botUsername}`,
          },
        };
      }

      // Restore any existing TON Connect session without interrupting it.
      // HYPE ownership verification remains separate from basic connection.
      if (ui.connected) {
        const saved = await api('/api/ton-wallet');
        if (saved?.wallet?.address_raw) {
          setTonWallet({
            address_friendly: saved.wallet.address_friendly,
            address_raw: saved.wallet.address_raw,
            verified: true,
          });
          showToast('TON wallet is already connected');
          return;
        }
        // Keep an existing TON Connect session even when it has not been
        // ownership-verified by HYPE. Never disconnect it just to request proof.
        setTonWallet({ address_friendly: ui.account?.address || '', address_raw: ui.account?.address || '', verified: false });
        showToast('TON wallet already connected');
        return;
      }
      // Ask the backend for a one-time TON Connect proof challenge.
      // The wallet signs this challenge inside its own app; HYPE never asks
      // for wallet passwords, seed phrases, or private keys.
      const proofChallenge = await api('/api/ton-proof/payload', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      if (!proofChallenge?.payload) {
        throw new Error(proofChallenge?.error || 'Could not prepare TON wallet verification');
      }
      ui.setConnectRequestParameters({
        state: 'ready',
        value: { tonProof: proofChallenge.payload },
      });
      await ui.openModal();
    } catch (e) {
      // Some mobile wallet deep-link return paths can reject the modal promise
      // after Tonkeeper has already approved and restored the connection.
      // Treat that as success only when the server has verified this exact wallet.
      const ui = activeTonUI || tonConnectUIRef.current || window.__HYPE_TONCONNECT_UI__ || null;
      let recovered = false;
      if (ui?.connected && ui.account?.address) {
        try {
          for (let attempt = 0; attempt < 5 && tonProofVerifyingRef.current; attempt += 1) {
            await new Promise(resolve => setTimeout(resolve, 300));
          }
          const saved = await api('/api/ton-wallet');
          const linked = saved?.wallet;
          const isVerified = Boolean(linked?.address_raw && linked.address_raw === ui.account.address);
          setTonWallet({
            address_friendly: isVerified ? linked.address_friendly : ui.account.address,
            address_raw: ui.account.address,
            verified: isVerified,
          });
          showToast(isVerified ? 'TON wallet connected and verified' : 'TON wallet connected');
          recovered = true;
        } catch (recoveryError) {
          console.warn('TON wallet return recovery check failed:', recoveryError);
        }
      }
      if (!recovered) {
        console.error('TON Connect initialization/connection failed:', e);
        showToast(String(e?.message || 'TON wallet connection failed').slice(0, 100));
      }
    } finally {
      setWalletConnecting(false);
      window.__HYPE_TONCONNECT_CONNECTING__ = false;
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

  const loadSwapDashboard = async () => {
    setDepositOrdersBusy(true);
    try {
      const [deposits, orders] = await Promise.all([api('/api/deposits'), api('/api/deposit-swaps')]);
      if (!deposits.error) setDepositData(deposits);
      if (!orders.error) {
        setDepositOrders(orders.orders || []);
        if (orders.hype_balance != null) setUser((old) => old ? { ...old, balance: Number(orders.hype_balance) || 0 } : old);
      }
    } finally { setDepositOrdersBusy(false); }
  };

  useEffect(() => {
    if (tab === 'wallet') loadDeposits();
    if (tab === 'swap') loadSwapDashboard();
  }, [tab]);

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
      await loadSwapDashboard();
      await loadHistory();
      showToast('Verified: +' + data.amount + ' ' + (data.token || 'USDT'));
    } else {
      showToast(data.error || 'Verification failed');
    }
  };

  const requestWithdraw = async () => {
    if (withdrawBusy) return;
    const amount = Number(wdAmount);
    const minWithdraw = Number(config?.min_withdraw || 2);
    const availableBalance = Number(user?.balance || 0);
    const payoutWallet = connectedWallet || wdWallet || user?.wallet_address || '';
    if (!Number.isFinite(amount) || amount <= 0) {
      showToast('Enter the HYPE amount to withdraw');
      return;
    }
    if (amount < minWithdraw) {
      showToast(`Minimum withdrawal is ${minWithdraw} HYPE`);
      return;
    }
    if (amount > availableBalance) {
      showToast('Withdrawal amount exceeds your HYPE balance');
      return;
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(payoutWallet)) {
      setShowWalletChoices(true);
      showToast('Connect and verify your HyperEVM wallet first');
      return;
    }
    setWithdrawBusy(true);
    try {
      const data = await api('/api/withdraw', {
        method: 'POST',
        body: JSON.stringify({
          user: tg?.initDataUnsafe?.user,
          amount,
          wallet_address: payoutWallet,
        }),
      });
      if (data.success) {
        showToast('Withdrawal request submitted!');
        setWdAmount('');
        if (data.balance != null) setUser((old) => old ? { ...old, balance: Number(data.balance) || 0 } : old);
        await Promise.all([
          loadUser(),
          api('/api/withdrawals').then((d) => setWithdrawals(d.withdrawals || [])),
          loadHistory(),
        ]);
      } else {
        showToast(data.error || 'Withdrawal request failed');
      }
    } catch (error) {
      showToast(error?.message || 'Withdrawal request failed. Please retry.');
    } finally {
      setWithdrawBusy(false);
    }
  };

  const adminAction = async (id, action) => {
    const payload = { action };
    if (action === 'approve') {
      const txHash = window.prompt('Paste the confirmed HyperEVM HYPE payout transaction hash:');
      if (!txHash) return;
      payload.tx_hash = txHash.trim();
    }
    const data = await api(`/api/admin/withdrawals/${id}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (data.success) {
      showToast(action === 'approve' ? 'Payout verified on HyperEVM' : `Marked ${action}`);
      const [stats, wds] = await Promise.all([
        api('/api/admin/stats'),
        api(`/api/admin/withdrawals?status=${adminWdFilter || 'pending'}`),
      ]);
      if (stats && !stats.error) setAdminStats(stats);
      if (wds && !wds.error) setAdminWithdrawals(wds.withdrawals || []);
      await loadHistory();
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
          {(connectedWallet || evmSessionAddress) ? (
            <button className="connect-wallet-btn connected" onClick={disconnectWallet} title={connectedWallet || evmSessionAddress}>
              <Icon name="wallet" size={14} /> {connectedWallet ? shortAddr(connectedWallet) : `Connected · ${shortAddr(evmSessionAddress)}`} 
            </button>
          ) : (
            <button className="connect-wallet-btn" onClick={() => setShowWalletChoices(true)} disabled={walletConnecting}>
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
                    onClick={() => setChartInterval(iv)}                  >
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

          {config?.ads_enabled !== false && (
            <div className="card" style={{ marginBottom: 14, border: '1px solid rgba(0,232,135,.28)' }}>
              <div className="card-title"><Icon name="video" size={17} /> Watch Video & Earn HYPE</div>
              <div style={{ fontSize: '0.82rem', color: '#9bb8a7', marginBottom: 12 }}>
                Earn {formatNum(config?.ad_reward ?? 0.0000007854, 18)} HYPE after a monetized ad is confirmed.
              </div>
              <button className="btn btn-primary" style={{ width: '100%' }} disabled={adBusy || adUsage.ads_remaining <= 0} onClick={watchRewardedAd}>
                {adBusy ? 'Loading video…' : adUsage.ads_remaining <= 0 ? 'Daily ads completed' : <><Icon name="video" size={16} /> Watch Video & Earn</>}
              </button>
              <div style={{ marginTop: 10, textAlign: 'center', fontSize: '0.82rem', fontWeight: 800, color: adUsage.ads_remaining > 0 ? '#00e887' : '#e0bd65', letterSpacing: '.02em' }}>
                {adUsage.ads_remaining}/10 ads left today
              </div>
              <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
                {Array.from({ length: 10 }, (_, i) => (
                  <span key={i} style={{ height: 5, flex: 1, borderRadius: 8, background: i < adUsage.ads_remaining ? 'rgba(0,232,135,.9)' : 'rgba(255,255,255,.14)' }} />
                ))}
              </div>
              {adUsage.ads_remaining <= 0 && (
                <div style={{ marginTop: 8, textAlign: 'center', color: '#b9a77b', fontSize: '0.72rem' }}>
                  Resets in {formatTime(adResetCountdown)}
                </div>
              )}
              {adStatus && <div className="task-verify-note" style={{ marginTop: 8 }}>{adStatus}</div>}
            </div>
          )}
          <h3 className="section-heading"><Icon name="gift" size={18} /> Tasks & Rewards</h3>
          {tasks.length === 0 && <div className="card">No tasks yet. Check back later.</div>}
          {tasks.filter((t) => {
            const taskType = String(t.type || '').toLowerCase();
            // Boost tasks only visible to Telegram Premium users
            if (taskType === 'boost') {
              return Boolean(tg?.initDataUnsafe?.user?.is_premium);
            }
            return true;
          }).map((t) => {
            const status = taskVerification[t.id] || 'not_member';
            const verified = status === 'verified' || pendingTasks.includes(t.id);
            const waiting = status === 'waiting' || status === 'checking';
            const taskLink = String(t.link || '').toLowerCase();
            const taskType = String(t.type || '').toLowerCase();
            const platformIcon =
              taskType === 'youtube' || /youtube\.com|youtu\.be/.test(taskLink)
                ? 'youtube'
                : taskType === 'boost'
                  ? 'telegram'
                  : taskType === 'telegram' || /t\.me\//.test(taskLink)
                    ? 'telegram'
                    : 'globe';
            const actionLabel =
              taskType === 'boost'
                ? (waiting ? `Wait ${taskCountdown[t.id] || ''}s` : status === 'waiting_return' ? 'Return' : 'Boost Channel')
                : (waiting ? `Wait ${taskCountdown[t.id] || ''}s` : status === 'waiting_return' ? 'Return to HYPE Tap' : 'Join');
            return (
              <div className="card task-card" key={t.id}>
                <div className="task-card-content">
                  <div className="task-platform-icon"><Icon name={platformIcon} size={22} /></div>
                  <div className="task-info">
                    <div className="task-title">
                      {t.title}
                      {taskType === 'boost' && (
                        <span style={{ marginLeft: 6, fontSize: 11, color: '#f0d878', fontWeight: 700 }}>★ Premium</span>
                      )}
                    </div>
                    {(taskType === 'youtube' || taskType === 'link') && (
                      <a href={t.link} onClick={(e) => { e.preventDefault(); joinTask(t); }} style={{ display: 'block', fontSize: 11, opacity: 0.78, overflowWrap: 'anywhere', marginTop: 4 }}>
                        {taskType === 'youtube' ? 'YouTube link ↗' : 'Open link ↗'}
                      </a>
                    )}
                    {taskType === 'boost' && (
                      <div style={{ fontSize: 11, opacity: 0.78, marginTop: 4 }}>Boost the channel → claim reward</div>
                    )}
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
                        {actionLabel}
                      </button>
                    )}
                  </div>
                </div>
                {waiting && <div className="task-verify-note">{taskCountdown[t.id] > 0 ? `Wait ${taskCountdown[t.id]}s to claim` : 'Checking task…'}</div>}
                {status === 'waiting_return' && <div className="task-verify-note">Link opened. Return here to start the 5-second claim timer.</div>}
                {taskType === 'boost' && status === 'not_member' && (
                  <div className="task-verify-note">Open the channel, boost it with Telegram Premium, then come back and claim.</div>
                )}
              </div>
            );
          })}
          <div className="card" style={{ marginTop: 14 }}>
            <button className="btn btn-outline" style={{ width: '100%', marginBottom: 8 }} onClick={loadAdUsage}>
              {adUsage.ads_remaining.toLocaleString()} Ads Left
            </button>
            <button className="btn btn-primary" style={{ width: '100%' }} disabled={adHistoryBusy} onClick={loadAdHistory}>
              <Icon name="history" size={16} /> {adHistoryBusy ? 'Loading Ads History…' : 'View Ads Reward History'}
            </button>
            {adHistoryOpen && (
              <div style={{ marginTop: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <strong style={{ color: '#00ff88' }}>Ads Reward History</strong>
                  <button className="btn btn-secondary" onClick={() => setAdHistoryOpen(false)}>Close</button>
                </div>
                {adHistory.length === 0 ? (
                  <div style={{ color: '#999', textAlign: 'center', padding: 14 }}>No ad rewards yet.</div>
                ) : adHistory.map((item) => (
                  <div key={item.ymid} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '10px 0', borderBottom: '1px solid rgba(0,255,136,0.12)' }}>
                    <div>
                      <div style={{ fontWeight: 700 }}>{item.status === 'credited' ? 'Reward credited' : 'Waiting for server confirmation'}</div>
                      <div style={{ fontSize: '0.72rem', color: '#888' }}>{item.credited_at ? new Date(item.credited_at * 1000).toLocaleString() : new Date(item.created_at * 1000).toLocaleString()}</div>
                    </div>
                    <div style={{ color: item.status === 'credited' ? '#00ff88' : '#e0bd65', fontWeight: 800, whiteSpace: 'nowrap' }}>
                      {item.status === 'credited' ? '+' : ''}{formatNum(item.reward || 0, 18)} HYPE
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
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
                copyText(inviteLink).then(() => showToast('Invite link copied')).catch(() => showToast('Copy invite link manually'));
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

      {/* SWAP / DEPOSIT — Mining GRAM style */}
      {tab === 'swap' && (
        <div className="page">
          <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 9, margin: '4px 2px 14px', color: '#f0d878' }}>
            <Icon name="arrow-left-right" size={19} /> HYPE Swap
          </div>
          {/* Top balances — HYPE / TON / USDT */}
          <div className="card" style={{ background: 'linear-gradient(160deg,rgba(0,40,28,0.95),rgba(6,14,12,0.98))', border: '1px solid rgba(0,255,136,0.22)', textAlign: 'center', padding: '22px 16px 18px' }}>
            <div style={{ fontSize: '0.72rem', letterSpacing: 1.5, color: '#8da99a', fontWeight: 700, marginBottom: 6 }}>TOTAL BALANCE</div>
            <div style={{ fontSize: '1.85rem', fontWeight: 900, color: '#fff', lineHeight: 1.1 }}>
              {formatNum(user?.balance || 0, 8)} <span style={{ fontSize: '0.95rem', color: '#00ff88' }}>HYPE</span>
            </div>
            <div style={{ fontSize: '0.72rem', color: '#7a9a88', marginTop: 4 }}>After verified deposit → HYPE swap</div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 14 }}>
            <div className="card" style={{ margin: 0, padding: '14px 10px', textAlign: 'center' }}>
              <img src="/hype-icon.png" alt="HYPE" style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'contain', margin: '0 auto 6px' }} />
              <div style={{ fontSize: '0.65rem', color: '#9aa', fontWeight: 800 }}>HYPE</div>
              <div style={{ fontSize: '0.95rem', fontWeight: 900, color: '#00ff88', marginTop: 3 }}>{formatNum(user?.balance || 0, 6)}</div>
            </div>
            <div className="card" style={{ margin: 0, padding: '14px 10px', textAlign: 'center' }}>
              <div style={{ width: 28, height: 28, margin: '0 auto 6px' }}><Icon name="ton" size={28} /></div>
              <div style={{ fontSize: '0.65rem', color: '#9aa', fontWeight: 800 }}>TON</div>
              <div style={{ fontSize: '0.95rem', fontWeight: 900, color: '#fff', marginTop: 3 }}>{Number(depositData.balances?.ton || 0).toFixed(4)}</div>
            </div>
            <div className="card" style={{ margin: 0, padding: '14px 10px', textAlign: 'center' }}>
              <div style={{ width: 28, height: 28, margin: '0 auto 6px' }}><Icon name="usdt" size={28} /></div>
              <div style={{ fontSize: '0.65rem', color: '#9aa', fontWeight: 800 }}>USDT</div>
              <div style={{ fontSize: '0.95rem', fontWeight: 900, color: '#fff', marginTop: 3 }}>
                {(Number(depositData.balances?.bep20 || 0) + Number(depositData.balances?.trc20 || 0)).toFixed(2)}
              </div>
            </div>
          </div>

          {/* BALANCES list — only 4 supported assets */}
          <div style={{ fontSize: '0.68rem', letterSpacing: 1.2, color: '#7a9a88', fontWeight: 800, margin: '4px 2px 8px' }}>BALANCES</div>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {[
              { key: 'hype', label: 'HYPE', sub: 'After swap · app balance', amount: formatNum(user?.balance || 0, 8), icon: <img src="/hype-icon.png" alt="" style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'contain' }} /> },
              { key: 'ton', label: 'TON', sub: 'Native TON deposit', amount: Number(depositData.balances?.ton || 0).toFixed(6), icon: <Icon name="ton" size={36} /> },
              { key: 'bep20', label: 'USDT BEP20', sub: 'BNB Smart Chain', amount: Number(depositData.balances?.bep20 || 0).toFixed(4), icon: <Icon name="usdt" size={36} /> },
              { key: 'trc20', label: 'USDT TRC20', sub: 'TRON network', amount: Number(depositData.balances?.trc20 || 0).toFixed(4), icon: <Icon name="usdt" size={36} /> },
              { key: 'eth', label: 'Ethereum', sub: 'Native ETH Mainnet', amount: Number(depositData.balances?.eth || 0).toFixed(6), icon: <Icon name="eth" size={36} /> },
            ].map((row, idx, arr) => (
              <div key={row.key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 14px', borderBottom: idx < arr.length - 1 ? '1px solid rgba(0,255,136,0.1)' : 'none' }}>
                <div style={{ flexShrink: 0 }}>{row.icon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: '0.92rem' }}>{row.label}</div>
                  <div style={{ fontSize: '0.7rem', color: '#7a9a88' }}>{row.sub}</div>
                </div>
                <div style={{ textAlign: 'right', fontWeight: 800, fontSize: '0.9rem', color: row.key === 'hype' ? '#00ff88' : '#e8fff0' }}>{row.amount}</div>
              </div>
            ))}
          </div>

          <div className="card" style={{marginTop:12}}>
            <div className="card-title"><Icon name="ton" size={18} /> TON Wallet for Swap / Deposit</div>
            {tonWallet?.address_friendly ? <div className="wc-status"><span className="wc-dot" /> TON {tonWallet.verified ? 'Connected & Verified' : 'Connected'}<div className="wc-addr">{tonWallet.address_friendly}</div></div> :
              <button className="btn btn-secondary" style={{width:'100%'}} onClick={connectTonWallet} disabled={walletConnecting}>
                <Icon name="ton" size={17} /> {walletConnecting ? 'Connecting…' : 'Connect TON Wallet'}
              </button>}
          </div>

          {/* Deposit — only 4 tokens */}
          <div className="card" style={{ marginTop: 14 }}>
            <div className="card-title"><Icon name="coins" size={16} /> Deposit</div>
            <div style={{ fontSize: '0.75rem', color: '#a0ffc0', marginBottom: 12, lineHeight: 1.45 }}>
              Only 4 routes supported: <strong>TON</strong>, <strong>USDT BEP20</strong>, <strong>USDT TRC20</strong>, <strong>Ethereum</strong>.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
              {[
                { id: 'ton', label: 'TON', icon: 'ton' },
                { id: 'bep20', label: 'USDT BEP20', icon: 'usdt' },
                { id: 'trc20', label: 'USDT TRC20', icon: 'usdt' },
                { id: 'eth', label: 'Ethereum', icon: 'eth' },
              ].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setDepositNetwork(t.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '12px 12px',
                    borderRadius: 12, border: depositNetwork === t.id ? '1.5px solid #00ff88' : '1px solid rgba(0,255,136,0.18)',
                    background: depositNetwork === t.id ? 'rgba(0,255,136,0.12)' : 'rgba(0,20,14,0.6)',
                    color: '#fff', cursor: 'pointer',
                  }}
                >
                  <Icon name={t.icon} size={26} />
                  <span style={{ fontWeight: 800, fontSize: '0.82rem' }}>{t.label}</span>
                </button>
              ))}
            </div>

            <div style={{ fontSize: '0.78rem', color: '#a0ffc0', marginBottom: 6 }}>
              {depositNetwork === 'ton' && <>Send native <Icon name="ton" size={16} title="TON" /> only to this address:</>}
              {depositNetwork === 'eth' && <>Send native <Icon name="eth" size={16} title="ETH" /> on Ethereum Mainnet:</>}
              {depositNetwork === 'bep20' && <>Send <Icon name="usdt" size={16} title="USDT" /> on BNB Smart Chain (BEP20):</>}
              {depositNetwork === 'trc20' && <>Send <Icon name="usdt" size={16} title="USDT" /> on TRON (TRC20):</>}
            </div>
            <div style={{ padding: 12, borderRadius: 10, background: 'rgba(0,255,136,0.07)', wordBreak: 'break-all', fontSize: '0.78rem', fontFamily: 'monospace' }}>
              {depositNetwork === 'ton' ? 'UQBtBjwUwBXKsJuRr1UFdba_B1Rh8gXo0uFBzuT9-mVC17yl'
                : depositNetwork === 'bep20' ? '0xaaa40bd792bd26c1e5f6481b25ac1f8d4cf62f4a'
                : depositNetwork === 'trc20' ? 'THcEQMCe1eyfajz7TyFUe8EmW2AQuCc1do'
                : '0x87Ad7Fe8Be9eeEa2E388F80f4C5fcF450E037463'}
            </div>
            <button className="btn btn-secondary" style={{ width: '100%', marginTop: 8 }} onClick={() => {
              const address = depositNetwork === 'ton' ? 'UQBtBjwUwBXKsJuRr1UFdba_B1Rh8gXo0uFBzuT9-mVC17yl'
                : depositNetwork === 'bep20' ? '0xaaa40bd792bd26c1e5f6481b25ac1f8d4cf62f4a'
                : depositNetwork === 'trc20' ? 'THcEQMCe1eyfajz7TyFUe8EmW2AQuCc1do'
                : '0x87Ad7Fe8Be9eeEa2E388F80f4C5fcF450E037463';
              copyText(address).then(() => showToast('Deposit address copied')).catch(() => showToast('Copy address manually'));
            }}>Copy Deposit Address</button>

            <input className="input" style={{ marginTop: 12 }} placeholder="Paste transaction hash" value={depositHash} onChange={(e) => setDepositHash(e.target.value.trim())} />
            <button className="btn btn-primary" style={{ width: '100%' }} onClick={verifyDeposit} disabled={depositBusy}>
              {depositBusy ? 'Checking blockchain…' : 'Verify Deposit'}
            </button>
            <div style={{ marginTop: 12, fontSize: '0.85rem', color: '#a0ffc0' }}>
              Verified: <Icon name={depositNetwork === 'ton' ? 'ton' : depositNetwork === 'bep20' || depositNetwork === 'trc20' ? 'usdt' : 'eth'} size={18} />{' '}
              {Number(depositData.balances?.[depositNetwork] || 0).toFixed(depositNetwork === 'eth' || depositNetwork === 'ton' ? 9 : 6)}{' '}
              {depositNetwork === 'ton' ? 'TON' : depositNetwork === 'bep20' || depositNetwork === 'trc20' ? 'USDT' : 'ETH'}
            </div>
            <div style={{ fontSize: '0.7rem', color: '#888', marginTop: 5, lineHeight: 1.4 }}>
              {depositNetwork === 'ton'
                ? 'TON sender must match your TON Connect verified wallet (Wallet tab).'
                : depositNetwork === 'eth'
                  ? 'Send native ETH on Ethereum Mainnet. Sender must match your verified EVM wallet.'
                  : 'Send USDT only on the selected network. Sender must match your linked wallet.'}
            </div>
          </div>

          {/* Swap status */}
          <div className="card">
            <div className="card-title"><Icon name="activity" size={17} /> Swap Status</div>
            <div style={{ fontSize: '0.74rem', color: '#a0ffc0', marginBottom: 10, lineHeight: 1.45 }}>
              Verified deposits enter the HYPE conversion queue. HYPE is credited after settlement on HyperEVM.
            </div>
            {depositOrdersBusy && <div style={{ fontSize: '0.78rem', color: '#9aa' }}>Refreshing orders…</div>}
            {!depositOrders.length && <div style={{ fontSize: '0.78rem', color: '#8a9b91' }}>No deposit → HYPE orders yet. Verify a deposit to start.</div>}
            {depositOrders.map((order) => (
              <div key={order.id} style={{ padding: '11px 0', borderBottom: '1px solid rgba(0,255,136,0.12)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                  <strong style={{ fontSize: '0.86rem' }}>{order.from_amount} {order.from_asset} → HYPE</strong>
                  <span style={{ fontSize: '0.68rem', fontWeight: 800, color: order.status === 'completed' ? '#00ff88' : order.status === 'failed' ? '#ff7b7b' : '#ffc36b' }}>
                    {String(order.status || 'queued').toUpperCase()}
                  </span>
                </div>
                <div style={{ fontSize: '0.7rem', color: '#8a9b91', marginTop: 4 }}>
                  {order.from_network} · {order.created_at ? new Date(Number(order.created_at) * 1000).toLocaleString() : ''}
                </div>
                {order.received_hype_amount && (
                  <div style={{ fontSize: '0.75rem', color: '#00ff88', marginTop: 4 }}>Received: {order.received_hype_amount} HYPE</div>
                )}
              </div>
            ))}
            <button className="btn btn-secondary" style={{ width: '100%', marginTop: 10 }} onClick={loadSwapDashboard} disabled={depositOrdersBusy}>
              Refresh balances & status
            </button>
          </div>
        </div>
      )}

      {/* WALLET / WITHDRAW */}
      {tab === 'wallet' && (
        <div className="page">
          <div className="card">
            <div className="card-title"><Icon name="wallet" size={16} /> Wallet</div>
            {(connectedWallet || evmSessionAddress) ? (
              <div className="wallet-connected-box">
                <div className="wc-status"><span className="wc-dot" /> EVM Wallet {connectedWallet ? 'Connected & Verified' : 'Connected'}</div>
                <div className="wc-addr">{connectedWallet || evmSessionAddress}</div>
                <button className="btn btn-secondary" style={{width:'100%',marginTop:10}} onClick={disconnectWallet}>Disconnect</button>
              </div>
            ) : (
              <div className="wallet-connect-box">
                <p style={{color:'#a0ffc0',fontSize:'0.85rem',marginBottom:12}}>Connect MetaMask, Trust Wallet, Telegram-compatible EVM wallets or another WalletConnect wallet.</p>
                <button className="btn btn-primary" style={{width:'100%'}} onClick={() => setShowWalletChoices(true)} disabled={walletConnecting}>
                  <Icon name="wallet" size={16} /> {walletConnecting ? 'Connecting…' : 'Connect External Wallet'}
                </button>
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-title"><img src="/hype-icon.png" alt="HYPE" style={{width:26,height:26,objectFit:'contain',borderRadius:'50%'}} /> Withdraw</div>
            <div style={{ marginBottom: 10, fontSize: '0.9rem' }}>
              <img src="/hype-icon.png" alt="HYPE" style={{width:24,height:24,objectFit:'contain',borderRadius:'50%',verticalAlign:'middle'}} /> <strong style={{ color: '#00ff88' }}>{formatNum(user?.balance, 10)}</strong>
            </div>
            <div style={{ marginBottom: 10, fontSize: '0.85rem', color: '#ffaa00' }}>
              Minimum withdraw is {config?.min_withdraw || 2} HYPE
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
            {Number(user?.balance || 0) >= Number(config?.min_withdraw || 2) && (
              <button
                className="btn btn-primary"
                type="button"
                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                disabled={withdrawBusy || walletConnecting}
                onClick={() => {
                  const payoutWallet = connectedWallet || wdWallet || user?.wallet_address || '';
                  if (!/^0x[a-fA-F0-9]{40}$/.test(payoutWallet)) {
                    setShowWalletChoices(true);
                    return;
                  }
                  if (!wdAmount.trim()) {
                    setWdAmount(formatNum(user?.balance, 10));
                    showToast('Your full HYPE balance is selected. Tap Withdraw HYPE again to submit.');
                    return;
                  }
                  requestWithdraw();
                }}
              >
                <img src="/hype-coin.svg" alt="" aria-hidden="true" style={{ width: 22, height: 22, display: 'block', flex: '0 0 22px', objectFit: 'contain', background: 'transparent' }} />
                {withdrawBusy ? 'Submitting…' : 'Withdraw HYPE'}
              </button>
            )}}
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
                      {assetIcon === 'hype' ? <img src="/hype-icon.png" alt="HYPE" style={{width:24,height:24,objectFit:'contain',borderRadius:'50%'}} /> : <Icon name={assetIcon} size={22} title={item.asset} />}
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
            {['stats', 'activity', 'settings', 'users', 'referrals', 'deposits', 'withdrawals', 'tasks', 'broadcast', 'assistant'].map((t) => (
              <button
                key={t}
                className={`admin-tab ${adminTab === t ? 'active' : ''}`}
                onClick={() => setAdminTab(t)}
              >
                {t}
              </button>
            ))}
          </div>

          {adminTab === 'deposits' && (
            <div className="card">
              <div className="card-title">Deposit → HYPE Settlement</div>
              <div style={{fontSize:'0.75rem',color:'#ffaa00',marginBottom:10}}>
                Approve the source deposit, complete the conversion externally, send the received native HYPE to the configured treasury wallet, then verify its HyperEVM transaction here. Balance is credited only after on-chain confirmation.
              </div>
              {adminDepositSwaps.length === 0 && <div>No queued or processing deposits.</div>}
              {adminDepositSwaps.map((o) => (
                <div key={o.id} style={{padding:'10px 0',borderBottom:'1px solid rgba(0,255,136,0.12)'}}>
                  <div><strong>@{o.username || o.user_id}</strong> · {o.from_amount} {o.from_asset}</div>
                  <div style={{fontSize:'0.72rem',color:'#9aa',margin:'4px 0'}}>Network: {o.from_network} · Status: {o.status}</div>
                  <div style={{fontSize:'0.68rem',overflowWrap:'anywhere'}}>Deposit TX: {o.source_tx_hash}</div>
                  {o.status === 'queued' ? (
                    <div style={{display:'flex',gap:8,marginTop:8}}>
                      <button className="btn btn-primary" onClick={async () => {
                        const d = await api('/api/admin/deposit-swaps/' + o.id, {method:'POST',body:JSON.stringify({action:'approve'})});
                        if (d.success) { showToast('Approved. Complete conversion and settle with the HYPE receipt.'); await loadAdmin(); }
                        else showToast(d.error || 'Approval failed');
                      }}>Approve for conversion</button>
                      <button className="btn btn-danger" onClick={async () => {
                        const d = await api('/api/admin/deposit-swaps/' + o.id, {method:'POST',body:JSON.stringify({action:'reject'})});
                        if (d.success) { showToast('Rejected. Source deposit requires manual refund.'); await loadAdmin(); }
                        else showToast(d.error || 'Reject failed');
                      }}>Reject</button>
                    </div>
                  ) : (
                    <div style={{display:'flex',gap:8,marginTop:8,flexWrap:'wrap'}}>
                      <button className="btn btn-primary" onClick={async () => {
                        const hypeAmount = window.prompt('Enter HYPE amount to credit to the user (max 18 decimals):');
                        if (!hypeAmount) return;
                        const txHash = window.prompt('Paste the confirmed incoming native HYPE transfer hash to the treasury:');
                        if (!txHash) return;
                        const d = await api('/api/admin/deposit-swaps/' + o.id, {method:'POST',body:JSON.stringify({action:'complete',hype_amount:hypeAmount.trim(),tx_hash:txHash.trim()})});
                        if (d.success) { showToast('HYPE received and user balance credited'); await loadAdmin(); await loadUser(); await loadHistory(); }
                        else showToast(d.error || 'Settlement failed');
                      }}>Verify HYPE receipt & credit</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

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
              <div style={{ border: '1px solid rgba(0,255,136,.28)', borderRadius: 12, padding: 12, marginBottom: 16 }}>
                <div className="card-title"><Icon name="gift" size={16} /> Monetag Rewarded Ads</div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: '0.85rem', margin: '10px 0' }}>
                  <input type="checkbox" checked={Boolean(settingsForm.ads_enabled)} onChange={(e) => setSettingsForm({ ...settingsForm, ads_enabled: e.target.checked })} />
                  Enable Watch Ad & Earn
                </label>
                <label style={{ fontSize: '0.8rem', color: '#a0ffc0' }}>Reward per valued ad (HYPE)</label>
                <input className="input" type="number" min="0" step="any" value={settingsForm.ad_reward}
                  onChange={(e) => setSettingsForm({ ...settingsForm, ad_reward: e.target.value })}
                  placeholder="0.0000007854" />
                <div style={{ fontSize: '0.72rem', color: '#888', marginTop: 5 }}>Changes apply to new ad sessions. Only Monetag's verified valued postback credits the balance.</div>
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
                  </div>                  <button className="btn btn-outline" style={{ padding: '6px 10px', fontSize: '0.75rem' }}
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
                  {w.tx_hash && <div style={{fontSize:'0.68rem',overflowWrap:'anywhere',marginBottom:8}}>Payout TX: {w.tx_hash}</div>}
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
                  <option value="link">External Link Visit</option>
                  <option value="boost">Boost Channel (Premium only)</option>
                </select>
                <input className="input" placeholder="Link" value={newTask.link} onChange={(e) => setNewTask({ ...newTask, link: e.target.value })} />
                <div className="muted" style={{ fontSize: 12 }}>
                  {newTask.type === 'telegram' && 'Public t.me channel link required. Add the bot as a channel admin for automatic membership verification.'}
                  {newTask.type === 'youtube' && 'YouTube link opens for the user; they return to HYPE Tap and wait 5 seconds before claiming.'}
                  {newTask.type === 'link' && 'Any valid HTTPS link. User opens it, returns to HYPE Tap, and waits 5 seconds before claiming.'}
                  {newTask.type === 'boost' && 'Public t.me channel link. Only Telegram Premium users see this task. Bot must be admin. Reward is credited after boost is verified via getUserChatBoosts. Recommended reward: 0.12 HYPE.'}
                </div>

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


          {adminTab === 'assistant' && (
            <div className="card" style={{ padding: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <div style={{ width: 42, height: 42, borderRadius: 14, display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg, rgba(0,255,136,.2), rgba(240,216,120,.18))', border: '1px solid rgba(0,255,136,.35)', fontSize: 23 }}>🤖</div>
                <div style={{ flex: 1 }}>
                  <div style={{ color: '#f0d878', fontWeight: 800 }}>HYPE AI Assistant</div>
                  <div style={{ color: '#7ee8ad', fontSize: 11 }}>Admin-only · App diagnostics enabled</div>
                </div>
                <button className="btn" style={{ padding: '6px 9px', fontSize: 11 }} onClick={() => setAssistantMessages([])}>New chat</button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 12 }}>
                {[
                  'Check my app status and explain any problems.',
                  'Audit the HYPE app for bugs and security risks.',
                  'Suggest improvements to rewards, tasks and withdrawals.',
                ].map((prompt) => (
                  <button key={prompt} className="btn" disabled={assistantBusy} style={{ padding: '7px 9px', fontSize: 11, borderRadius: 12, whiteSpace: 'normal', textAlign: 'left' }} onClick={() => sendHypeAssistant(prompt)}>{prompt}</button>
                ))}
              </div>
              <div ref={assistantScrollRef} style={{ minHeight: 210, maxHeight: 430, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, padding: 10, borderRadius: 12, background: 'rgba(0,0,0,.28)', border: '1px solid rgba(0,255,136,.12)' }}>
                {assistantMessages.length === 0 && (
                  <div style={{ color: '#9aa', textAlign: 'center', margin: 'auto', padding: '22px 12px', fontSize: 13, lineHeight: 1.6 }}>
                    <div style={{ fontSize: 28, marginBottom: 8 }}>✦</div>
                    <strong style={{ color: '#e9f7ed' }}>Namaste! Main HYPE AI hoon.</strong>
                    <div>App ke bugs, admin settings, rewards, deposits, withdrawals aur naye features ke baare mein mujhse poochho.</div>
                    <div style={{ color: '#d5b95e', marginTop: 8 }}>Main live app diagnostics dekh sakta hoon aur code fixes taiyar kar sakta hoon.</div>
                  </div>
                )}
                {assistantMessages.map((message, index) => (
                  <div key={index} style={{ alignSelf: message.role === 'user' ? 'flex-end' : 'stretch', maxWidth: message.role === 'user' ? '88%' : '100%', padding: '10px 12px', borderRadius: 12, background: message.role === 'user' ? 'rgba(0,160,95,.22)' : 'rgba(255,255,255,.055)', border: '1px solid ' + (message.role === 'user' ? 'rgba(0,255,136,.24)' : 'rgba(255,255,255,.08)'), color: '#e8eee9', fontSize: 13, lineHeight: 1.55, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                    <div style={{ color: message.role === 'user' ? '#8dffc2' : '#f0d878', fontSize: 10, fontWeight: 800, marginBottom: 5 }}>{message.role === 'user' ? 'YOU' : 'HYPE AI'}</div>
                    {message.content}
                  </div>
                ))}
                {assistantBusy && <div style={{ color: '#8dffc2', fontSize: 12 }}>HYPE AI is thinking…</div>}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'flex-end' }}>
                <textarea
                  className="input"
                  rows={2}
                  value={assistantInput}
                  onChange={(e) => setAssistantInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendHypeAssistant(); } }}
                  placeholder="Ask HYPE AI to diagnose or improve your app…"
                  style={{ flex: 1, resize: 'vertical', minHeight: 48, margin: 0 }}
                  disabled={assistantBusy}
                />
                <button className="btn btn-primary" disabled={assistantBusy || !assistantInput.trim()} onClick={() => sendHypeAssistant()} style={{ minWidth: 66, minHeight: 46 }}>
                  {assistantBusy ? '…' : 'Send'}
                </button>
              </div>
              <div style={{ color: '#778', fontSize: 10, marginTop: 8, lineHeight: 1.45 }}>
                Secure admin verification uses your Telegram session. Never send passwords, seed phrases, private keys or API secrets here. AI suggestions do not deploy code automatically.
              </div>
            </div>
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

      {showWalletChoices && !(connectedWallet || evmSessionAddress) && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Choose wallet connection"
          onClick={(e) => { if (e.target === e.currentTarget) setShowWalletChoices(false); }}
          style={{
            position: 'fixed', inset: 0, zIndex: 100000,
            background: 'rgba(0,0,0,.78)', display: 'flex',
            alignItems: 'center', justifyContent: 'center', padding: 20
          }}
        >
          <div style={{
            width: '100%', maxWidth: 360, padding: 20, borderRadius: 18,
            background: '#111711', border: '1px solid rgba(0,255,136,.35)',
            boxShadow: '0 18px 60px rgba(0,0,0,.65)'
          }}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
              <strong style={{color:'#eafff1',fontSize:17}}>Connect Wallet</strong>
              <button type="button" className="btn btn-outline" onClick={() => setShowWalletChoices(false)} style={{padding:'4px 10px'}}>✕</button>
            </div>
            <p style={{color:'#9bb6a5',fontSize:12,margin:'0 0 16px'}}>Choose how you want to connect to HyperEVM.</p>
            <button
              type="button"
              className="btn btn-primary"
              style={{width:'100%',marginBottom:10}}
              disabled={walletConnecting}
              onClick={() => { setShowWalletChoices(false); connectExternalWallet(); }}
            >
              <Icon name="wallet" size={16} /> Trust Wallet
            </button>
            <button
              type="button"
              className="btn btn-outline"
              style={{width:'100%'}}
              disabled={walletConnecting}
              onClick={connectAllWallets}
            >
              <Icon name="wallet" size={16} /> All Wallets
            </button>
            <div style={{color:'#718779',fontSize:11,lineHeight:1.45,marginTop:12}}>
              All Wallets opens the WalletConnect wallet list, including compatible MetaMask, Binance and OKX wallets.
            </div>
          </div>
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
        <button className={`nav-item ${tab === 'swap' ? 'active' : ''}`} onClick={() => setTab('swap')}>
          <span className="nav-icon-wrap"><Icon name="arrow-left-right" size={22} /></span>
          <span className="nav-label">Swap</span>
        </button>
        <button className={`nav-item ${tab === 'wallet' ? 'active' : ''}`} onClick={() => setTab('wallet')}>
          <span className="nav-icon-wrap"><Icon name="wallet" size={22} /></span>
          <span className="nav-label">Wallet</span>
        </button>
      </div>
    </div>
  );
}