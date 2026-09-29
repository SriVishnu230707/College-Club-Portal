const $ = selector => document.querySelector(selector);
const state = { access: null, refresh: null, user: null, clubs: [], events: [], clubCursor: null, eventCursor: null };
let refreshPromise = null;

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function notice(message, error = false) {
  const box = $('#notice');
  box.textContent = message;
  box.style.background = error ? '#fff0ed' : '#e7f4ee';
  box.style.color = error ? '#a13d2b' : '#155d51';
  box.hidden = false;
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function request(path, { method = 'GET', body, raw = false, retry = true } = {}) {
  const headers = {};
  const usedAccess = state.access;
  if (state.access) headers.Authorization = `Bearer ${state.access}`;
  if (body !== undefined && !raw) headers['Content-Type'] = 'application/json';
  if (raw) headers['Content-Type'] = body.type;
  const response = await fetch(path, { method, headers, body: raw ? body : body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
  if (response.status === 401 && retry && state.refresh && path !== '/auth/refresh') {
    if (state.access !== usedAccess) return request(path, { method, body, raw, retry: false });
    refreshPromise ??= fetch('/auth/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: state.refresh }), cache: 'no-store' })
      .then(async refreshed => refreshed.ok ? refreshed.json() : null).finally(() => { refreshPromise = null; });
    const tokens = await refreshPromise;
    if (tokens) {
      state.access = tokens.accessToken;
      state.refresh = tokens.refreshToken;
      state.user = tokens.user;
      return request(path, { method, body, raw, retry: false });
    }
    clearSession();
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || Object.values(data.errors || {}).join('; ') || `Request failed (${response.status})`);
  }
  if (response.status === 204) return null;
  return response.json();
}

function clearSession() {
  state.access = state.refresh = state.user = null;
  updateNavigation();
  showView('discover');
}

function updateNavigation() {
  $('[data-view="mine"]').hidden = !state.user;
  $('[data-view="admin"]').hidden = state.user?.role !== 'admin';
  const actions = $('#account-actions');
  actions.replaceChildren();
  if (state.user) {
    actions.append(element('span', state.user.name, 'account-name'));
    const out = element('button', 'Log out', 'button ghost');
    out.onclick = async () => {
      try { await request('/auth/logout', { method: 'POST', body: { refreshToken: state.refresh } }); }
      catch { /* Clear local tokens even if the network is unavailable. */ }
      clearSession();
      notice('You have signed out.');
    };
    actions.append(out);
  } else {
    for (const [label, mode, cls] of [['Log in', 'login', 'ghost'], ['Join portal', 'register', 'primary']]) {
      const button = element('button', label, `button ${cls}`);
      button.onclick = () => authDialog(mode);
      actions.append(button);
    }
  }
}

function showView(name) {
  for (const view of ['discover', 'mine', 'admin']) {
    $(`#${view}-view`).hidden = view !== name;
    $(`[data-view="${view}"]`).classList.toggle('active', view === name);
  }
  if (name === 'mine') loadMine();
  if (name === 'admin') loadAdmin();
}

function authDialog(mode, token = '') {
  const dialog = $('#auth-dialog');
  const content = $('#auth-content');
  const details = {
    login: ['Welcome back', 'Log in to manage your clubs and events.', '<label>Email<input name="email" type="email" autocomplete="email" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label>', 'Log in'],
    register: ['Join the community', 'Create your student account.', '<label>Name<input name="name" minlength="2" maxlength="100" autocomplete="name" required></label><label>Email<input name="email" type="email" autocomplete="email" required></label><label>Password<input name="password" type="password" minlength="12" maxlength="128" autocomplete="new-password" required></label>', 'Create account'],
    forgot: ['Reset your password', 'We will send a reset link to your email.', '<label>Email<input name="email" type="email" autocomplete="email" required></label>', 'Send reset link'],
    reset: ['Choose a new password', 'Use at least 12 characters.', '<label>New password<input name="password" type="password" minlength="12" maxlength="128" autocomplete="new-password" required></label>', 'Reset password'],
    verify: ['Verify your email', 'Confirm your email address to join clubs and events.', '', 'Verify email']
  }[mode];
  content.innerHTML = `<h2 class="auth-title">${details[0]}</h2><p class="auth-hint">${details[1]}</p><form id="auth-form" class="form-stack">${details[2]}<button class="button primary">${details[3]}</button></form><div id="auth-links"></div>`;
  const links = $('#auth-links');
  if (mode === 'login') {
    const forgot = element('button', 'Forgot password?', 'auth-switch');
    forgot.onclick = () => authDialog('forgot');
    const join = element('button', 'Create an account', 'auth-switch');
    join.onclick = () => authDialog('register');
    links.append(forgot, element('br'), join);
  } else if (mode !== 'verify') {
    const back = element('button', 'Back to login', 'auth-switch');
    back.onclick = () => authDialog('login');
    links.append(back);
  }
  $('#auth-form').onsubmit = async event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      if (mode === 'login') {
        const data = await request('/auth/login', { method: 'POST', body: values });
        state.access = data.accessToken; state.refresh = data.refreshToken; state.user = data.user;
        updateNavigation();
        notice(`Welcome back, ${data.user.name}.`);
      } else if (mode === 'register') {
        await request('/auth/register', { method: 'POST', body: values });
        notice('Account created. Check the server terminal for your local verification link.');
      } else if (mode === 'forgot') {
        await request('/auth/password/forgot', { method: 'POST', body: values });
        notice('If the account exists, check the server terminal for a reset link.');
      } else if (mode === 'reset') {
        await request('/auth/password/reset', { method: 'POST', body: { ...values, token } });
        clearSession(); notice('Password updated. Log in again.');
      } else if (mode === 'verify') {
        await request('/auth/verification/confirm', { method: 'POST', body: { token } });
        notice('Email verified. You can now join clubs and events.');
      }
      dialog.close();
      if (mode === 'register' || mode === 'reset') authDialog('login');
    } catch (error) { notice(error.message, true); }
  };
  if (!dialog.open) dialog.showModal();
}

function actionButton(label, onClick, cls = 'outline') {
  const button = element('button', label, `button ${cls}`);
  button.onclick = async () => { button.disabled = true; try { await onClick(); } catch (error) { notice(error.message, true); } finally { button.disabled = false; } };
  return button;
}

function renderClubs() {
  const box = $('#club-list'); box.replaceChildren();
  if (!state.clubs.length) box.append(element('p', 'No published clubs yet. Check back soon.'));
  for (const club of state.clubs) {
    const card = element('article', undefined, 'card');
    card.append(element('span', 'CLUB', 'tag'), element('h3', club.name), element('p', club.description || 'A campus community waiting for you.'));
    const actions = element('div', undefined, 'card-actions');
    actions.append(actionButton('Request to join', async () => {
      if (!state.user) return authDialog('login');
      const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/jpeg,image/png,image/webp';
      input.onchange = async () => {
        const file = input.files[0]; if (!file) return;
        try { await request(`/clubs/${club.id}/join`, { method: 'POST', body: file, raw: true }); notice('Request sent. An admin will review your ID card.'); }
        catch (error) { notice(error.message, true); }
      };
      input.click();
    }));
    card.append(actions); box.append(card);
  }
}

function renderEvents() {
  const box = $('#event-list'); box.replaceChildren();
  if (!state.events.length) box.append(element('p', 'No upcoming published events yet.'));
  for (const item of state.events) {
    const card = element('article', undefined, 'card');
    card.append(element('span', item.audience === 'all_members' ? 'ALL MEMBERS' : 'CLUB MEMBERS', 'tag'), element('h3', item.title),
      element('p', item.description || 'Join your campus community.'),
      element('div', `${new Date(item.startsAt).toLocaleString()} · ${item.location} · ${item.registeredCount}/${item.capacity} places`, 'event-meta'));
    card.append(actionButton('Register', async () => {
      if (!state.user) return authDialog('login');
      await request(`/events/${item.id}/register`, { method: 'POST' });
      notice('You are registered for this event.'); await loadEvents(true);
    }, 'primary'));
    box.append(card);
  }
}

async function loadClubs(reset = false) {
  const data = await request(`/clubs?limit=30${!reset && state.clubCursor ? `&cursor=${encodeURIComponent(state.clubCursor)}` : ''}`);
  state.clubs = reset ? data.clubs : [...state.clubs, ...data.clubs]; state.clubCursor = data.nextCursor;
  $('#more-clubs').hidden = !data.nextCursor; renderClubs();
}
async function loadEvents(reset = false) {
  const data = await request(`/events?limit=30${!reset && state.eventCursor ? `&cursor=${encodeURIComponent(state.eventCursor)}` : ''}`);
  state.events = reset ? data.events : [...state.events, ...data.events]; state.eventCursor = data.nextCursor;
  $('#more-events').hidden = !data.nextCursor; renderEvents();
}

async function loadMine() {
  if (!state.user) return;
  try {
    const [status, clubs, events] = await Promise.all([request('/auth/status'), request('/clubs/mine'), request('/events/mine')]);
    const profile = $('#profile-card'); profile.replaceChildren();
    profile.append(element('h3', state.user.name), element('p', `${state.user.email} · ${state.user.role}`), element('span', status.emailVerified ? 'Email verified' : 'Email not verified', 'tag'));
    const edit = element('form', undefined, 'form-stack');
    const label = element('label', 'Display name');
    const input = document.createElement('input'); input.name = 'name'; input.value = state.user.name; input.minLength = 2; input.maxLength = 100; input.required = true;
    label.append(input); edit.append(label, element('button', 'Save name', 'button outline'));
    edit.onsubmit = async event => {
      event.preventDefault();
      try { const result = await request('/auth/profile', { method: 'PATCH', body: { name: input.value } }); state.user = result.user; updateNavigation(); notice('Name updated.'); loadMine(); }
      catch (error) { notice(error.message, true); }
    };
    profile.append(edit);
    if (!status.emailVerified) profile.append(actionButton('Send verification link', async () => {
      await request('/auth/verification/request', { method: 'POST', body: { email: state.user.email } });
      notice('Check the server terminal for your verification link.');
    }));
    const myClubs = $('#my-clubs'); myClubs.replaceChildren();
    if (!clubs.clubs.length) myClubs.append(element('p', 'No approved clubs yet.'));
    for (const club of clubs.clubs) {
      const row = element('div', undefined, 'list-item'); row.append(element('h4', club.name));
      row.append(actionButton('Leave club', async () => { await request(`/clubs/${club.id}/membership`, { method: 'DELETE' }); notice('You left the club.'); loadMine(); })); myClubs.append(row);
    }
    const myEvents = $('#my-events'); myEvents.replaceChildren();
    if (!events.events.length) myEvents.append(element('p', 'No event registrations yet.'));
    for (const item of events.events) {
      const row = element('div', undefined, 'list-item'); row.append(element('h4', item.title), element('p', new Date(item.startsAt).toLocaleString()));
      if (item.status !== 'cancelled' && new Date(item.startsAt) > new Date()) row.append(actionButton('Cancel place', async () => {
        await request(`/events/${item.id}/registration`, { method: 'DELETE' }); notice('Registration cancelled.'); loadMine();
      }));
      myEvents.append(row);
    }
  } catch (error) { notice(error.message, true); }
}

async function loadAdmin() {
  if (state.user?.role !== 'admin') return;
  try {
    const [clubs, events, users] = await Promise.all([request('/admin/clubs?limit=100'), request('/admin/events?limit=100'), request('/admin/users?limit=100')]);
    const select = $('#event-club'); select.replaceChildren();
    for (const club of clubs.clubs.filter(club => club.status === 'published')) {
      const option = element('option', club.name); option.value = club.id; select.append(option);
    }
    const clubBox = $('#admin-clubs'); clubBox.replaceChildren();
    for (const club of clubs.clubs) {
      const row = element('div', undefined, 'list-item'); row.append(element('h4', `${club.name} · ${club.status}`));
      if (club.status !== 'published') row.append(actionButton('Publish club', async () => {
        await request(`/admin/clubs/${club.id}`, { method: 'PATCH', body: { status: 'published' } });
        notice('Club published.'); loadAdmin(); loadClubs(true);
      }, 'primary'));
      if (club.status === 'published') row.append(actionButton('Archive club', async () => {
        await request(`/admin/clubs/${club.id}`, { method: 'PATCH', body: { status: 'archived' } });
        notice('Club archived.'); loadAdmin(); loadClubs(true);
      }));
      row.append(actionButton('Review join requests', async () => {
        const data = await request(`/admin/clubs/${club.id}/requests`);
        row.querySelector('.requests')?.remove();
        const list = element('div', undefined, 'requests');
        if (!data.requests.length) list.append(element('p', 'No pending requests.'));
        for (const entry of data.requests) {
          const item = element('div', undefined, 'list-item'); item.append(element('p', `${entry.user.name} · ${entry.user.email}`));
          item.append(actionButton('View ID card', async () => {
            const response = await fetch(`/admin/join-requests/${entry.id}/id-card`, { headers: { Authorization: `Bearer ${state.access}` }, cache: 'no-store' });
            if (!response.ok) throw new Error('Could not open ID card');
            const url = URL.createObjectURL(await response.blob());
            const link = document.createElement('a'); link.href = url; link.download = 'college-id-card.jpg'; link.click();
            setTimeout(() => URL.revokeObjectURL(url), 60_000);
          }));
          for (const decision of ['approve', 'reject']) item.append(actionButton(decision === 'approve' ? 'Approve' : 'Reject', async () => {
            await request(`/admin/join-requests/${entry.id}/${decision}`, { method: 'POST' }); notice(`Request ${decision === 'approve' ? 'approved' : 'rejected'}.`); loadAdmin();
          }, decision === 'approve' ? 'primary' : 'outline'));
          list.append(item);
        }
        row.append(list);
      })); clubBox.append(row);
    }
    const eventBox = $('#admin-events'); eventBox.replaceChildren();
    for (const item of events.events) {
      const row = element('div', undefined, 'list-item'); row.append(element('h4', `${item.title} · ${item.status}`), element('p', `${new Date(item.startsAt).toLocaleString()} · ${item.registeredCount}/${item.capacity} places`));
      if (item.status === 'draft') row.append(actionButton('Publish event', async () => {
        await request(`/admin/events/${item.id}`, { method: 'PATCH', body: { status: 'published' } });
        notice('Event published.'); loadAdmin(); loadEvents(true);
      }, 'primary'));
      row.append(actionButton('View attendees', async () => {
        const data = await request(`/admin/events/${item.id}/attendees`);
        row.querySelector('.attendees')?.remove();
        const list = element('div', undefined, 'attendees');
        list.append(element('p', data.attendees.length ? data.attendees.map(a => `${a.name} (${a.email})`).join(' · ') : 'No attendees yet.'));
        row.append(list);
      }));
      if (item.status !== 'cancelled') row.append(actionButton('Cancel event', async () => {
        await request(`/admin/events/${item.id}`, { method: 'PATCH', body: { status: 'cancelled' } }); notice('Event cancelled.'); loadAdmin();
      }));
      eventBox.append(row);
    }
    const userBox = $('#admin-users'); userBox.replaceChildren();
    for (const user of users.users) {
      const row = element('div', undefined, 'list-item');
      row.append(element('h4', `${user.name} · ${user.role}`), element('p', user.email));
      userBox.append(row);
    }
  } catch (error) { notice(error.message, true); }
}

for (const tab of document.querySelectorAll('[data-view]')) tab.onclick = () => showView(tab.dataset.view);
$('#hero-action').onclick = () => $('#discover-view').scrollIntoView({ behavior: 'smooth' });
$('#reload-clubs').onclick = () => loadClubs(true).catch(error => notice(error.message, true));
$('#reload-events').onclick = () => loadEvents(true).catch(error => notice(error.message, true));
$('#more-clubs').onclick = () => loadClubs().catch(error => notice(error.message, true));
$('#more-events').onclick = () => loadEvents().catch(error => notice(error.message, true));
$('#club-form').onsubmit = async event => {
  event.preventDefault();
  try { await request('/admin/clubs', { method: 'POST', body: Object.fromEntries(new FormData(event.currentTarget)) }); event.currentTarget.reset(); notice('Club created.'); loadAdmin(); loadClubs(true); }
  catch (error) { notice(error.message, true); }
};
$('#event-form').onsubmit = async event => {
  event.preventDefault();
  const form = event.currentTarget, data = Object.fromEntries(new FormData(form));
  data.startsAt = new Date(data.startsAt).toISOString(); data.endsAt = new Date(data.endsAt).toISOString(); data.capacity = Number(data.capacity);
  try { await request('/admin/events', { method: 'POST', body: data }); form.reset(); notice('Event created.'); loadAdmin(); loadEvents(true); }
  catch (error) { notice(error.message, true); }
};
updateNavigation();
Promise.all([loadClubs(true), loadEvents(true)]).catch(error => notice(error.message, true));
const params = new URLSearchParams(location.search);
if (['verify', 'reset'].includes(params.get('action')) && params.get('token')) {
  authDialog(params.get('action'), params.get('token'));
  history.replaceState(null, '', '/');
}
