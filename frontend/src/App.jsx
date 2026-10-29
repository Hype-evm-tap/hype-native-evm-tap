import React, { useState, useEffect, useCallback, useRef } from 'react';

const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
  tg.setHeaderColor('#020a06');
  tg.setBackgroundColor('#020a06');
}

const API = ''; // same origin when deployed on CF

function formatHYPE(value) {
  if (value === undefined || value === null || isNaN(Number(value))) return '0';
  const n = Number(value);
  // Always use fixed decimals then trim trailing zeros (no scientific notation)
  return n.toFixed(12).replace(/0+$/, '').replace(/\.$/, '') || '0';
}

// Alias for compatibility
function formatNum(n, dec = 6) {
  return formatHYPE(n);
}

function formatTime(sec) {
  if (sec <= 0) return '00:00';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function App() {
  const [tab, setTab] = useState('tap');
  const [user, setUser] = useState(null);
  const [config, setConfig] = useState(null);
  const [price, setPrice] = useState(0);
  const [priceChange24h, setPriceChange24h] = useState(0);
  const [candles, setCandles] = useState([]); // close prices for sparkline
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
  const tappingLock = useRef(false); // prevent concurrent API calls
  const lastTapTs = useRef(0);

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
      // Get start_param from multiple places (Telegram can put it in different fields)
      let startParam = tg?.initDataUnsafe?.start_param || null;
      if (!startParam && tg?.initData) {
        try {
          const params = new URLSearchParams(tg.initData);
          startParam = params.get('start_param') || null;
        } catch {}
      }
      // Also check URL query (some clients)
      if (!startParam) {
        try {
          const urlP = new URLSearchParams(window.location.search);
          startParam = urlP.get('start') || urlP.get('startapp') || null;
        } catch {}
      }
      const tgUser = tg?.initDataUnsafe?.user || { id: 0, first_name: 'Guest' };
      const data = await api('/api/user', {
        method: 'POST',
        body: JSON.stringify({ user: tgUser, start_param: startParam }),
      });
      if (data.user) {
        setUser(data.user);
        setEnergyLeft(data.user.energy);
        setResetAt(data.user.energy_reset_at || 0);
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

  // Fetch live HYPE price + 24h chart candles from Hyperliquid native
  const fetchHypeMarket = useCallback(async () => {
    try {
      // Live mid price
      const midRes = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'allMids' }),
      });
      const mids = await midRes.json();
      const live = parseFloat(mids['HYPE'] || 0) || 0;
      if (live > 0) setPrice(live);

      // 1h candles for last ~48h (enough for nice chart + 24h change)
      const end = Date.now();
      const start = end - 48 * 60 * 60 * 1000;
      const candleRes = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'candleSnapshot',
          req: { coin: 'HYPE', interval: '1h', startTime: start, endTime: end },
        }),
      });
      const raw = await candleRes.json();
      if (Array.isArray(raw) && raw.length > 0) {
        const closes = raw.map((c) => parseFloat(c.c));
        setCandles(closes);
        // 24h change ≈ last close vs close 24 candles ago
        const last = closes[closes.length - 1];
        const prev24 = closes.length >= 25 ? closes[closes.length - 25] : closes[0];
        if (prev24 > 0) {
          setPriceChange24h(((last - prev24) / prev24) * 100);
        }
      }
    } catch (e) {
      console.error('HYPE market fetch failed', e);
    }
  }, []);

  useEffect(() => {
    loadUser();
    fetchHypeMarket();
    const iv = setInterval(fetchHypeMarket, 30000); // refresh every 30s
    return () => clearInterval(iv);
  }, [loadUser, fetchHypeMarket]);

  // Energy countdown
  useEffect(() => {
    if (energyLeft > 0 || !resetAt) {
      setWaitSec(0);
      return;
    }
    const tick = () => {
      const left = Math.max(0, resetAt - Math.floor(Date.now() / 1000));
      setWaitSec(left);
      if (left <= 0) {
        setEnergyLeft(config?.energy_max || 1000);
        setResetAt(0);
      }
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [energyLeft, resetAt, config]);

  // Daily check-in countdown (24h gap from last_checkin_at)
  useEffect(() => {
    if (canCheckin) {
      setCheckinWait(0);
      return;
    }
    const last = user?.last_checkin_at || 0;
    if (!last) return;
    const tick = () => {
      const now = Math.floor(Date.now() / 1000);
      const nextReset = last + 86400;
      const left = Math.max(0, nextReset - now);
      setCheckinWait(left);
      if (left <= 0) setCanCheckin(true);
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [canCheckin, user?.last_checkin_at]);

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
      showToast(`Daily Check-in +${formatHYPE(data.reward)} HYPE`);
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

  // Reliable single/batch tap – no double-fire, energy only decreases
  const doTap = () => {
    const nowMs = Date.now();
    // Ignore accidental double-fire from touch + click (within 80ms)
    if (nowMs - lastTapTs.current < 80) return;
    lastTapTs.current = nowMs;

    if (energyLeft <= 0) {
      showToast(`Energy empty • wait ${formatTime(waitSec)}`);
      return;
    }

    // Optimistic UI: decrease energy immediately (can go to 0)
    setTapAnim((a) => a + 1);
    setEnergyLeft((prev) => {
      const next = Math.max(0, prev - 1);
      // If this tap empties energy, start the 1-hour timer optimistically
      if (next === 0 && !resetAt) {
        const cooldown = config?.energy_cooldown || 3600;
        setResetAt(Math.floor(Date.now() / 1000) + cooldown);
      }
      return next;
    });

    tapQueue.current += 1;

    // Debounce batch send (allow fast tapping, send together)
    if (tapTimer.current) clearTimeout(tapTimer.current);
    tapTimer.current = setTimeout(async () => {
      if (tappingLock.current) return; // previous request still in flight
      const taps = tapQueue.current;
      if (taps <= 0) return;
      tapQueue.current = 0;
      tappingLock.current = true;

      try {
        const data = await api('/api/tap', {
          method: 'POST',
          body: JSON.stringify({ user: tg?.initDataUnsafe?.user, taps }),
        });
        if (data.success) {
          // Always trust server values
          setUser((u) => ({
            ...u,
            balance: data.balance,
            energy: data.energy,
            energy_reset_at: data.energy_reset_at,
            total_earned: (u?.total_earned || 0) + (data.earned || 0),
          }));
          setEnergyLeft(data.energy);
          setResetAt(data.energy_reset_at || 0);
          if (data.earned > 0) {
            tg?.HapticFeedback?.impactOccurred?.('light');
          }
        } else if (data.error) {
          showToast(data.error);
          // Sync back to server truth
          if (typeof data.energy === 'number') setEnergyLeft(data.energy);
          if (data.energy_reset_at) setResetAt(data.energy_reset_at);
        }
      } catch {
        showToast('Tap failed');
        // On network error, re-sync energy from last known user state
        if (user?.energy != null) setEnergyLeft(user.energy);
      } finally {
        tappingLock.current = false;
        // If more taps were queued while request was in flight, flush them immediately
        if (tapQueue.current > 0) {
          const pending = tapQueue.current;
          tapQueue.current = 0;
          // Re-run the batch send without optimistic decrease (already done)
          (async () => {
            if (tappingLock.current) return;
            tappingLock.current = true;
            try {
              const data = await api('/api/tap', {
                method: 'POST',
                body: JSON.stringify({ user: tg?.initDataUnsafe?.user, taps: pending }),
              });
              if (data.success) {
                setUser((u) => ({
                  ...u,
                  balance: data.balance,
                  energy: data.energy,
                  energy_reset_at: data.energy_reset_at,
                  total_earned: (u?.total_earned || 0) + (data.earned || 0),
                }));
                setEnergyLeft(data.energy);
                setResetAt(data.energy_reset_at || 0);
              } else if (data.error) {
                if (typeof data.energy === 'number') setEnergyLeft(data.energy);
                if (data.energy_reset_at) setResetAt(data.energy_reset_at);
              }
            } catch {} finally {
              tappingLock.current = false;
            }
          })();
        }
      }
    }, 150);
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
      api('/api/referrals').then((d) => setReferrals(d.referrals || []));
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
        tap_reward: formatHYPE(data.tap_reward ?? 0),
        referral_reward: formatHYPE(data.referral_reward ?? 0),
        min_withdraw: formatHYPE(data.min_withdraw ?? 0),
        energy_max: String(data.energy_max ?? ''),
        energy_cooldown: String(data.energy_cooldown ?? ''),
        daily_checkin_reward: formatHYPE(data.daily_checkin_reward ?? 0),
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
        balance: formatHYPE(data.user.balance ?? 0),
        total_earned: formatHYPE(data.user.total_earned ?? 0),
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
      showToast(`+${formatHYPE(data.reward)} HYPE`);
      setCompletedTasks((c) => [...c, taskId]);
      loadUser();
    } else {
      showToast(data.error || 'Failed');
    }
  };

  const requestWithdraw = async () => {
    const amount = parseFloat(wdAmount);
    if (!amount || amount < (config?.min_withdraw || 1)) {
      showToast(`Min ${formatHYPE(config?.min_withdraw || 1)} HYPE`);
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

  const inviteLink = (config?.bot_username && user?.id)
    ? `https://t.me/${config.bot_username}?start=${user.id}`
    : (user?.id ? `https://t.me/share/url?url=&text=Join%20with%20ref%20${user.id}` : '');

  if (loading) {
    return (
      <div className="app loading-screen">
        <div className="loading-content">
          <div className="loading-logo-wrap">
            <img src="/hype-logo.png" alt="HYPE" className="loading-logo" />
          </div>
          <h2 className="loading-title">Hype Token</h2>
          <p className="loading-sub">Quick security check. If a box appears below, tick it to continue.</p>
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
            <span className="crown">👑</span> Hype Token
          </div>
          <div className="header-badges">
            <span className="badge gold-lvl">👑 Lvl 1</span>
            <span className="badge online">⚡ ONLINE</span>
          </div>
          {price > 0 && (
            <div className="lvl-progress">
              ≈ ${(Number(user?.balance || 0) * price).toFixed(4)}$ left to Lvl UP →
            </div>
          )}
        </div>
        <div className="header-right">
          <button className="connect-wallet-btn" onClick={() => setTab('wallet')}>
            💎 Connect Wallet
          </button>
          <div className="uid-badge">
            📁 UID {user?.id || '—'}
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
              📈 +{formatNum(user?.total_earned, 6)} HYPE
            </div>
          </div>

          {/* Live HYPE Price + Chart from Hyperliquid Native */}
          <div className="price-card">
            <div className="price-card-header">
              <div className="price-left">
                <img src="/hype-logo.png" alt="HYPE" className="price-logo" />
                <div>
                  <div className="price-symbol">HYPE / USD</div>
                  <div className="price-source">Hyperliquid Native</div>
                </div>
              </div>
              <div className={`price-change ${priceChange24h >= 0 ? 'up' : 'down'}`}>
                {priceChange24h >= 0 ? '▲' : '▼'} {Math.abs(priceChange24h).toFixed(2)}%
              </div>
            </div>
            <div className="price-value">
              ${price > 0 ? price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : '—'}
            </div>
            {candles.length > 2 && (
              <div className="sparkline-wrap">
                <svg viewBox="0 0 300 60" preserveAspectRatio="none" className="sparkline">
                  {(() => {
                    const min = Math.min(...candles);
                    const max = Math.max(...candles);
                    const range = max - min || 1;
                    const points = candles.map((p, i) => {
                      const x = (i / (candles.length - 1)) * 300;
                      const y = 55 - ((p - min) / range) * 50;
                      return `${x},${y}`;
                    }).join(' ');
                    const isUp = priceChange24h >= 0;
                    const stroke = isUp ? '#00ff88' : '#ff5566';
                    const fill = isUp ? 'rgba(0,255,136,0.15)' : 'rgba(255,85,102,0.12)';
                    // Area path
                    const area = `M0,60 L${points} L300,60 Z`;
                    return (
                      <>
                        <path d={area} fill={fill} />
                        <polyline
                          fill="none"
                          stroke={stroke}
                          strokeWidth="2.2"
                          strokeLinejoin="round"
                          strokeLinecap="round"
                          points={points}
                        />
                      </>
                    );
                  })()}
                </svg>
              </div>
            )}
            <div className="price-footer">
              Live • updates every 30s • Hyperliquid
            </div>
          </div>

          <div className="tap-area">
            <div
              className="hype-logo"
              onPointerDown={(e) => {
                // Single unified handler – works for mouse + touch, no double fire
                e.preventDefault();
                doTap();
              }}
              key={tapAnim}
            >
              <img src="/hype-logo.png" alt="HYPE Logo" className="logo-img" />
            </div>
            <div className="tap-hint">
              {energyLeft > 0
                ? `Tap to Mine • 1 Tap = ${formatHYPE(config?.tap_reward || 0.0000000695)} HYPE`
                : `Energy empty • Recharge in ${formatTime(waitSec)}`}
            </div>
          </div>

          <div className="energy-wrap">
            <div className="energy-bar">
              <div
                className="energy-fill"
                style={{
                  width: `${(energyLeft / (config?.energy_max || 1000)) * 100}%`,
                }}
              />
            </div>
            <div className="energy-text">
              <span>⚡ {energyLeft}/{config?.energy_max || 1000}</span>
              {waitSec > 0 && <span className="timer">⏳ {formatTime(waitSec)}</span>}
            </div>
          </div>

          {/* Big 1-hour wait banner when energy is empty */}
          {energyLeft <= 0 && waitSec > 0 && (
            <div className="claim-btn claim-disabled" style={{ marginTop: 12, cursor: 'default' }}>
              ⏳ NEXT ENERGY IN {formatTime(waitSec)}
            </div>
          )}

          <button
            className={`claim-btn ${!canCheckin ? 'claim-disabled' : ''}`}
            onClick={doCheckin}
            disabled={!canCheckin}
          >
            {canCheckin
              ? `📅 DAILY CHECK-IN  +${formatHYPE(config?.daily_checkin_reward ?? 0.0000005678)}`
              : `⏳ Next in ${formatTime(checkinWait)}`}
          </button>
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
                      +{formatHYPE(t.reward)} HYPE
                    </div>
                  </div>
                  {done ? (
                    <span style={{ color: '#00ff88' }}>✓ Done</span>
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
              +{formatHYPE(config?.referral_reward || 0.00008526)} HYPE per invite
            </div>
          </div>

          <div className="card">
            <div className="card-title">Your Invites ({user?.invite_count || 0})</div>
            {referrals.length === 0 && (
              <div style={{ color: '#888', fontSize: '0.9rem' }}>
                No referrals yet. Share your link above!
              </div>
            )}
            {referrals.map((r) => (
              <div key={r.id || r.referred_id} style={{ padding: '8px 0', borderBottom: '1px solid rgba(0,255,136,0.1)', display: 'flex', justifyContent: 'space-between' }}>
                <span>@{r.username || r.first_name || r.referred_id || 'User'}</span>
                <span style={{ color: '#00ff88' }}>+{formatHYPE(r.reward)} HYPE</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* LEADERBOARD */}
      {tab === 'leaderboard' && (
        <div className="page">
          <h3 style={{ marginBottom: 12, color: '#00ff88' }}>🏆 Top 100 Players</h3>
          {leaderboard.map((p, i) => (
            <div
              key={p.id}
              className={`lb-item ${i === 0 ? 'top1' : i === 1 ? 'top2' : i === 2 ? 'top3' : ''}`}
            >
              <div className="lb-rank">{i + 1}</div>
              <div className="lb-name">
                {i < 3 && <span style={{ marginRight: 4 }}>{['🥇', '🥈', '🥉'][i]}</span>}
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
            <div className="card-title">💰 Withdraw HYPE</div>
            <div style={{ marginBottom: 10, fontSize: '0.9rem' }}>
              Balance: <strong style={{ color: '#00ff88' }}>{formatNum(user?.balance)} HYPE</strong>
            </div>
            <div style={{ marginBottom: 10, fontSize: '0.85rem', color: '#ffaa00' }}>
              Minimum withdraw is {config?.min_withdraw || 1} HYPE
            </div>
            <div style={{ marginBottom: 12, fontSize: '0.85rem', color: '#00ff88' }}>
              🚫 We don’t charge any fees
            </div>
            <input
              className="input"
              placeholder="Amount (HYPE)"
              type="text"
              inputMode="decimal"
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
                  <span>{formatHYPE(w.amount)} HYPE</span>
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
          <h3 style={{ color: '#f0d878', marginBottom: 12 }}>⚙️ Admin Panel</h3>
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
              <div className="card-title">⚙️ Live App Controls</div>
              <div style={{ fontSize: '0.78rem', color: '#888', marginBottom: 12 }}>
                Yahan change karoge → turant pure app par apply hoga (naye taps / naye referrals par)
              </div>

              <label style={{ fontSize: '0.8rem', color: '#a0ffc0' }}>🔥 Per Tap Points (HYPE)</label>
              <input className="input" type="text" inputMode="decimal" value={settingsForm.tap_reward}
                onChange={(e) => setSettingsForm({ ...settingsForm, tap_reward: e.target.value })}
                placeholder="e.g. 0.0000000695" />

              <label style={{ fontSize: '0.8rem', color: '#a0ffc0' }}>👥 Per Referral Points (HYPE)</label>
              <input className="input" type="text" inputMode="decimal" value={settingsForm.referral_reward}
                onChange={(e) => setSettingsForm({ ...settingsForm, referral_reward: e.target.value })}
                placeholder="e.g. 0.00008526" />

              <label style={{ fontSize: '0.8rem', color: '#a0ffc0' }}>💸 Min Withdraw (HYPE)</label>
              <input className="input" type="text" inputMode="decimal" value={settingsForm.min_withdraw}
                onChange={(e) => setSettingsForm({ ...settingsForm, min_withdraw: e.target.value })}
                placeholder="e.g. 2" />

              <label style={{ fontSize: '0.8rem', color: '#a0ffc0' }}>⚡ Max Energy</label>
              <input className="input" type="number" value={settingsForm.energy_max}
                onChange={(e) => setSettingsForm({ ...settingsForm, energy_max: e.target.value })}
                placeholder="e.g. 1000" />

              <label style={{ fontSize: '0.8rem', color: '#a0ffc0' }}>⏳ Energy Cooldown (seconds)</label>
              <input className="input" type="number" value={settingsForm.energy_cooldown}
                onChange={(e) => setSettingsForm({ ...settingsForm, energy_cooldown: e.target.value })}
                placeholder="e.g. 3600" />

              <label style={{ fontSize: '0.8rem', color: '#a0ffc0' }}>📅 Daily Check-in Reward (HYPE)</label>
              <input className="input" type="text" inputMode="decimal" value={settingsForm.daily_checkin_reward}
                onChange={(e) => setSettingsForm({ ...settingsForm, daily_checkin_reward: e.target.value })}
                placeholder="e.g. 0.0000005678" />

              <button className="btn btn-primary" style={{ width: '100%', marginTop: 8 }} onClick={saveSettings}>
                💾 Save & Apply Live
              </button>
              {adminSettings && (
                <div style={{ marginTop: 12, fontSize: '0.8rem', color: 'rgba(0,255,136,0.7)', lineHeight: 1.5 }}>
                  <strong>Live values:</strong><br />
                  Tap: {formatHYPE(adminSettings.tap_reward)} • Referral: {formatHYPE(adminSettings.referral_reward)}<br />
                  Min WD: {formatHYPE(adminSettings.min_withdraw)} • Energy: {adminSettings.energy_max} / {adminSettings.energy_cooldown}s<br />
                  Daily Check-in: {formatHYPE(adminSettings.daily_checkin_reward)}
                </div>
              )}
            </div>
          )}

          {/* USERS / LEADERBOARD manage */}
          {adminTab === 'users' && (
            <>
              <div className="card">
                <div className="card-title">👤 Edit User Points (Leaderboard control)</div>
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
                    <input className="input" type="text" inputMode="decimal" value={editUserData.balance}
                      onChange={(e) => setEditUserData({ ...editUserData, balance: e.target.value })} />
                    <label style={{ fontSize: '0.8rem', color: '#a0ffc0' }}>Total Earned</label>
                    <input className="input" type="text" inputMode="decimal" value={editUserData.total_earned}
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
                    Reward: +{formatHYPE(r.reward)} HYPE • ID: {r.id}
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
                    @{w.username || w.user_id} • <strong>{formatHYPE(w.amount)} HYPE</strong>
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
                    <div style={{ fontSize: '0.8rem', color: '#00ff88' }}>+{formatHYPE(t.reward)} • {t.type}</div>
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
              <div className="card-title">📢 Advanced Broadcast</div>
              <div style={{ fontSize: '0.75rem', color: '#888', marginBottom: 10 }}>
                Text only, Photo only, ya dono — sab users ko Telegram par bheja jayega
              </div>

              <label style={{ fontSize: '0.8rem', color: '#a0ffc0' }}>📷 Photo URL (optional)</label>
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

              <label style={{ fontSize: '0.8rem', color: '#a0ffc0' }}>💬 Message / Caption</label>
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
                {broadcastSending ? '⏳ Sending to all users...' : '🚀 Send Broadcast to Everyone'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Bottom Nav */}
      <div className="bottom-nav">
        <button className={`nav-item ${tab === 'tap' ? 'active' : ''}`} onClick={() => setTab('tap')}>
          <span className="icon">⚡</span>
          Tap
        </button>
        <button className={`nav-item ${tab === 'tasks' ? 'active' : ''}`} onClick={() => setTab('tasks')}>
          <span className="icon">🎁</span>
          Tasks
        </button>
        <button className={`nav-item ${tab === 'friends' ? 'active' : ''}`} onClick={() => setTab('friends')}>
          <span className="icon">👥</span>
          Friends
        </button>
        <button className={`nav-item ${tab === 'leaderboard' ? 'active' : ''}`} onClick={() => setTab('leaderboard')}>
          <span className="icon">🏆</span>
          Rank
        </button>
        <button className={`nav-item ${tab === 'wallet' ? 'active' : ''}`} onClick={() => setTab('wallet')}>
          <span className="icon">💰</span>
          Wallet
        </button>
      </div>
    </div>
  );
}
