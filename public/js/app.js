/* ==========================================
   GigConnect - Frontend Application
   ========================================== */

const API = '';
let currentUser = null;
let searchTimeout = null;

// ==========================================
//  Theme (load immediately to prevent flash)
// ==========================================
(function loadTheme() {
  const saved = localStorage.getItem('theme');
  if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();

function toggleTheme() {
  const html = document.documentElement;
  const isDark = html.getAttribute('data-theme') === 'dark';
  const next = isDark ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
}

// ==========================================
//  Initialization
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  // Handle OAuth callback before anything else
  if (handleOAuthCallback()) return;

  checkAuth();
  loadHeroStats();
  routeFromHash(); // Navigate to the page specified in the URL hash (defaults to home)

  // Dismiss splash screen immediately once app is ready
  const splash = document.getElementById('splashScreen');
  if (splash) {
    splash.classList.add('hide');
    setTimeout(() => splash.remove(), 600);
  }

  // Close dropdowns on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.user-menu')) {
      document.getElementById('userDropdown').classList.remove('show');
    }
    if (!e.target.closest('.notification-bell') && !e.target.closest('.notification-panel')) {
      document.getElementById('notifPanel').style.display = 'none';
    }
  });
});

// ==========================================
//  Authentication
// ==========================================
function checkAuth() {
  const token = localStorage.getItem('token');
  const user = localStorage.getItem('user');
  if (token && user) {
    currentUser = JSON.parse(user);
    showAuthUI();
  }
}

function showAuthUI() {
  document.getElementById('navActions').style.display = 'none';
  document.getElementById('navActionsAuth').style.display = 'flex';
  document.getElementById('userName').textContent = currentUser.full_name.split(' ')[0];
  updateNavAvatar();

  // Show/hide menu items based on role
  if (currentUser.role === 'employer') {
    document.getElementById('myGigsLink').style.display = 'flex';
    document.getElementById('myAppsLink').style.display = 'none';
  } else {
    document.getElementById('myGigsLink').style.display = 'none';
    document.getElementById('myAppsLink').style.display = 'flex';
  }

  loadNotifications();
  loadChatBadge();

  // Hide guest-only elements (CTA, sign-up buttons) for logged-in users
  const cta = document.getElementById('ctaSection');
  if (cta) cta.style.display = 'none';
  document.querySelectorAll('.guest-only').forEach(el => el.style.display = 'none');
}

function showGuestUI() {
  document.getElementById('navActions').style.display = 'flex';
  document.getElementById('navActionsAuth').style.display = 'none';

  // Show the sign-up CTA for guests
  const cta = document.getElementById('ctaSection');
  if (cta) cta.style.display = '';
  document.querySelectorAll('.guest-only').forEach(el => el.style.display = '');
  currentUser = null;
}

