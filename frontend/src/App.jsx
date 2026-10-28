import React, { useState, useEffect, useCallback, useRef } from 'react';

const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
  tg.setHeaderColor('#020a06');
  tg.setBackgroundColor('#020a06');
}

const API = ''; // same origin when deployed on CF

function formatNum(n, dec = 6) {
  if (n === undefined || n === null) return '0';
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: dec });
}

function formatTime(sec) {
  if (sec <= 0) return '00:00';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
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

  // Admin
  const [adminTab, setAdminTab] = useState('stats');
  const [adminStats, setAdminStats] = useState(null);
  const [adminWithdrawals, setAdminWithdrawals] = useState([]);
  const [adminTasks, setAdminTasks] = useState([]);
  const [broadcastMsg, setBroadcastMsg] = useState('');
  const [newTask, setNewTask] = useState({ title: '', type: 'telegram', link: '', reward: '0.0085' });
  const [wdAmount, setWdAmount] = useState('');
  const [wdWallet, setWdWallet] = useState('');

  const tapQueue = useRef(0);
  const tapTimer = useRef(null);

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
        setUser(data.user);
        setEnergyLeft(data.user.energy);
        setResetAt(data.user.energy_reset_at || 0);
        setConfig(data.config);
        setPrice(data.price || 0);
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
    loadUser();
    const iv = setInterval(() => {
      // refresh price every 30s
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

  // Batch taps
  const doTap = () => {
    if (energyLeft <= 0) {
      showToast(`Energy empty • wait ${formatTime(waitSec)}`);
      return;
    }
    setTapAnim((a) => a + 1);
    setEnergyLeft((e) => Math.max(0, e - 1));
    tapQueue.current += 1;

    if (tapTimer.current) clearTimeout(tapTimer.current);
    tapTimer.current = setTimeout(async () => {
      const taps = tapQueue.current;
      tapQueue.current = 0;
      try {
        const data = await api('/api/tap', {
          method: 'POST',
          body: JSON.stringify({ user: tg?.initDataUnsafe?.user, taps }),
        });
        if (data.success) {
          setUser((u) => ({
            ...u,
            balance: data.balance,
            energy: data.energy,
            energy_reset_at: data.energy_reset_at,
          }));
          setEnergyLeft(data.energy);
          setResetAt(data.energy_reset_at || 0);
          if (data.earned > 0) {
            // optional haptic
            tg?.HapticFeedback?.impactOccurred?.('light');
          }
        } else if (data.error) {
          showToast(data.error);
          if (data.energy_reset_at) setResetAt(data.energy_reset_at);
          setEnergyLeft(data.energy || 0);
        }
      } catch {
        showToast('Tap failed');
      }
    }, 180);
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

  const completeTask = async (taskId) => {
    const data = await api('/api/tasks/complete', {
      method: 'POST',
      body: JSON.stringify({ user: tg?.initDataUnsafe?.user, task_id: taskId }),
    });
    if (data.success) {
      showToast(`+${data.reward} HYPE`);
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
    if (!broadcastMsg.trim()) return;
    showToast('Sending...');
    const data = await api('/api/admin/broadcast', {
      method: 'POST',
      body: JSON.stringify({ message: broadcastMsg }),
    });
    if (data.success) {
      showToast(`Sent to ${data.sent} users`);
      setBroadcastMsg('');
    } else {
      showToast('Failed');
    }
  };

  const inviteLink = config
    ? `https://t.me/${config.bot_username}?start=${user?.id || ''}`
    : '';

  if (loading) {
    return (
      <div className="app" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#00ff88', fontSize: '1.2rem' }}>Loading Hype...</div>
      </div>
    );
  }

  return (
    <div className="app">
      {toast && <div className="toast">{toast}</div>}

      {/* Header */}
      <div className="header">
        <div className="logo-title">
          <span style={{ fontSize: '1.4rem' }}>👑</span> Hype Token
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <span className="badge online">⚡ ONLINE</span>
          {user?.is_admin && (
            <span className="badge gold" onClick={() => setTab('admin')}>
              ADMIN
            </span>
          )}
        </div>
      </div>

      {price > 0 && (
        <div className="price-bar">
          HYPE ≈ ${price.toFixed(3)} USD • Hyperliquid
        </div>
      )}

      {/* TAP PAGE */}
      {tab === 'tap' && (
        <>
          <div className="assets-card">
            <div className="balance-row">
              <div className="balance-amount">{formatNum(user?.balance, 6)}</div>
              <div className="balance-symbol">HYPE</div>
            </div>
            <div className="earned-chip">
              📈 Total Earned: {formatNum(user?.total_earned, 6)} HYPE
            </div>
            {price > 0 && (
              <div style={{ marginTop: 6, fontSize: '0.8rem', color: '#a0ffc0' }}>
                ≈ ${(Number(user?.balance || 0) * price).toFixed(4)} USD
              </div>
            )}
          </div>

          <div className="tap-area">
            <div
              className="hype-logo"
              onClick={doTap}
              onTouchStart={(e) => {
                e.preventDefault();
                doTap();
              }}
              key={tapAnim}
            >
              <div className="hype-symbol">ℍ</div>
            </div>
            <div className="tap-hint">
              {energyLeft > 0
                ? `Tap to Mine • 1 Tap = ${config?.tap_reward || 0.000695} HYPE`
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

          <button className="claim-btn" disabled>
            CLAIM (auto on tap)
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
                      +{t.reward} HYPE
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
              +{config?.referral_reward || 0.0008526} HYPE per invite
            </div>
          </div>

          <div className="card">
            <div className="card-title">Your Invites ({user?.invite_count || 0})</div>
            {referrals.length === 0 && <div style={{ color: '#666' }}>No referrals yet</div>}
            {referrals.map((r) => (
              <div key={r.id} style={{ padding: '6px 0', borderBottom: '1px solid rgba(0,255,136,0.1)' }}>
                @{r.username || r.first_name || r.referred_id} • +{r.reward} HYPE
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
          <h3 style={{ color: '#f0d878', marginBottom: 12 }}>⚙️ Admin Panel</h3>
          <div className="admin-tabs">
            {['stats', 'withdrawals', 'tasks', 'broadcast'].map((t) => (
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
                    <div style={{ fontSize: '0.8rem', color: '#00ff88' }}>+{t.reward} • {t.type}</div>
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
              <div className="card-title">Broadcast Message</div>
              <textarea
                className="input"
                rows={4}
                placeholder="Message to all users..."
                value={broadcastMsg}
                onChange={(e) => setBroadcastMsg(e.target.value)}
                style={{ resize: 'vertical' }}
              />
              <button className="btn btn-gold" style={{ width: '100%' }} onClick={sendBroadcast}>
                Send Broadcast
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
