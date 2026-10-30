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
  let s = num.toFixed(Math.min(Math.max(dec, 0), 18));
  if (s.includes('.')) {
    s = s.replace(/0+\( /, '').replace(/\. \)/, '');
  }
  return s || '0';
}

function formatTime(sec) {
  if (sec <= 0) return '00:00:00';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) {
    return `\( {String(h).padStart(2, '0')}: \){String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `\( {String(m).padStart(2, '0')}: \){String(s).padStart(2, '0')}`;
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
  const [particles, setParticles] = useState([]); // ← NEW

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

  useEffect(() => {
    const boot = document.getElementById('boot-splash');
    if (boot) boot.classList.add('hide');

    loadUser();
    const iv = setInterval(() => {
      fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'allMids' }),
      })
        .then((r) => r.json())
        .then((m) => setPrice(parseFloat(m['HYPE'] || 0)))
        .catch(() => {});
    }, 30000);
    return () => clearInterval(iv);
  }, [loadUser]);

  useEffect(() => {
    energyRef.current = energyLeft;
  }, [energyLeft]);

  useEffect(() => {
    if (energyLeft > 0 && (!resetAt || resetAt <= Math.floor(Date.now() / 1000))) {
      setWaitSec(0);
      return;
    }
    if (!resetAt || resetAt <= 0) {
      setWaitSec(0);
      return;
    }
    const tick = () => {
      const now = Math.floor(Date.now() / 1000);
      const left = Math.max(0, resetAt - now);
      setWaitSec(left);
      if (left <= 0) {
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
      if (pendingFlush.current || tapQueue.current > 0) {
        pendingFlush.current = false;
        flushTaps();
      }
    }
  };

  // ========== UPDATED doTap with particles ==========
  const doTap = () => {
    if (energyRef.current <= 0) {
      showToast(`Energy empty • wait ${formatTime(waitSec)}`);
      return;
    }
    setTapAnim((a) => a + 1);

    // Scatter 4 small Hype logos
    const newParticles = Array.from({ length: 4 }).map((_, i) => ({
      id: Date.now() + i + Math.random(),
      x: (Math.random() - 0.5) * 140,
      y: -50 - Math.random() * 70,
      rot: Math.random() * 360,
    }));
    setParticles((p) => [...p, ...newParticles]);
    setTimeout(() => {
      setParticles((prev) => prev.filter((pt) => !newParticles.find((n) => n.id === pt.id)));
    }, 850);

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
      loadUser();
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
        showToast(`✅ Sent to \( {data.sent}/ \){data.total || data.sent} users` + (data.failed ? ` (${data.failed} failed)` : ''));
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
    ? `https://t.me/\( {config.bot_username}?startapp= \){user.id}`
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
              ≈ \( {(Number(user?.balance || 0) * price).toFixed(4)} \) left to Lvl UP →
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
            <div className="hl-price">
              💹 HYPE Live: {price > 0 ? `$${Number(price).toFixed(4)}` : '…'} <span style={{ opacity: 0.7 }}>· Hyperliquid</span>
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
              
              {/* Scatter particles */}
              {particles.map((p) => (
                <img
                  key={p.id}
                  src="/hype-logo.png"
                  alt=""
                  className="tap-particle"
                  style={{
                    '--x': `${p.x}px`,
                    '--y': `${p.y}px`,
                    '--rot': `${p.rot}deg`,
                  }}
                />
              ))}
            </div>
            <div className="tap-hint">
              {energyLeft > 0
                ? `Tap to Mine • 1 Tap = ${formatNum(config?.tap_reward || 0.0000000695, 12)} HYPE`
                : `Energy empty • Recharge in ${formatTime(waitSec)}`}
            </div>
          </div>

          <div className="energy-wrap">
            <div className="energy-bar">
              <div
                className="energy-fill"
                style={{
                  width: `${Math.min(100, Math.max(0, (energyLeft / (config?.energy_max || 1000)) * 100))}%`,
                }}
              />
            </div>
            <div className="energy-text">
              <span>⚡ {Math.max(0, energyLeft)}/{config?.energy_max || 1000}</span>
              {(energyLeft <= 0 || waitSec > 0) && (
                <span className="timer">⏳ Renew in {formatTime(waitSec)}</span>
              )}
            </div>
          </div>

          <button
            className={`claim-btn ${!canCheckin ? 'claim-disabled' : ''}`}
            onClick={doCheckin}
            disabled={!canCheckin}
          >
            {canCheckin
              ? `📅 DAILY CHECK-IN  +${formatNum(config?.daily_checkin_reward ?? 0.001, 12)}`
              : `⏳ Next in ${formatTime(checkinWait)}`}
          </button>
          <div className="hl-native-tag">
            Hyperliquid Native
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

      {/* FRIENDS */}
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
                  `https://t.me/share/url?url=\( {encodeURIComponent(inviteLink)}&text= \){encodeURIComponent('Join Hype Token Tap to Earn!')}`
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

      {/* WALLET */}
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

      {/* ADMIN PANEL - same as before */}
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

          {adminTab === 'settings' && (
            <div className="card">
              <div className="card-title">⚙️ Live App Controls</div>
              <div style={{ fontSize: '0.78rem', color: '#888', marginBottom: 12 }}>
                Yahan change karoge → turant pure app par apply hoga
              </div>

              <label style={{ fontSize: '0.8rem', color: '#a0ffc0' }}>🔥 Per Tap Points (HYPE)</label>
              <input className="input" type="number" step="any" value={settingsForm.tap_reward}
                onChange={(e) => setSettingsForm({ ...settingsForm, tap_reward: e.target.value })} />

              <label style={{ fontSize: '0.8rem', color: '#a0ffc0' }}>👥 Per Referral Points (HYPE)</label>
              <input className="input" type="number" step="any" value={settingsForm.referral_reward}
                onChange={(e) => setSettingsForm({ ...settingsForm, referral_reward: e.target.value })} />

              <label style={{ fontSize: '0.8rem', color: '#a0ffc0' }}>💸 Min Withdraw (HYPE)</label>
              <input className="input" type="number" step="any" value={settingsForm.min_withdraw}
                onChange={(e) => setSettingsForm({ ...settingsForm, min_withdraw: e.target.value })} />

              <label style={{ fontSize: '0.8rem', color: '#a0ffc0' }}>⚡ Max Energy</label>
              <input className="input" type="number" value={settingsForm.energy_max}
                onChange={(e) => setSettingsForm({ ...settingsForm, energy_max: e.target.value })} />

              <label style={{ fontSize: '0.8rem', color: '#a0ffc0' }}>⏳ Energy Cooldown (seconds)</label>
              <input className="input" type="number" value={settingsForm.energy_cooldown}
                onChange={(e) => setSettingsForm({ ...settingsForm, energy_cooldown: e.target.value })} />

              <label style={{ fontSize: '0.8rem', color: '#a0ffc0' }}>📅 Daily Check-in Reward (HYPE)</label>
              <input className="input" type="number" step="any" value={settingsForm.daily_checkin_reward}
                onChange={(e) => setSettingsForm({ ...settingsForm, daily_checkin_reward: e.target.value })} />

              <button className="btn btn-primary" style={{ width: '100%', marginTop: 8 }} onClick={saveSettings}>
                💾 Save & Apply Live
              </button>
            </div>
          )}

          {adminTab === 'users' && (
            <>
              <div className="card">
                <div className="card-title">👤 Edit User</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input className="input" style={{ marginBottom: 0 }} placeholder="User Telegram ID" value={editUserId}
                    onChange={(e) => setEditUserId(e.target.value)} />
                  <button className="btn btn-outline" onClick={() => loadUserDetails(editUserId)}>Load</button>
                </div>
                {editUserId && editUserData.balance !== '' && (
                  <div style={{ marginTop: 12 }}>
                    <input className="input" type="number" step="any" value={editUserData.balance}
                      onChange={(e) => setEditUserData({ ...editUserData, balance: e.target.value })} placeholder="Balance" />
                    <input className="input" type="number" step="any" value={editUserData.total_earned}
                      onChange={(e) => setEditUserData({ ...editUserData, total_earned: e.target.value })} placeholder="Total Earned" />
                    <input className="input" type="number" value={editUserData.total_taps}
                      onChange={(e) => setEditUserData({ ...editUserData, total_taps: e.target.value })} placeholder="Total Taps" />
                    <input className="input" type="number" value={editUserData.invite_count}
                      onChange={(e) => setEditUserData({ ...editUserData, invite_count: e.target.value })} placeholder="Invite Count" />
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0' }}>
                      <input type="checkbox" checked={editUserData.is_admin}
                        onChange={(e) => setEditUserData({ ...editUserData, is_admin: e.target.checked })} />
                      Is Admin
                    </label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn btn-primary" style={{ flex: 1 }} onClick={saveUserEdit}>Save</button>
                      <button className="btn btn-danger" style={{ flex: 1 }} onClick={() => deleteUser(editUserId)}>Delete</button>
                    </div>
                  </div>
                )}
              </div>
              {adminLeaderboard.map((u, i) => (
                <div className="card" key={u.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px' }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>#{i + 1} @{u.username || u.first_name || u.id}</div>
                    <div style={{ fontSize: '0.8rem', color: '#00ff88' }}>
                      {formatNum(u.total_earned, 6)} earned
                    </div>
                  </div>
                  <button className="btn btn-outline" style={{ padding: '6px 10px', fontSize: '0.75rem' }}
                    onClick={() => { setEditUserId(String(u.id)); loadUserDetails(u.id); }}>
                    Edit
                  </button>
                </div>
              ))}
            </>
          )}

          {adminTab === 'referrals' && (
            <>
              {adminReferrals.map((r) => (
                <div className="card" key={r.id} style={{ padding: '10px 14px' }}>
                  <div style={{ fontWeight: 600 }}>
                    @{r.referrer_name || r.referrer_id} → @{r.referred_name || r.referred_id}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: '#00ff88' }}>
                    +{formatNum(r.reward, 12)} HYPE
                  </div>
                </div>
              ))}
            </>
          )}

          {adminTab === 'withdrawals' && (
            <>
              {adminWithdrawals.map((w) => (
                <div className="card" key={w.id}>
                  <div>@{w.username || w.user_id} • <strong>{w.amount} HYPE</strong></div>
                  <div style={{ fontSize: '0.8rem', wordBreak: 'break-all', margin: '6px 0' }}>{w.wallet_address}</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-primary" style={{ flex: 1, padding: 8 }} onClick={() => adminAction(w.id, 'approve')}>Approve</button>
                    <button className="btn btn-outline" style={{ flex: 1, padding: 8 }} onClick={() => adminAction(w.id, 'processing')}>Processing</button>
                    <button className="btn btn-danger" style={{ flex: 1, padding: 8 }} onClick={() => adminAction(w.id, 'reject')}>Reject</button>
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
                <button className="btn btn-primary" style={{ width: '100%' }} onClick={addTask}>Add Task</button>
              </div>
              {adminTasks.map((t) => (
                <div className="card" key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div>{t.title}</div>
                    <div style={{ fontSize: '0.8rem', color: '#00ff88' }}>+{formatNum(t.reward, 12)}</div>
                  </div>
                  <button className="btn btn-danger" style={{ padding: '6px 12px' }} onClick={() => deleteTask(t.id)}>Delete</button>
                </div>
              ))}
            </>
          )}

          {adminTab === 'broadcast' && (
            <div className="card">
              <div className="card-title">📢 Broadcast</div>
              <input className="input" type="url" placeholder="Photo URL (optional)" value={broadcastPhoto}
                onChange={(e) => setBroadcastPhoto(e.target.value)} />
              <textarea className="input" rows={4} placeholder="Message..." value={broadcastMsg}
                onChange={(e) => setBroadcastMsg(e.target.value)} style={{ resize: 'vertical' }} />
              <button className="btn btn-gold" style={{ width: '100%' }} onClick={sendBroadcast} disabled={broadcastSending}>
                {broadcastSending ? 'Sending...' : '🚀 Send Broadcast'}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="bottom-nav">
        <button className={`nav-item ${tab === 'tap' ? 'active' : ''}`} onClick={() => setTab('tap')}>
          <span className="icon">⚡</span> Tap
        </button>
        <button className={`nav-item ${tab === 'tasks' ? 'active' : ''}`} onClick={() => setTab('tasks')}>
          <span className="icon">🎁</span> Tasks
        </button>
        <button className={`nav-item ${tab === 'friends' ? 'active' : ''}`} onClick={() => setTab('friends')}>
          <span className="icon">👥</span> Friends
        </button>
        <button className={`nav-item ${tab === 'leaderboard' ? 'active' : ''}`} onClick={() => setTab('leaderboard')}>
          <span className="icon">🏆</span> Rank
        </button>
        <button className={`nav-item ${tab === 'wallet' ? 'active' : ''}`} onClick={() => setTab('wallet')}>
          <span className="icon">💰</span> Wallet
        </button>
      </div>
    </div>
  );
}