async function handleLogin(e) {
  e.preventDefault();
  const btn = document.getElementById('loginBtn');
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner" style="width:20px;height:20px;border-width:2px;margin:0"></div>';

  try {
    const body = {
      email: document.getElementById('loginEmail').value,
      password: document.getElementById('loginPassword').value
    };

    // Include 2FA code if the field is visible
    const twoFaCode = document.getElementById('login2faCode').value;
    if (twoFaCode) body.totp_code = twoFaCode;

    const res = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await res.json();

    // If 2FA is required, show the code field
    if (data.requires_2fa) {
      document.getElementById('login2faGroup').style.display = 'block';
      document.getElementById('login2faCode').focus();
      showToast('Enter your authenticator code', 'info');
      return;
    }

    if (!res.ok) throw new Error(data.error);

    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    currentUser = data.user;

    closeModal('loginModal');
    document.getElementById('login2faGroup').style.display = 'none';
    document.getElementById('login2faCode').value = '';
    showAuthUI();
    showToast('Welcome back! 👋', 'success');
    navigate('dashboard');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Log In';
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const btn = document.getElementById('registerBtn');
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner" style="width:20px;height:20px;border-width:2px;margin:0"></div>';

  const role = document.querySelector('input[name="role"]:checked').value;

  const body = {
    email: document.getElementById('regEmail').value,
    password: document.getElementById('regPassword').value,
    full_name: document.getElementById('regName').value,
    phone: document.getElementById('regPhone').value,
    role
  };

  if (role === 'student') {
    body.school_name = document.getElementById('regSchool').value;
    body.major = document.getElementById('regMajor').value;
    body.graduation_year = document.getElementById('regGradYear').value;
  } else {
    body.company_name = document.getElementById('regCompany').value;
    body.industry = document.getElementById('regIndustry').value;
    body.location = document.getElementById('regLocation').value;
  }

  try {
    const res = await fetch(`${API}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    currentUser = data.user;

    closeModal('registerModal');
    showAuthUI();
    showToast('Account created successfully! 🎉', 'success');
    navigate('dashboard');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-user-plus"></i> Create Account';
  }
}

function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  currentUser = null;
  showGuestUI();
  navigate('home');
  showToast('Logged out successfully', 'success');
}

function getHeaders() {
  const token = localStorage.getItem('token');
  return {
    'Content-Type': 'application/json',
    ...(token && { 'Authorization': `Bearer ${token}` })
  };
}

// ==========================================
//  Social OAuth Login
// ==========================================
function socialLogin(provider) {
  if (provider === 'twitter' || provider === 'linkedin') {
    showToast(`${provider.charAt(0).toUpperCase() + provider.slice(1)} sign-in coming soon!`, 'info');
    return;
  }
  // Close modals then redirect to OAuth flow
  closeModal('loginModal');
  closeModal('registerModal');
  window.location.href = `${API}/api/auth/${provider}`;
}

function handleOAuthCallback() {
  const hash = window.location.hash;
  if (!hash.includes('oauth-callback')) return false;

  const params = new URLSearchParams(hash.split('?')[1] || '');
  const token = params.get('token');
  const userStr = params.get('user');

  if (token && userStr) {
    try {
      const user = JSON.parse(decodeURIComponent(userStr));
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));
      currentUser = user;
      showAuthUI();
      showToast(`Welcome${user.full_name ? ', ' + user.full_name.split(' ')[0] : ''}! 🎉`, 'success');
      // Clean URL
      window.location.hash = '#/dashboard';
      return true;
    } catch (e) {
      console.error('OAuth callback parse error:', e);
    }
  }

  const error = params.get('error');
  if (error) {
    showToast('Social sign-in failed. Please try again.', 'error');
    window.location.hash = '#/home';
    return true;
  }

  return false;
}

// ==========================================
//  Two-Factor Authentication (2FA)
// ==========================================
async function setup2FA() {
  const container = document.getElementById('2faSetupArea');
  container.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';

  try {
    const res = await fetch(`${API}/api/auth/2fa/setup`, { method: 'POST', headers: getHeaders() });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    container.innerHTML = `
      <div class="twofa-setup">
        <h4 style="margin-bottom:8px;color:var(--gray-800)">Scan this QR code with your authenticator app</h4>
        <p style="font-size:0.85rem;color:var(--gray-500);margin-bottom:12px">Google Authenticator, Authy, or any TOTP-compatible app</p>
        <img src="${data.qr_code}" alt="2FA QR Code" class="qr-code" width="200" height="200">
        <p style="font-size:0.8rem;color:var(--gray-400);margin-top:8px">Or enter this key manually:</p>
        <div class="secret-key">${data.secret}</div>
        <div class="twofa-verify-form">
          <input type="text" id="verify2faCode" class="form-input" placeholder="000000" maxlength="6" pattern="[0-9]{6}" inputmode="numeric">
          <button class="btn btn-primary" onclick="verify2FA()"><i class="fas fa-check"></i> Verify</button>
        </div>
      </div>
    `;
  } catch (err) {
    showToast(err.message, 'error');
    container.innerHTML = '';
  }
}

async function verify2FA() {
  const code = document.getElementById('verify2faCode').value;
  if (!code || code.length !== 6) {
    showToast('Enter a 6-digit code', 'error');
    return;
  }

  try {
    const res = await fetch(`${API}/api/auth/2fa/verify`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ code })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast(data.message, 'success');
    load2FAStatus(); // Refresh the section
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function disable2FA() {
  const code = prompt('Enter your current authenticator code to disable 2FA:');
  if (!code) return;

  try {
    const res = await fetch(`${API}/api/auth/2fa/disable`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ code })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast(data.message, 'success');
    load2FAStatus();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function load2FAStatus() {
  const container = document.getElementById('2faSection');
  if (!container) return;

  try {
    const res = await fetch(`${API}/api/auth/2fa/status`, { headers: getHeaders() });
    const data = await res.json();

    container.innerHTML = `
      <div class="twofa-status ${data.enabled ? 'enabled' : ''}">
        <div class="status-icon"><i class="fas fa-${data.enabled ? 'shield-alt' : 'unlock'}"></i></div>
        <div class="status-text" style="flex:1">
          <strong>Two-Factor Authentication</strong>
          <span>${data.enabled ? 'Enabled — your account is extra secure' : 'Disabled — add an extra layer of security'}</span>
        </div>
        ${data.enabled
          ? '<button class="btn btn-outline btn-sm" onclick="disable2FA()"><i class="fas fa-times"></i> Disable 2FA</button>'
          : '<button class="btn btn-primary btn-sm" onclick="setup2FA()"><i class="fas fa-shield-alt"></i> Enable 2FA</button>'
        }
      </div>
      <div id="2faSetupArea"></div>
    `;
  } catch (err) {
    container.innerHTML = '<p style="color:var(--gray-400);font-size:0.85rem">Could not load 2FA status</p>';
  }
}

// ==========================================
//  Navigation (hash-based routing)
// ==========================================

// Build a hash string from page name + optional data (ID)
function buildHash(page, data) {
  if (data !== undefined && data !== null) return `#/${page}/${data}`;
  return `#/${page}`;
}

// Parse the current hash into { page, data }
function parseHash() {
  const hash = window.location.hash || '';
  const parts = hash.replace(/^#\/?/, '').split('/');
  const page = parts[0] || 'home';
  const data = parts[1] ? Number(parts[1]) || parts[1] : undefined;
  return { page, data };
}

// Navigate to a page – updates URL hash, which triggers rendering
function navigate(page, data) {
  const newHash = buildHash(page, data);
  if (window.location.hash === newHash) {
    // Same hash – just render directly (hashchange won't fire)
    renderPage(page, data);
  } else {
    window.location.hash = newHash;
    // hashchange listener will call renderPage
  }
}

// Render the given page (show/hide divs, load data)
function renderPage(page, data) {
  // Hide all pages
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));

  // Update nav links
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  const activeLink = document.querySelector(`[data-page="${page}"]`);
  if (activeLink) activeLink.classList.add('active');

  // Show target page
  const pageEl = document.getElementById(`page-${page}`);
  if (pageEl) {
    pageEl.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Load page data
  switch (page) {
    case 'gigs': loadGigs(); break;
    case 'gig-detail': loadGigDetail(data); break;
    case 'dashboard': loadDashboard(); break;
    case 'my-gigs': loadMyGigs(); break;
    case 'applications': loadMyApplications(); break;
    case 'gig-applications': loadGigApplications(data); break;
    case 'payments': loadPayments(); break;
    case 'submissions': loadSubmissions(data); break;
    case 'profile': loadProfile(); break;
    case 'messages': loadConversations(data); break;
    case 'how-it-works':
      document.getElementById('page-home').classList.add('active');
      setTimeout(() => {
        document.getElementById('how-it-works-section').scrollIntoView({ behavior: 'smooth' });
      }, 100);
      break;
  }

  // Close mobile menu
  document.getElementById('navLinks').classList.remove('show');
  document.getElementById('userDropdown').classList.remove('show');
}

// Listen for hash changes (browser back/forward, link clicks)
window.addEventListener('hashchange', () => {
  const { page, data } = parseHash();
  renderPage(page, data);
});

// Route from current URL hash on page load
function routeFromHash() {
  const { page, data } = parseHash();
  renderPage(page, data);
}

// ==========================================
//  Hero / Public Stats
// ==========================================
async function loadHeroStats() {
  try {
    const res = await fetch(`${API}/api/dashboard/public-stats`);
    const data = await res.json();
    document.getElementById('statOpenGigs').textContent = Number(data.openGigs).toLocaleString();
    document.getElementById('statStudents').textContent = Number(data.totalStudents).toLocaleString();
    document.getElementById('statEmployers').textContent = Number(data.totalEmployers).toLocaleString();
    document.getElementById('statCompleted').textContent = Number(data.completedGigs).toLocaleString();
  } catch (e) {
    console.error('Failed to load hero stats', e);
  }
}

// ==========================================
//  Gigs
// ==========================================
async function loadGigs(page = 1) {
  const grid = document.getElementById('gigsGrid');
  grid.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><p>Loading gigs...</p></div>';

  const params = new URLSearchParams();
  params.set('page', page);

  const search = document.getElementById('gigSearch')?.value;
  const category = document.getElementById('gigCategory')?.value;
  const locationType = document.getElementById('gigLocationType')?.value;
  const minPay = document.getElementById('gigMinPay')?.value;
  const maxPay = document.getElementById('gigMaxPay')?.value;

  if (search) params.set('search', search);
  if (category) params.set('category', category);
  if (locationType) params.set('location_type', locationType);
  if (minPay) params.set('min_pay', minPay);
  if (maxPay) params.set('max_pay', maxPay);

  try {
    const res = await fetch(`${API}/api/gigs?${params}`);
    const data = await res.json();

    document.getElementById('gigsCount').textContent = `${data.total} gig${data.total !== 1 ? 's' : ''} found`;

    if (data.gigs.length === 0) {
      grid.innerHTML = `
        <div class="empty-state" style="grid-column: 1/-1">
          <i class="fas fa-search"></i>
          <h3>No gigs found</h3>
          <p>Try adjusting your filters or check back later</p>
        </div>`;
      document.getElementById('gigsPagination').innerHTML = '';
      return;
    }

    grid.innerHTML = data.gigs.map(gig => `
      <div class="gig-card" onclick="navigate('gig-detail', ${gig.id})">
        <div class="gig-card-header">
          <span class="gig-category">${formatCategory(gig.category)}</span>
          <span class="gig-location-type">
            <i class="fas fa-${gig.location_type === 'remote' ? 'globe' : gig.location_type === 'onsite' ? 'map-marker-alt' : 'building'}"></i>
            ${capitalize(gig.location_type)}
          </span>
        </div>
        <h3>${escapeHtml(gig.title)}</h3>
        <div class="gig-employer">
          <i class="fas fa-building"></i>
          ${escapeHtml(gig.company_name || gig.employer_name)}
          ${gig.verified ? '<i class="fas fa-check-circle" style="color: var(--success)" title="Verified"></i>' : ''}
        </div>
        <p class="gig-card-desc">${escapeHtml(gig.description)}</p>
        <div class="gig-card-meta">
          <span class="gig-pay">KSh ${Number(gig.pay_amount).toLocaleString()} <span>/${gig.pay_type === 'hourly' ? 'hr' : 'fixed'}</span></span>
          <span class="gig-applicants"><i class="fas fa-users"></i> ${gig.application_count} applied</span>
        </div>
      </div>
    `).join('');

    // Pagination
    const pagination = document.getElementById('gigsPagination');
    if (data.totalPages > 1) {
      let html = '';
      for (let i = 1; i <= data.totalPages; i++) {
        html += `<button class="${i === data.page ? 'active' : ''}" onclick="loadGigs(${i})">${i}</button>`;
      }
      pagination.innerHTML = html;
    } else {
      pagination.innerHTML = '';
    }
  } catch (err) {
    grid.innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><h3>Failed to load gigs</h3><p>Please try again later</p></div>';
  }
}

function debounceSearch() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => loadGigs(), 400);
}

function clearFilters() {
  document.getElementById('gigSearch').value = '';
  document.getElementById('gigCategory').value = '';
  document.getElementById('gigLocationType').value = '';
  document.getElementById('gigMinPay').value = '';
  document.getElementById('gigMaxPay').value = '';
  loadGigs();
}

// ==========================================
//  Gig Detail
// ==========================================
async function loadGigDetail(gigId) {
  const container = document.getElementById('gigDetail');
  container.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';

  try {
    const res = await fetch(`${API}/api/gigs/${gigId}`);
    const gig = await res.json();

    if (!res.ok) throw new Error(gig.error);

    const skills = gig.skills_required ? gig.skills_required.split(',').map(s => s.trim()) : [];

    container.innerHTML = `
      <div class="gig-detail-main">
        <div style="margin-bottom:16px">
          <button class="btn btn-ghost btn-sm" onclick="navigate('gigs')">
            <i class="fas fa-arrow-left"></i> Back to Gigs
          </button>
        </div>
        <span class="gig-category" style="margin-bottom:16px;display:inline-block">${formatCategory(gig.category)}</span>
        <h1>${escapeHtml(gig.title)}</h1>
        <div class="gig-employer" style="margin-bottom:20px;font-size:0.95rem">
          <i class="fas fa-building"></i>
          ${escapeHtml(gig.company_name || gig.employer_name)}
          ${gig.verified ? '<i class="fas fa-check-circle" style="color: var(--success)" title="Verified employer"></i>' : ''}
          ${gig.employer_rating ? `<span style="color:var(--warning)"><i class="fas fa-star"></i> ${Number(gig.employer_rating).toFixed(1)}</span>` : ''}
        </div>
        ${skills.length > 0 ? `
          <div class="gig-detail-tags">
            ${skills.map(s => `<span class="tag">${escapeHtml(s)}</span>`).join('')}
          </div>
        ` : ''}
        <div class="gig-detail-body">
          <h3>Description</h3>
          ${escapeHtml(gig.description)}
          ${gig.company_description ? `<h3>About the Company</h3>${escapeHtml(gig.company_description)}` : ''}
        </div>
      </div>
      <div class="gig-detail-sidebar">
        <div class="gig-sidebar-card">
          <div class="pay-display">
            <div class="amount">KSh ${Number(gig.pay_amount).toLocaleString()}</div>
            <div class="type">${gig.pay_type === 'hourly' ? 'Per Hour' : 'Fixed Price'}</div>
          </div>
          <ul class="gig-info-list">
            <li><i class="fas fa-${gig.location_type === 'remote' ? 'globe' : 'map-marker-alt'}"></i> <strong>${capitalize(gig.location_type)}</strong> ${gig.location ? '- ' + escapeHtml(gig.location) : ''}</li>
            ${gig.duration ? `<li><i class="fas fa-clock"></i> <strong>Duration:</strong> ${escapeHtml(gig.duration)}</li>` : ''}
            ${gig.deadline ? `<li><i class="fas fa-calendar"></i> <strong>Deadline:</strong> ${new Date(gig.deadline).toLocaleDateString()}</li>` : ''}
            <li><i class="fas fa-users"></i> <strong>${gig.application_count}</strong> applicant${gig.application_count !== 1 ? 's' : ''}</li>
            <li><i class="fas fa-info-circle"></i> <strong>Status:</strong> <span class="badge badge-${gig.status}">${capitalize(gig.status)}</span></li>
            <li><i class="fas fa-calendar-plus"></i> <strong>Posted:</strong> ${timeAgo(gig.created_at)}</li>
          </ul>
          ${getGigActions(gig)}
        </div>
      </div>
    `;
  } catch (err) {
    container.innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><h3>Gig not found</h3><button class="btn btn-primary" onclick="navigate(\'gigs\')">Browse Gigs</button></div>';
  }
}

function getGigActions(gig) {
  if (!currentUser) {
    return `<button class="btn btn-primary btn-block btn-lg" onclick="showModal('loginModal')" style="margin-top:20px">
      <i class="fas fa-sign-in-alt"></i> Log in to Apply
    </button>`;
  }

  if (currentUser.role === 'student' && gig.status === 'open') {
    return `<button class="btn btn-primary btn-block btn-lg" onclick="openApplyModal(${gig.id}, '${escapeHtml(gig.title)}', ${gig.pay_amount})" style="margin-top:20px">
      <i class="fas fa-paper-plane"></i> Apply Now
    </button>`;
  }

  if (currentUser.role === 'student' && gig.status === 'in_progress') {
    return `
      <div style="margin-top:20px;display:flex;flex-direction:column;gap:8px">
        <button class="btn btn-primary btn-block btn-lg" onclick="navigate('submissions', ${gig.id})">
          <i class="fas fa-upload"></i> Submit Work
        </button>
        <button class="btn btn-outline btn-block" onclick="navigate('submissions', ${gig.id})">
          <i class="fas fa-list"></i> View Submissions
        </button>
      </div>`;
  }

  if (currentUser.role === 'employer' && currentUser.id === gig.employer_id) {
    let buttons = `
      <div style="margin-top:20px;display:flex;flex-direction:column;gap:8px">
        <button class="btn btn-primary btn-block" onclick="navigate('gig-applications', ${gig.id})">
          <i class="fas fa-users"></i> View Applicants (${gig.application_count})
        </button>`;
    if (gig.status === 'in_progress') {
      buttons += `
        <button class="btn btn-outline btn-block" onclick="navigate('submissions', ${gig.id})">
          <i class="fas fa-tasks"></i> View Submissions
        </button>`;
    }
    buttons += '</div>';
    return buttons;
  }

  return '';
}

// ==========================================
//  Post Gig
// ==========================================
async function handlePostGig(e) {
  e.preventDefault();
  if (!currentUser || currentUser.role !== 'employer') {
    showToast('Only employers can post gigs', 'error');
    return;
  }

  const form = e.target;
  const formData = new FormData(form);
  const body = Object.fromEntries(formData);
  body.pay_amount = Number(body.pay_amount);
  body.max_applicants = Number(body.max_applicants) || 10;

  try {
    const res = await fetch(`${API}/api/gigs`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(body)
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast('Gig posted successfully! 🎉', 'success');
    form.reset();
    navigate('my-gigs');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ==========================================
//  My Gigs (Employer)
// ==========================================
async function loadMyGigs() {
  if (!currentUser || currentUser.role !== 'employer') return;

  const container = document.getElementById('myGigsList');
  container.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';

  try {
    const res = await fetch(`${API}/api/gigs?status=&limit=100`, { headers: getHeaders() });
    const data = await res.json();

    // Filter to only employer's gigs
    const myGigs = data.gigs.filter(g => g.employer_name === currentUser.full_name || g.company_name);

    // Actually fetch all gigs from dashboard which has employer-specific data
    const dashRes = await fetch(`${API}/api/dashboard/stats`, { headers: getHeaders() });
    const dashData = await dashRes.json();

    // Reload with proper employer filter
    const allRes = await fetch(`${API}/api/gigs?status=open&limit=100`);
    const allData = await allRes.json();
    const allRes2 = await fetch(`${API}/api/gigs?status=in_progress&limit=100`);
    const allData2 = await allRes2.json();
    const allRes3 = await fetch(`${API}/api/gigs?status=completed&limit=100`);
    const allData3 = await allRes3.json();
    const allRes4 = await fetch(`${API}/api/gigs?status=cancelled&limit=100`);
    const allData4 = await allRes4.json();

    const allGigs = [...allData.gigs, ...allData2.gigs, ...allData3.gigs, ...allData4.gigs];

    if (allGigs.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-briefcase"></i>
          <h3>No gigs posted yet</h3>
          <p>Post your first gig to start finding talented students</p>
          <button class="btn btn-primary" onclick="navigate('post-gig')"><i class="fas fa-plus"></i> Post a Gig</button>
        </div>`;
      return;
    }

    container.innerHTML = allGigs.map(gig => `
      <div class="list-card">
        <div class="list-card-header">
          <h3>${escapeHtml(gig.title)}</h3>
          <span class="badge badge-${gig.status}">${capitalize(gig.status.replace('_', ' '))}</span>
        </div>
        <div class="list-card-meta">
          <span><i class="fas fa-tag"></i> ${formatCategory(gig.category)}</span>
          <span><i class="fas fa-money-bill-wave"></i> KSh ${Number(gig.pay_amount).toLocaleString()} (${gig.pay_type})</span>
          <span><i class="fas fa-users"></i> ${gig.application_count} applicants</span>
          <span><i class="fas fa-clock"></i> ${timeAgo(gig.created_at)}</span>
        </div>
        <div class="list-card-actions">
          <button class="btn btn-primary btn-sm" onclick="navigate('gig-applications', ${gig.id})">
            <i class="fas fa-users"></i> View Applicants
          </button>
          <button class="btn btn-outline btn-sm" onclick="navigate('gig-detail', ${gig.id})">
            <i class="fas fa-eye"></i> View
          </button>
          ${gig.status === 'open' ? `
            <button class="btn btn-danger btn-sm" onclick="deleteGig(${gig.id})">
              <i class="fas fa-trash"></i> Delete
            </button>
          ` : ''}
        </div>
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><h3>Failed to load gigs</h3></div>';
  }
}

async function deleteGig(gigId) {
  if (!confirm('Are you sure you want to delete this gig?')) return;

  try {
    const res = await fetch(`${API}/api/gigs/${gigId}`, {
      method: 'DELETE',
      headers: getHeaders()
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error);
    }

    showToast('Gig deleted successfully', 'success');
    loadMyGigs();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ==========================================
//  Applications
// ==========================================
function openApplyModal(gigId, title, amount) {
  if (!currentUser) {
    showModal('loginModal');
    return;
  }
  if (currentUser.role !== 'student') {
    showToast('Only students can apply for gigs', 'warning');
    return;
  }

  document.getElementById('applyGigId').value = gigId;
  document.getElementById('applyGigTitle').textContent = title;
  document.getElementById('applyAmount').value = amount;
  document.getElementById('applyCoverLetter').value = '';
  showModal('applyModal');
}

async function handleApply(e) {
  e.preventDefault();
  const btn = document.getElementById('applyBtn');
  btn.disabled = true;

  try {
    const res = await fetch(`${API}/api/applications`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        gig_id: Number(document.getElementById('applyGigId').value),
        cover_letter: document.getElementById('applyCoverLetter').value,
        proposed_amount: Number(document.getElementById('applyAmount').value) || undefined
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    closeModal('applyModal');
    showToast('Application submitted! 🎉', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

async function loadMyApplications() {
  if (!currentUser || currentUser.role !== 'student') return;

  const container = document.getElementById('applicationsList');
  container.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';

  try {
    const res = await fetch(`${API}/api/applications/my`, { headers: getHeaders() });
    const apps = await res.json();

    if (apps.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-file-alt"></i>
          <h3>No applications yet</h3>
          <p>Start browsing and applying to gigs</p>
          <button class="btn btn-primary" onclick="navigate('gigs')"><i class="fas fa-search"></i> Browse Gigs</button>
        </div>`;
      return;
    }

    container.innerHTML = apps.map(app => `
      <div class="list-card">
        <div class="list-card-header">
          <h3>${escapeHtml(app.gig_title)}</h3>
          <span class="badge badge-${app.status}">${capitalize(app.status)}</span>
        </div>
        <div class="list-card-meta">
          <span><i class="fas fa-building"></i> ${escapeHtml(app.company_name || app.employer_name)}</span>
          <span><i class="fas fa-money-bill-wave"></i> KSh ${Number(app.pay_amount).toLocaleString()} (${app.pay_type})</span>
          <span><i class="fas fa-tag"></i> ${formatCategory(app.category)}</span>
          <span><i class="fas fa-clock"></i> Applied ${timeAgo(app.created_at)}</span>
        </div>
        ${app.cover_letter ? `<p style="font-size:0.85rem;color:var(--gray-500);margin-top:8px">"${escapeHtml(app.cover_letter.substring(0, 150))}${app.cover_letter.length > 150 ? '...' : ''}"</p>` : ''}
        <div class="list-card-actions">
          <button class="btn btn-outline btn-sm" onclick="navigate('gig-detail', ${app.gig_id})">
            <i class="fas fa-eye"></i> View Gig
          </button>
          ${app.status === 'pending' ? `
            <button class="btn btn-danger btn-sm" onclick="withdrawApplication(${app.id})">
              <i class="fas fa-times"></i> Withdraw
            </button>
          ` : ''}
          ${app.status === 'accepted' ? `
            <button class="btn btn-primary btn-sm" onclick="navigate('submissions', ${app.gig_id})">
              <i class="fas fa-upload"></i> Submit Work
            </button>
          ` : ''}
        </div>
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><h3>Failed to load applications</h3></div>';
  }
}

async function loadGigApplications(gigId) {
  if (!currentUser || currentUser.role !== 'employer') return;

  const container = document.getElementById('gigApplicantsList');
  container.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';

  try {
    const res = await fetch(`${API}/api/applications/gig/${gigId}`, { headers: getHeaders() });
    const apps = await res.json();

    if (apps.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-users"></i>
          <h3>No applicants yet</h3>
          <p>Share your gig to attract talent</p>
          <button class="btn btn-outline" onclick="navigate('gig-detail', ${gigId})"><i class="fas fa-arrow-left"></i> Back to Gig</button>
        </div>`;
      return;
    }

    document.getElementById('gigApplicantsTitle').textContent = `${apps.length} applicant${apps.length !== 1 ? 's' : ''}`;

    container.innerHTML = apps.map(app => `
      <div class="list-card">
        <div class="list-card-header">
          <div style="display:flex;align-items:center;gap:12px">
            ${getAvatarHtml(app.student_avatar, app.student_name, 44)}
            <div>
              <h3>${escapeHtml(app.student_name)}</h3>
              <span style="font-size:0.85rem;color:var(--gray-500)">${escapeHtml(app.student_email)}</span>
            </div>
          </div>
          <span class="badge badge-${app.status}">${capitalize(app.status)}</span>
        </div>
        <div class="list-card-meta">
          <span><i class="fas fa-graduation-cap"></i> ${escapeHtml(app.school_name || 'N/A')}</span>
          ${app.major ? `<span><i class="fas fa-book"></i> ${escapeHtml(app.major)}</span>` : ''}
          ${app.graduation_year ? `<span><i class="fas fa-calendar"></i> Class of ${app.graduation_year}</span>` : ''}
          ${app.student_rating ? `<span><i class="fas fa-star" style="color:var(--warning)"></i> ${Number(app.student_rating).toFixed(1)}</span>` : ''}
          ${app.completed_gigs > 0 ? `<span><i class="fas fa-check-circle"></i> ${app.completed_gigs} completed gigs</span>` : ''}
          ${app.proposed_amount ? `<span><i class="fas fa-money-bill-wave"></i> Proposed: KSh ${Number(app.proposed_amount).toLocaleString()}</span>` : ''}
        </div>
        ${app.skills ? `<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">${app.skills.split(',').map(s => `<span class="tag" style="padding:3px 10px;background:var(--gray-100);border-radius:20px;font-size:0.75rem">${escapeHtml(s.trim())}</span>`).join('')}</div>` : ''}
        ${app.cover_letter ? `<p style="font-size:0.85rem;color:var(--gray-500);margin-top:12px;padding:12px;background:var(--gray-50);border-radius:8px">"${escapeHtml(app.cover_letter)}"</p>` : ''}
        ${app.status === 'pending' ? `
          <div class="list-card-actions">
            <button class="btn btn-success btn-sm" onclick="updateApplicationStatus(${app.id}, 'accepted', ${gigId})">
              <i class="fas fa-check"></i> Accept
            </button>
            <button class="btn btn-danger btn-sm" onclick="updateApplicationStatus(${app.id}, 'rejected', ${gigId})">
              <i class="fas fa-times"></i> Reject
            </button>
            <button class="btn btn-primary btn-sm" onclick="startChatWith(${app.student_id}, decodeURIComponent('${encodeURIComponent(app.student_name)}'), ${gigId})">
              <i class="fas fa-comments"></i> Message
            </button>
            ${app.portfolio_url ? `<a href="${escapeHtml(app.portfolio_url)}" target="_blank" class="btn btn-outline btn-sm"><i class="fas fa-external-link-alt"></i> Portfolio</a>` : ''}
          </div>
        ` : `
          <div class="list-card-actions">
            <button class="btn btn-primary btn-sm" onclick="startChatWith(${app.student_id}, decodeURIComponent('${encodeURIComponent(app.student_name)}'), ${gigId})">
              <i class="fas fa-comments"></i> Message
            </button>
          </div>
        `}
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><h3>Failed to load applicants</h3></div>';
  }
}

async function updateApplicationStatus(appId, status, gigId) {
  const action = status === 'accepted' ? 'accept' : 'reject';
  if (!confirm(`Are you sure you want to ${action} this application?`)) return;

  try {
    const res = await fetch(`${API}/api/applications/${appId}/status`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({ status })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast(`Application ${status}! ✅`, 'success');
    loadGigApplications(gigId);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function withdrawApplication(appId) {
  if (!confirm('Are you sure you want to withdraw this application?')) return;

  try {
    const res = await fetch(`${API}/api/applications/${appId}/withdraw`, {
      method: 'PUT',
      headers: getHeaders()
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast('Application withdrawn', 'success');
    loadMyApplications();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ==========================================
//  Dashboard
// ==========================================
async function loadDashboard() {
  if (!currentUser) {
    navigate('home');
    return;
  }

  document.getElementById('dashboardWelcome').textContent = `Welcome back, ${currentUser.full_name}!`;
  const statsContainer = document.getElementById('dashboardStats');
  const contentContainer = document.getElementById('dashboardContent');

  try {
    const res = await fetch(`${API}/api/dashboard/stats`, { headers: getHeaders() });
    const data = await res.json();

    if (currentUser.role === 'employer') {
      statsContainer.innerHTML = `
        <div class="stat-card">
          <div class="stat-card-icon" style="background:var(--primary-bg);color:var(--primary)"><i class="fas fa-briefcase"></i></div>
          <h3>Total Gigs</h3>
          <div class="stat-value">${data.totalGigs}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-icon" style="background:#d1fae5;color:var(--success)"><i class="fas fa-check-circle"></i></div>
          <h3>Active Gigs</h3>
          <div class="stat-value">${data.activeGigs}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-icon" style="background:#dbeafe;color:#3b82f6"><i class="fas fa-users"></i></div>
          <h3>Total Applicants</h3>
          <div class="stat-value">${data.totalApplicants}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-icon" style="background:#fef3c7;color:var(--warning)"><i class="fas fa-money-bill-wave"></i></div>
          <h3>Total Spent</h3>
          <div class="stat-value">KSh ${Number(data.totalSpent).toLocaleString()}</div>
        </div>
      `;

      contentContainer.innerHTML = `
        <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:24px">
          <button class="btn btn-primary" onclick="navigate('post-gig')"><i class="fas fa-plus"></i> Post New Gig</button>
          <button class="btn btn-outline" onclick="navigate('my-gigs')"><i class="fas fa-briefcase"></i> Manage Gigs</button>
          <button class="btn btn-outline" onclick="navigate('messages')"><i class="fas fa-comments"></i> Messages</button>
          <button class="btn btn-outline" onclick="navigate('payments')"><i class="fas fa-wallet"></i> Payments</button>
        </div>
        ${data.recentApplications.length > 0 ? `
          <h3 style="margin-bottom:16px;font-size:1.1rem;font-weight:700">Recent Applications</h3>
          ${data.recentApplications.map(app => `
            <div class="list-card">
              <div class="list-card-header">
                <div style="display:flex;align-items:center;gap:10px">
                  ${getAvatarHtml(app.student_avatar, app.student_name, 36)}
                  <h3>${escapeHtml(app.student_name)} <span style="font-weight:400;color:var(--gray-500)">applied for</span> ${escapeHtml(app.gig_title)}</h3>
                </div>
                <span class="badge badge-pending">Pending</span>
              </div>
              <div class="list-card-meta">
                <span><i class="fas fa-graduation-cap"></i> ${escapeHtml(app.school_name || 'N/A')}</span>
                <span><i class="fas fa-clock"></i> ${timeAgo(app.created_at)}</span>
                <button class="btn btn-primary btn-sm" style="margin-left:auto" onclick="startChatWith(${app.student_id}, decodeURIComponent('${encodeURIComponent(app.student_name)}'), null)">
                  <i class="fas fa-comments"></i> Message
                </button>
              </div>
            </div>
          `).join('')}
        ` : '<div class="empty-state"><i class="fas fa-inbox"></i><h3>No recent applications</h3></div>'}
      `;
    } else {
      statsContainer.innerHTML = `
        <div class="stat-card">
          <div class="stat-card-icon" style="background:var(--primary-bg);color:var(--primary)"><i class="fas fa-file-alt"></i></div>
          <h3>Applied Gigs</h3>
          <div class="stat-value">${data.appliedGigs}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-icon" style="background:#d1fae5;color:var(--success)"><i class="fas fa-check-circle"></i></div>
          <h3>Accepted</h3>
          <div class="stat-value">${data.acceptedGigs}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-icon" style="background:#fef3c7;color:var(--warning)"><i class="fas fa-wallet"></i></div>
          <h3>Total Earned</h3>
          <div class="stat-value">KSh ${Number(data.totalEarned).toLocaleString()}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-icon" style="background:#dbeafe;color:#3b82f6"><i class="fas fa-hourglass-half"></i></div>
          <h3>Pending Payments</h3>
          <div class="stat-value">KSh ${Number(data.pendingPayments).toLocaleString()}</div>
        </div>
      `;

      contentContainer.innerHTML = `
        <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:24px">
          <button class="btn btn-primary" onclick="navigate('gigs')"><i class="fas fa-search"></i> Browse Gigs</button>
          <button class="btn btn-outline" onclick="navigate('applications')"><i class="fas fa-file-alt"></i> My Applications</button>
          <button class="btn btn-outline" onclick="navigate('messages')"><i class="fas fa-comments"></i> Messages</button>
          <button class="btn btn-outline" onclick="navigate('payments')"><i class="fas fa-wallet"></i> Payments</button>
        </div>
        ${data.recentGigs && data.recentGigs.length > 0 ? `
          <h3 style="margin-bottom:16px;font-size:1.1rem;font-weight:700">Latest Gigs For You</h3>
          <div class="gigs-grid">
            ${data.recentGigs.map(gig => `
              <div class="gig-card" onclick="navigate('gig-detail', ${gig.id})">
                <div class="gig-card-header">
                  <span class="gig-category">${formatCategory(gig.category)}</span>
                  <span class="gig-location-type"><i class="fas fa-${gig.location_type === 'remote' ? 'globe' : 'map-marker-alt'}"></i> ${capitalize(gig.location_type)}</span>
                </div>
                <h3>${escapeHtml(gig.title)}</h3>
                <div class="gig-employer"><i class="fas fa-building"></i> ${escapeHtml(gig.company_name || gig.employer_name)}</div>
                <div class="gig-card-meta">
                  <span class="gig-pay">KSh ${Number(gig.pay_amount).toLocaleString()} <span>/${gig.pay_type === 'hourly' ? 'hr' : 'fixed'}</span></span>
                  <span class="gig-applicants"><i class="fas fa-users"></i> ${gig.application_count}</span>
                </div>
              </div>
            `).join('')}
          </div>
        ` : ''}
      `;
    }
  } catch (err) {
    statsContainer.innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><h3>Failed to load dashboard</h3></div>';
  }
}

// ==========================================
//  Payments
// ==========================================
async function loadPayments() {
  if (!currentUser) return;

  const container = document.getElementById('paymentsList');
  container.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';

  const endpoint = currentUser.role === 'employer' ? 'employer' : 'student';

  try {
    const res = await fetch(`${API}/api/payments/${endpoint}`, { headers: getHeaders() });
    const payments = await res.json();

    if (payments.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-wallet"></i>
          <h3>No payments yet</h3>
          <p>${currentUser.role === 'employer' ? 'Payments will appear when you accept an applicant' : 'Complete gigs to earn money'}</p>
        </div>`;
      return;
    }

    container.innerHTML = payments.map(p => `
      <div class="list-card">
        <div class="list-card-header">
          <h3>${escapeHtml(p.gig_title)}</h3>
          <span class="badge badge-${p.status}">${capitalize(p.status)}</span>
        </div>
        <div class="list-card-meta">
          <span><i class="fas fa-money-bill-wave"></i> <strong style="color:var(--success);font-size:1.1rem">KSh ${Number(p.amount).toLocaleString()}</strong></span>
          <span><i class="fas fa-user"></i> ${currentUser.role === 'employer' ? escapeHtml(p.student_name) : escapeHtml(p.employer_name || p.company_name)}</span>
          ${p.transaction_ref ? `<span><i class="fas fa-receipt"></i> ${p.transaction_ref}</span>` : ''}
          <span><i class="fas fa-clock"></i> ${timeAgo(p.created_at)}</span>
        </div>
        ${currentUser.role === 'employer' && p.status === 'pending' ? `
          <div class="list-card-actions">
            <button class="btn btn-success btn-sm" onclick="releasePayment(${p.id})">
              <i class="fas fa-check"></i> Release Payment
            </button>
          </div>
        ` : ''}
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><h3>Failed to load payments</h3></div>';
  }
}

async function releasePayment(paymentId) {
  if (!confirm('Release payment to the student? This action cannot be undone.')) return;

  try {
    const res = await fetch(`${API}/api/payments/release/${paymentId}`, {
      method: 'POST',
      headers: getHeaders()
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast(`Payment released! Transaction: ${data.transaction_ref} 💰`, 'success');
    loadPayments();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ==========================================
//  Task Submissions
// ==========================================

async function loadSubmissions(gigId) {
  if (!currentUser) return;

  const container = document.getElementById('submissionsList');
  const formEl = document.getElementById('submitWorkForm');
  container.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';

  // Set gig id on form
  document.getElementById('submitGigId').value = gigId;

  // Show submit form only for students
  if (currentUser.role === 'student') {
    formEl.style.display = 'block';
    document.getElementById('submissionsSubtitle').textContent = 'Upload and track your work';
  } else {
    formEl.style.display = 'none';
    document.getElementById('submissionsSubtitle').textContent = 'Review student submissions';
  }

  // Setup file input preview
  setupFileUpload();

  try {
    const res = await fetch(`${API}/api/submissions/gig/${gigId}`, { headers: getHeaders() });
    const submissions = await res.json();

    if (!res.ok) throw new Error(submissions.error || 'Failed to load submissions');

    if (submissions.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-cloud-upload-alt"></i>
          <h3>No submissions yet</h3>
          <p>${currentUser.role === 'student' ? 'Upload your completed work above' : 'The student hasn\'t submitted work yet'}</p>
        </div>`;
      return;
    }

    container.innerHTML = submissions.map(sub => `
      <div class="submission-card submission-${sub.status}">
        <div class="submission-header">
          <div class="submission-info">
            <span class="submission-number">#${sub.id}</span>
            <span class="submission-date"><i class="fas fa-clock"></i> ${timeAgo(sub.created_at)}</span>
          </div>
          <span class="badge badge-${sub.status === 'revision_requested' ? 'pending' : sub.status}">${formatSubmissionStatus(sub.status)}</span>
        </div>
        ${sub.description ? `<div class="submission-description">${escapeHtml(sub.description)}</div>` : ''}
        ${sub.file_urls && sub.file_urls.length > 0 ? `
          <div class="submission-files">
            <h4><i class="fas fa-paperclip"></i> Attached Files</h4>
            <div class="file-grid">
              ${sub.file_urls.map(f => `
                <a href="${f}" target="_blank" class="file-attachment" download>
                  <i class="fas ${getFileIcon(f)}"></i>
                  <span>${getFileName(f)}</span>
                </a>
              `).join('')}
            </div>
          </div>
        ` : ''}
        ${sub.employer_feedback ? `
          <div class="submission-feedback">
            <h4><i class="fas fa-comment-dots"></i> Employer Feedback</h4>
            <p>${escapeHtml(sub.employer_feedback)}</p>
          </div>
        ` : ''}
        ${currentUser.role === 'employer' && sub.status === 'submitted' ? `
          <div class="submission-actions">
            <button class="btn btn-success btn-sm" onclick="openReviewModal(${sub.id}, 'approved')">
              <i class="fas fa-check"></i> Approve
            </button>
            <button class="btn btn-warning btn-sm" onclick="openReviewModal(${sub.id}, 'revision_requested')">
              <i class="fas fa-redo"></i> Request Revision
            </button>
            <button class="btn btn-danger btn-sm" onclick="openReviewModal(${sub.id}, 'rejected')">
              <i class="fas fa-times"></i> Reject
            </button>
          </div>
        ` : ''}
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><h3>Failed to load submissions</h3><p>${escapeHtml(err.message)}</p></div>`;
  }
}

function setupFileUpload() {
  const input = document.getElementById('submitFiles');
  const fileList = document.getElementById('fileList');
  const area = document.getElementById('fileUploadArea');

  if (!input) return;

  // Remove old listeners by cloning
  const newInput = input.cloneNode(true);
  input.parentNode.replaceChild(newInput, input);

  newInput.addEventListener('change', () => {
    updateFileList(newInput, fileList);
  });

  // Drag and drop
  area.addEventListener('dragover', (e) => { e.preventDefault(); area.classList.add('drag-over'); });
  area.addEventListener('dragleave', () => area.classList.remove('drag-over'));
  area.addEventListener('drop', (e) => {
    e.preventDefault();
    area.classList.remove('drag-over');
    newInput.files = e.dataTransfer.files;
    updateFileList(newInput, fileList);
  });
}

function updateFileList(input, fileList) {
  if (!input.files || input.files.length === 0) {
    fileList.innerHTML = '';
    return;
  }
  if (input.files.length > 5) {
    showToast('Maximum 5 files allowed', 'error');
    input.value = '';
    fileList.innerHTML = '';
    return;
  }
  fileList.innerHTML = Array.from(input.files).map(f => `
    <div class="file-item">
      <i class="fas ${getFileIconByName(f.name)}"></i>
      <span>${escapeHtml(f.name)}</span>
      <span class="file-size">${formatFileSize(f.size)}</span>
    </div>
  `).join('');
}

async function handleSubmitWork(e) {
  e.preventDefault();
  if (!currentUser || currentUser.role !== 'student') return;

  const gigId = document.getElementById('submitGigId').value;
  const description = document.getElementById('submitDescription').value.trim();
  const files = document.getElementById('submitFiles').files;

  if (!description && files.length === 0) {
    showToast('Please add a description or upload files', 'error');
    return;
  }

  const btn = document.getElementById('submitWorkBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading...';

  const formData = new FormData();
  formData.append('gig_id', gigId);
  if (description) formData.append('description', description);
  for (const file of files) {
    formData.append('files', file);
  }

  try {
    const res = await fetch(`${API}/api/submissions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast('Work submitted successfully! 📤', 'success');
    document.getElementById('submitDescription').value = '';
    document.getElementById('submitFiles').value = '';
    document.getElementById('fileList').innerHTML = '';
    loadSubmissions(gigId);
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-paper-plane"></i> Submit Work';
  }
}

function openReviewModal(submissionId, status) {
  const statusText = status === 'approved' ? 'Approve' : status === 'revision_requested' ? 'Request Revision' : 'Reject';
  const feedback = prompt(`${statusText} this submission?\n\nAdd feedback for the student (optional):`);

  if (feedback === null) return; // cancelled

  reviewSubmission(submissionId, status, feedback);
}

async function reviewSubmission(submissionId, status, feedback) {
  try {
    const res = await fetch(`${API}/api/submissions/${submissionId}/review`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({ status, employer_feedback: feedback || '' })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    const emoji = status === 'approved' ? '✅' : status === 'revision_requested' ? '🔄' : '❌';
    showToast(`Submission ${formatSubmissionStatus(status)} ${emoji}`, 'success');

    // Reload submissions
    const gigId = document.getElementById('submitGigId').value;
    if (gigId) loadSubmissions(gigId);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function formatSubmissionStatus(status) {
  switch (status) {
    case 'submitted': return 'Submitted';
    case 'revision_requested': return 'Revision Requested';
    case 'approved': return 'Approved';
    case 'rejected': return 'Rejected';
    default: return capitalize(status);
  }
}

function getFileIcon(url) {
  const ext = url.split('.').pop().toLowerCase();
  return getIconForExt(ext);
}

function getFileIconByName(name) {
  const ext = name.split('.').pop().toLowerCase();
  return getIconForExt(ext);
}

function getIconForExt(ext) {
  const icons = {
    pdf: 'fa-file-pdf', doc: 'fa-file-word', docx: 'fa-file-word',
    xls: 'fa-file-excel', xlsx: 'fa-file-excel',
    ppt: 'fa-file-powerpoint', pptx: 'fa-file-powerpoint',
    jpg: 'fa-file-image', jpeg: 'fa-file-image', png: 'fa-file-image', gif: 'fa-file-image',
    zip: 'fa-file-archive', rar: 'fa-file-archive', '7z': 'fa-file-archive',
    mp4: 'fa-file-video',
    py: 'fa-file-code', js: 'fa-file-code', html: 'fa-file-code', css: 'fa-file-code', json: 'fa-file-code',
    txt: 'fa-file-alt', csv: 'fa-file-csv', md: 'fa-file-alt'
  };
  return icons[ext] || 'fa-file';
}

function getFileName(url) {
  return decodeURIComponent(url.split('/').pop());
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// ==========================================
//  Profile
// ==========================================

function updateNavAvatar() {
  const avatarEl = document.getElementById('userAvatar');
  if (currentUser && currentUser.avatar_url) {
    avatarEl.innerHTML = `<img src="${currentUser.avatar_url}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
  } else {
    avatarEl.innerHTML = '';
    avatarEl.textContent = currentUser ? currentUser.full_name.charAt(0).toUpperCase() : 'U';
  }
}

function getAvatarHtml(avatarUrl, name, size = 40) {
  if (avatarUrl) {
    return `<div class="profile-avatar-sm" style="width:${size}px;height:${size}px"><img src="${avatarUrl}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%"></div>`;
  }
  const initial = name ? name.charAt(0).toUpperCase() : '?';
  return `<div class="profile-avatar-sm" style="width:${size}px;height:${size}px;background:linear-gradient(135deg,var(--primary),#8b5cf6);color:white;display:flex;align-items:center;justify-content:center;border-radius:50%;font-weight:600;font-size:${size * 0.4}px">${initial}</div>`;
}

async function loadProfile() {
  if (!currentUser) return;

  const container = document.getElementById('profileForm');
  container.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';

  try {
    const res = await fetch(`${API}/api/auth/me`, { headers: getHeaders() });
    const data = await res.json();

    const profile = data.profile || {};
    const avatarUrl = data.avatar_url;

    const photoSection = `
      <div class="profile-photo-section">
        <div class="profile-photo-wrapper">
          ${avatarUrl 
            ? `<img src="${avatarUrl}" alt="Profile Photo" class="profile-photo-img">`
            : `<div class="profile-photo-placeholder"><i class="fas fa-user"></i></div>`
          }
          <label class="profile-photo-overlay" for="photoInput">
            <i class="fas fa-camera"></i>
            <span>${avatarUrl ? 'Change' : 'Upload'}</span>
          </label>
        </div>
        <input type="file" id="photoInput" accept="image/*" style="display:none" onchange="handlePhotoUpload(this)">
        <div class="profile-photo-info">
          <h3>${escapeHtml(data.full_name)}</h3>
          <p style="color:var(--gray-500);font-size:0.9rem">${currentUser.role === 'student' ? 'Student' : 'Employer'} &bull; ${escapeHtml(data.email)}</p>
          ${avatarUrl ? `<button class="btn btn-outline btn-sm" style="margin-top:8px" onclick="handleRemovePhoto()"><i class="fas fa-trash"></i> Remove Photo</button>` : `<p style="color:var(--gray-400);font-size:0.8rem;margin-top:4px">JPG, PNG, GIF or WEBP. Max 5MB.</p>`}
        </div>
      </div>
    `;

    if (currentUser.role === 'student') {
      container.innerHTML = `
        ${photoSection}
        <form onsubmit="handleUpdateProfile(event)">
          <div class="form-grid">
            <div class="form-group">
              <label class="form-label">Full Name</label>
              <input type="text" name="full_name" class="form-input" value="${escapeHtml(data.full_name)}" required>
            </div>
            <div class="form-group">
              <label class="form-label">Phone</label>
              <input type="tel" name="phone" class="form-input" value="${escapeHtml(data.phone || '')}">
            </div>
            <div class="form-group">
              <label class="form-label">School Name</label>
              <input type="text" name="school_name" class="form-input" value="${escapeHtml(profile.school_name || '')}">
            </div>
            <div class="form-group">
              <label class="form-label">Major</label>
              <input type="text" name="major" class="form-input" value="${escapeHtml(profile.major || '')}">
            </div>
            <div class="form-group">
              <label class="form-label">Graduation Year</label>
              <input type="number" name="graduation_year" class="form-input" value="${profile.graduation_year || ''}">
            </div>
            <div class="form-group">
              <label class="form-label">GPA</label>
              <input type="number" name="gpa" class="form-input" step="0.01" max="4.0" value="${profile.gpa || ''}">
            </div>
            <div class="form-group full-width">
              <label class="form-label">Bio</label>
              <textarea name="bio" class="form-textarea" rows="4" placeholder="Tell employers about yourself...">${escapeHtml(profile.bio || '')}</textarea>
            </div>
            <div class="form-group">
              <label class="form-label">Skills (comma-separated)</label>
              <input type="text" name="skills" class="form-input" value="${escapeHtml(profile.skills || '')}" placeholder="React, Python, Design...">
            </div>
            <div class="form-group">
              <label class="form-label">Portfolio URL</label>
              <input type="url" name="portfolio_url" class="form-input" value="${escapeHtml(profile.portfolio_url || '')}" placeholder="https://...">
            </div>
          </div>
          <div class="form-actions">
            <button type="submit" class="btn btn-primary btn-lg"><i class="fas fa-save"></i> Save Changes</button>
          </div>
        </form>
        <div class="security-section">
          <h3><i class="fas fa-lock"></i> Account Security</h3>
          <p>Protect your account with two-factor authentication using an authenticator app.</p>
          ${data.oauth_provider ? `<p style="font-size:0.85rem;color:var(--gray-500);margin-bottom:12px"><i class="fas fa-link"></i> Connected via <strong>${escapeHtml(data.oauth_provider)}</strong></p>` : ''}
          <div id="2faSection"><div class="loading-spinner"><div class="spinner"></div></div></div>
        </div>
      `;
    } else {
      container.innerHTML = `
        ${photoSection}
        <form onsubmit="handleUpdateProfile(event)">
          <div class="form-grid">
            <div class="form-group">
              <label class="form-label">Full Name</label>
              <input type="text" name="full_name" class="form-input" value="${escapeHtml(data.full_name)}" required>
            </div>
            <div class="form-group">
              <label class="form-label">Phone</label>
              <input type="tel" name="phone" class="form-input" value="${escapeHtml(data.phone || '')}">
            </div>
            <div class="form-group">
              <label class="form-label">Company Name</label>
              <input type="text" name="company_name" class="form-input" value="${escapeHtml(profile.company_name || '')}">
            </div>
            <div class="form-group">
              <label class="form-label">Industry</label>
              <input type="text" name="industry" class="form-input" value="${escapeHtml(profile.industry || '')}">
            </div>
            <div class="form-group">
              <label class="form-label">Website</label>
              <input type="url" name="website" class="form-input" value="${escapeHtml(profile.website || '')}" placeholder="https://...">
            </div>
            <div class="form-group">
              <label class="form-label">Location</label>
              <input type="text" name="location" class="form-input" value="${escapeHtml(profile.location || '')}">
            </div>
            <div class="form-group full-width">
              <label class="form-label">Company Description</label>
              <textarea name="company_description" class="form-textarea" rows="4" placeholder="Tell students about your company...">${escapeHtml(profile.company_description || '')}</textarea>
            </div>
          </div>
          <div class="form-actions">
            <button type="submit" class="btn btn-primary btn-lg"><i class="fas fa-save"></i> Save Changes</button>
          </div>
        </form>
        <div class="security-section">
          <h3><i class="fas fa-lock"></i> Account Security</h3>
          <p>Protect your account with two-factor authentication using an authenticator app.</p>
          ${data.oauth_provider ? `<p style="font-size:0.85rem;color:var(--gray-500);margin-bottom:12px"><i class="fas fa-link"></i> Connected via <strong>${escapeHtml(data.oauth_provider)}</strong></p>` : ''}
          <div id="2faSection"><div class="loading-spinner"><div class="spinner"></div></div></div>
        </div>
      `;
    }

    // Load 2FA status after rendering
    load2FAStatus();

  } catch (err) {
    container.innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><h3>Failed to load profile</h3></div>';
  }
}

async function handlePhotoUpload(input) {
  if (!input.files || !input.files[0]) return;

  const file = input.files[0];
  if (file.size > 5 * 1024 * 1024) {
    showToast('File too large. Maximum size is 5MB.', 'error');
    return;
  }

  const formData = new FormData();
  formData.append('photo', file);

  try {
    showToast('Uploading photo...', 'info');
    const res = await fetch(`${API}/api/users/photo`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
      body: formData
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    // Update stored user data with new avatar
    currentUser.avatar_url = data.avatar_url;
    localStorage.setItem('user', JSON.stringify(currentUser));
    updateNavAvatar();

    showToast('Profile photo updated! 📸', 'success');
    loadProfile(); // Reload profile to show new photo
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleRemovePhoto() {
  if (!confirm('Remove your profile photo?')) return;

  try {
    const res = await fetch(`${API}/api/users/photo`, {
      method: 'DELETE',
      headers: getHeaders()
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    currentUser.avatar_url = null;
    localStorage.setItem('user', JSON.stringify(currentUser));
    updateNavAvatar();

    showToast('Photo removed.', 'success');
    loadProfile();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleUpdateProfile(e) {
  e.preventDefault();
  const form = e.target;
  const formData = new FormData(form);
  const body = Object.fromEntries(formData);

  try {
    const res = await fetch(`${API}/api/users/profile`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(body)
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast('Profile updated! ✅', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ==========================================
//  Chat / Messaging
// ==========================================
let currentConversationId = null;
let chatPollInterval = null;

async function loadConversations(openConvId) {
  if (!currentUser) return;

  try {
    const res = await fetch(`${API}/api/chat/conversations`, { headers: getHeaders() });
    const data = await res.json();

    const list = document.getElementById('chatConversationList');
    const unreadEl = document.getElementById('chatUnreadTotal');

    if (data.unreadTotal > 0) {
      unreadEl.style.display = 'inline-flex';
      unreadEl.textContent = data.unreadTotal;
    } else {
      unreadEl.style.display = 'none';
    }

    updateChatBadge(data.unreadTotal);

    if (data.conversations.length === 0) {
      list.innerHTML = `
        <div style="padding:40px 20px;text-align:center;color:var(--gray-400)">
          <i class="fas fa-inbox" style="font-size:2rem;margin-bottom:12px;display:block"></i>
          <p style="font-size:0.9rem">No conversations yet</p>
          <p style="font-size:0.8rem;margin-top:4px">Employers can start a chat from a student's application.</p>
        </div>`;
      return;
    }

    list.innerHTML = data.conversations.map(conv => `
      <div class="chat-conv-item ${conv.unread_count > 0 ? 'has-unread' : ''} ${currentConversationId == conv.id ? 'active' : ''}"
           onclick="openConversation(${conv.id})" data-conv-id="${conv.id}"
           data-search="${(conv.other_name || '').toLowerCase()} ${(conv.gig_title || '').toLowerCase()} ${(conv.company_name || '').toLowerCase()} ${(conv.school_name || '').toLowerCase()}">
        <div class="chat-conv-avatar">
          ${conv.other_avatar
            ? `<img src="${conv.other_avatar}" alt="">`
            : (conv.other_name || '?').charAt(0).toUpperCase()
          }
        </div>
        <div class="chat-conv-info">
          <div class="conv-name">
            ${escapeHtml(conv.other_name)}
            <span class="conv-role">${conv.other_role === 'employer' ? (conv.company_name ? escapeHtml(conv.company_name) : 'Employer') : (conv.school_name ? escapeHtml(conv.school_name) : 'Student')}</span>
          </div>
          <div class="conv-preview ${conv.unread_count > 0 ? 'unread-text' : ''}">
            ${conv.gig_title ? `<i class="fas fa-briefcase" style="font-size:0.7rem;margin-right:4px"></i>` : ''}
            ${conv.last_message ? escapeHtml(conv.last_message) : '<em>No messages yet</em>'}
          </div>
        </div>
        <div class="chat-conv-meta">
          <span class="conv-time">${conv.last_message_at ? shortTime(conv.last_message_at) : ''}</span>
          ${conv.unread_count > 0 ? `<span class="conv-unread">${conv.unread_count}</span>` : ''}
        </div>
      </div>
    `).join('');

    // Auto-open conversation if navigated with ID
    if (openConvId) {
      openConversation(Number(openConvId));
    }
  } catch (err) {
    console.error('Failed to load conversations:', err);
    document.getElementById('chatConversationList').innerHTML =
      '<div style="padding:30px;text-align:center;color:var(--gray-400)"><i class="fas fa-exclamation-triangle"></i><p>Failed to load conversations</p></div>';
  }
}

function filterConversations(query) {
  const q = query.toLowerCase();
  document.querySelectorAll('.chat-conv-item').forEach(item => {
    const searchText = item.getAttribute('data-search') || '';
    item.style.display = searchText.includes(q) ? '' : 'none';
  });
}

async function openConversation(convId) {
  currentConversationId = convId;

  // Highlight active conversation
  document.querySelectorAll('.chat-conv-item').forEach(item => {
    item.classList.toggle('active', item.getAttribute('data-conv-id') == convId);
    if (item.getAttribute('data-conv-id') == convId) {
      item.classList.remove('has-unread');
      const badge = item.querySelector('.conv-unread');
      if (badge) badge.remove();
      const preview = item.querySelector('.conv-preview');
      if (preview) preview.classList.remove('unread-text');
    }
  });

  // Show chat area, hide empty state
  document.getElementById('chatEmptyState').style.display = 'none';
  document.getElementById('chatActive').style.display = 'flex';

  // Mobile: add chat-open class
  document.querySelector('.chat-layout').classList.add('chat-open');

  try {
    const res = await fetch(`${API}/api/chat/conversations/${convId}/messages`, { headers: getHeaders() });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    renderChatHeader(data.otherUser, data.gig);
    renderChatMessages(data.messages);

    // Focus input
    document.getElementById('chatInput').focus();

    // Start polling for new messages
    startChatPolling(convId);

    // Update sidebar unread counts
    loadChatBadge();
  } catch (err) {
    showToast('Failed to load messages', 'error');
  }
}

function renderChatHeader(otherUser, gig) {
  const header = document.getElementById('chatHeader');
  const profile = otherUser.profile || {};
  const subtitle = otherUser.role === 'student'
    ? [profile.school_name, profile.major].filter(Boolean).join(' — ')
    : [profile.company_name, profile.industry].filter(Boolean).join(' — ');

  header.innerHTML = `
    <button class="chat-back-btn" onclick="closeChatMobile()"><i class="fas fa-arrow-left"></i></button>
    <div class="chat-conv-avatar" style="width:38px;height:38px;font-size:0.9rem">
      ${otherUser.avatar_url
        ? `<img src="${otherUser.avatar_url}" alt="">`
        : (otherUser.full_name || '?').charAt(0).toUpperCase()
      }
    </div>
    <div class="chat-header-info">
      <h3>${escapeHtml(otherUser.full_name)}</h3>
      <p>${subtitle ? escapeHtml(subtitle) : capitalize(otherUser.role)}</p>
    </div>
    ${gig ? `<a href="#/gig-detail/${gig.id}" class="chat-header-gig"><i class="fas fa-briefcase"></i> ${escapeHtml(gig.title)}</a>` : ''}
  `;
}

function renderChatMessages(messages) {
  const container = document.getElementById('chatMessages');

  if (messages.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:40px;color:var(--gray-400)">
        <i class="fas fa-hand-peace" style="font-size:2rem;margin-bottom:12px;display:block"></i>
        <p>Start the conversation! Say hello.</p>
      </div>`;
    return;
  }

  let html = '';
  let lastDate = '';

  messages.forEach(msg => {
    const msgDate = new Date(msg.created_at).toLocaleDateString();
    if (msgDate !== lastDate) {
      lastDate = msgDate;
      const isToday = msgDate === new Date().toLocaleDateString();
      html += `<div class="chat-date-divider">${isToday ? 'Today' : msgDate}</div>`;
    }

    const isSent = msg.sender_id === currentUser.id;
    html += `
      <div class="chat-msg ${isSent ? 'sent' : 'received'}">
        <div class="chat-msg-avatar">
          ${msg.sender_avatar
            ? `<img src="${msg.sender_avatar}" alt="">`
            : (msg.sender_name || '?').charAt(0).toUpperCase()
          }
        </div>
        <div>
          <div class="chat-msg-bubble">${escapeHtml(msg.content)}</div>
          <div class="chat-msg-time">${formatTime(msg.created_at)}</div>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
  container.scrollTop = container.scrollHeight;
}

async function handleSendMessage(e) {
  e.preventDefault();
  const input = document.getElementById('chatInput');
  const content = input.value.trim();
  if (!content || !currentConversationId) return;

  input.value = '';

  try {
    const res = await fetch(`${API}/api/chat/conversations/${currentConversationId}/messages`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ content })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    // Append the new message
    const container = document.getElementById('chatMessages');
    // Remove empty state if present
    if (container.querySelector('.fa-hand-peace')) container.innerHTML = '';

    const msgDate = new Date(data.message.created_at).toLocaleDateString();
    const isToday = msgDate === new Date().toLocaleDateString();
    if (!container.querySelector('.chat-date-divider:last-of-type') || container.textContent.indexOf(isToday ? 'Today' : msgDate) === -1) {
      container.innerHTML += `<div class="chat-date-divider">${isToday ? 'Today' : msgDate}</div>`;
    }

    container.innerHTML += `
      <div class="chat-msg sent">
        <div class="chat-msg-avatar">
          ${currentUser.avatar_url
            ? `<img src="${currentUser.avatar_url}" alt="">`
            : currentUser.full_name.charAt(0).toUpperCase()
          }
        </div>
        <div>
          <div class="chat-msg-bubble">${escapeHtml(data.message.content)}</div>
          <div class="chat-msg-time">${formatTime(data.message.created_at)}</div>
        </div>
      </div>
    `;
    container.scrollTop = container.scrollHeight;

    // Show safety warning if suspicious content detected
    if (data.warning === 'safety_warning') {
      document.getElementById('chatSafetyTip').style.display = 'flex';
    }

    // Update sidebar preview
    const convItem = document.querySelector(`[data-conv-id="${currentConversationId}"]`);
    if (convItem) {
      const preview = convItem.querySelector('.conv-preview');
      if (preview) preview.textContent = content.substring(0, 60);
      const time = convItem.querySelector('.conv-time');
      if (time) time.textContent = 'Now';
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function startChatPolling(convId) {
  if (chatPollInterval) clearInterval(chatPollInterval);

  chatPollInterval = setInterval(async () => {
    if (currentConversationId !== convId) return;
    try {
      const res = await fetch(`${API}/api/chat/conversations/${convId}/messages`, { headers: getHeaders() });
      const data = await res.json();
      if (res.ok) {
        renderChatMessages(data.messages);
      }
    } catch (e) { /* silent */ }
  }, 5000); // Poll every 5 seconds
}

function closeChatMobile() {
  document.querySelector('.chat-layout').classList.remove('chat-open');
  document.getElementById('chatEmptyState').style.display = 'flex';
  document.getElementById('chatActive').style.display = 'none';
  currentConversationId = null;
  if (chatPollInterval) clearInterval(chatPollInterval);
}

async function loadChatBadge() {
  if (!currentUser) return;
  try {
    const res = await fetch(`${API}/api/chat/unread-count`, { headers: getHeaders() });
    const data = await res.json();
    updateChatBadge(data.count);
  } catch (e) { /* silent */ }
}

function updateChatBadge(count) {
  const badge = document.getElementById('chatBadge');
  if (badge) {
    if (count > 0) {
      badge.style.display = 'inline';
      badge.textContent = count > 99 ? '99+' : count;
    } else {
      badge.style.display = 'none';
    }
  }
}

// Initiate chat with a student (from applicant cards)
async function startChatWith(studentId, studentName, gigId) {
  if (!currentUser) return;

  const message = prompt(`Send a message to ${studentName}:`, `Hi ${studentName.split(' ')[0]}, I'd like to discuss a potential gig opportunity with you!`);
  if (message === null) return; // User cancelled

  try {
    const res = await fetch(`${API}/api/chat/conversations`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        student_id: studentId,
        gig_id: gigId || null,
        initial_message: message || null
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast('Chat started! 💬', 'success');
    navigate('messages', data.conversation_id);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function shortTime(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now - d;

  if (diff < 60000) return 'Now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h';
  if (diff < 604800000) return Math.floor(diff / 86400000) + 'd';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatTime(dateStr) {
  return new Date(dateStr).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

// ==========================================
//  Notifications
// ==========================================
async function loadNotifications() {
  if (!currentUser) return;

  try {
    const res = await fetch(`${API}/api/notifications`, { headers: getHeaders() });
    const data = await res.json();

    const badge = document.getElementById('notifBadge');
    if (data.unreadCount > 0) {
      badge.style.display = 'flex';
      badge.textContent = data.unreadCount > 99 ? '99+' : data.unreadCount;
    } else {
      badge.style.display = 'none';
    }

    const list = document.getElementById('notifList');
    if (data.notifications.length === 0) {
      list.innerHTML = '<p class="notif-empty">No notifications yet</p>';
      return;
    }

    list.innerHTML = data.notifications.map(n => `
      <div class="notif-item ${n.read ? '' : 'unread'}" onclick="markNotifRead(${n.id})">
        <h4>${n.title}</h4>
        <p>${escapeHtml(n.message)}</p>
        <div class="notif-time">${timeAgo(n.created_at)}</div>
      </div>
    `).join('');
  } catch (err) {
    console.error('Failed to load notifications');
  }
}

function toggleNotifications() {
  const panel = document.getElementById('notifPanel');
  panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}

async function markNotifRead(id) {
  try {
    await fetch(`${API}/api/notifications/read/${id}`, { method: 'PUT', headers: getHeaders() });
    loadNotifications();
  } catch (err) {}
}

async function markAllRead() {
  try {
    await fetch(`${API}/api/notifications/read-all`, { method: 'PUT', headers: getHeaders() });
    loadNotifications();
    showToast('All notifications marked as read', 'success');
  } catch (err) {}
}

// ==========================================
//  UI Helpers
// ==========================================
function showModal(id) {
  document.getElementById(id).classList.add('show');
  document.body.style.overflow = 'hidden';
}

function closeModal(id) {
  document.getElementById(id).classList.remove('show');
  document.body.style.overflow = '';
}

function switchModal(from, to) {
  closeModal(from);
  setTimeout(() => showModal(to), 200);
}

function toggleRegFields() {
  const role = document.querySelector('input[name="role"]:checked').value;
  document.getElementById('studentFields').style.display = role === 'student' ? 'block' : 'none';
  document.getElementById('employerFields').style.display = role === 'employer' ? 'block' : 'none';
}

function toggleUserMenu() {
  document.getElementById('userDropdown').classList.toggle('show');
}

function toggleMobileMenu() {
  document.getElementById('navLinks').classList.toggle('show');
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const icons = { success: 'fa-check-circle', error: 'fa-exclamation-circle', warning: 'fa-exclamation-triangle', info: 'fa-info-circle' };

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <i class="fas ${icons[type] || icons.info}"></i>
    <span>${message}</span>
    <button class="toast-close" onclick="this.parentElement.remove()"><i class="fas fa-times"></i></button>
  `;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ==========================================
//  Utility Functions
// ==========================================
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function formatCategory(cat) {
  if (!cat) return '';
  return cat.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function timeAgo(date) {
  const seconds = Math.floor((new Date() - new Date(date)) / 1000);
  const intervals = [
    { label: 'year', seconds: 31536000 },
    { label: 'month', seconds: 2592000 },
    { label: 'week', seconds: 604800 },
    { label: 'day', seconds: 86400 },
    { label: 'hour', seconds: 3600 },
    { label: 'minute', seconds: 60 }
  ];

  for (const interval of intervals) {
    const count = Math.floor(seconds / interval.seconds);
    if (count > 0) return `${count} ${interval.label}${count > 1 ? 's' : ''} ago`;
  }
  return 'Just now';
}

// ==========================================
//  Static Page Helpers
// ==========================================

function handleContactForm(e) {
  e.preventDefault();
  showToast('Message sent! We\'ll get back to you within 24 hours.', 'success');
  e.target.reset();
}

function filterHelpArticles() {
  const query = (document.getElementById('helpSearchInput')?.value || '').toLowerCase();
  document.querySelectorAll('.help-category').forEach(card => {
    const text = card.textContent.toLowerCase();
    card.style.display = text.includes(query) ? '' : 'none';
  });
}
