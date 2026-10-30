(() => {
  const $ = (id) => document.getElementById(id);
  const config = window.ATLAS_CONFIG || {};
  const usernameEmail = (username) => `${username.toLowerCase()}@atlas.invalid`;
  let client = null;
  let currentUser = null;
  let adminUsers = [];
  let adminEvidence = [];
  let saveTimer = null;
  let passwordMode = 'self';
  let passwordTarget = null;
  let activeChallengeForEvidence = null;
  let lastSelectedAdmin = null;

  function authMessage(message, type = 'error') {
    const el = $('authMessage');
    el.textContent = message || '';
    el.className = 'auth-message' + (type === 'success' ? ' success' : '');
  }
  function setAuthBusy(busy, label) {
    const button = $('authSubmit');
    button.disabled = busy;
    button.textContent = busy ? 'Conectando…' : (label || (isRegisterMode ? 'Crear cuenta' : 'Entrar'));
  }
  let isRegisterMode = false;
  function renderAuthMode() {
    $('authEyebrow').textContent = isRegisterMode ? 'REGISTRO DE JUGADOR' : 'ACCESO DE JUGADOR';
    $('authTitle').textContent = isRegisterMode ? 'Crear cuenta' : 'Bienvenido al Atlas';
    $('authIntro').textContent = isRegisterMode
      ? 'Crea un perfil con un nombre de usuario. No necesitas indicar tu correo electrónico.'
      : 'Entra con tu nombre de usuario para continuar tu campaña y sincronizar tus logros.';
    $('authConfirmWrap').classList.toggle('hidden', !isRegisterMode);
    $('authPassword').setAttribute('autocomplete', isRegisterMode ? 'new-password' : 'current-password');
    $('passwordWarning').style.display = isRegisterMode ? 'block' : 'none';
    $('authSubmit').textContent = isRegisterMode ? 'Crear cuenta' : 'Entrar';
    $('authSwitch').textContent = isRegisterMode ? 'Ya tengo una cuenta. Volver al acceso' : '¿Aún no tienes cuenta? Crear una';
    authMessage('');
  }
  function validateUsername(value) {
    const username = value.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(username)) {
      throw new Error('El usuario debe tener entre 3 y 20 caracteres: letras sin acentos, números o guion bajo.');
    }
    return username;
  }
  function friendlyAuthError(message) {
    const m = String(message || '').toLowerCase();
    if (m.includes('already registered') || m.includes('already been registered')) return 'Ese nombre de usuario ya existe. Prueba otro.';
    if (m.includes('invalid login credentials')) return 'Usuario o contraseña incorrectos.';
    if (m.includes('password should be') || m.includes('at least')) return 'La contraseña debe tener al menos 10 caracteres.';
    if (m.includes('email') && (m.includes('invalid') || m.includes('valid'))) return 'Supabase ha rechazado el identificador interno. Revisa la configuración de autenticación indicada en el README.';
    return message || 'No se pudo completar la operación.';
  }
  async function handleAuthSubmit() {
    if (!client) return;
    setAuthBusy(true);
    try {
      const username = validateUsername($('authUsername').value);
      const password = $('authPassword').value;
      if (!password) throw new Error('Escribe tu contraseña.');
      if (isRegisterMode) {
        if (password.length < 10) throw new Error('Usa una contraseña de al menos 10 caracteres.');
        if (password !== $('authConfirm').value) throw new Error('Las dos contraseñas no coinciden.');
        const { data, error } = await client.auth.signUp({
          email: usernameEmail(username),
          password,
          options: { data: { username } }
        });
        if (error) throw error;
        if (!data.session) {
          throw new Error('La cuenta se creó, pero Supabase no inició sesión. En el panel de Supabase desactiva «Confirm email» para el proveedor Email; este proyecto no utiliza correos reales.');
        }
        authMessage('Cuenta creada. Entrando al Atlas…', 'success');
        await enterApp(data.session);
      } else {
        const { data, error } = await client.auth.signInWithPassword({ email: usernameEmail(username), password });
        if (error) throw error;
        await enterApp(data.session);
      }
    } catch (error) {
      authMessage(friendlyAuthError(error.message));
    } finally {
      setAuthBusy(false);
    }
  }

  async function loadCloudProgress() {
    const { data, error } = await client.from('atlas_progress').select('tree_done, challenge_done, profile_seal, updated_at').eq('user_id', currentUser.id).maybeSingle();
    if (error) throw error;
    done = data?.tree_done && typeof data.tree_done === 'object' ? data.tree_done : {};
    challengeDone = data?.challenge_done && typeof data.challenge_done === 'object' ? data.challenge_done : {};
    profileSeal = data?.profile_seal || ('AX-' + Math.random().toString(36).slice(2, 8).toUpperCase());
    try {
      localStorage.setItem('atlas_progress_v1', JSON.stringify(done));
      localStorage.setItem('atlas_challenges_v2', JSON.stringify(challengeDone));
      localStorage.setItem('atlas_profile_seal_v2', profileSeal);
    } catch (_) { /* El servidor sigue siendo la copia principal. */ }
    renderNav();
    renderTree();
    updateProgress();
    renderChallenges();
    renderAchievementCard();
    queueSave();
  }
  function queueSave() {
    if (!currentUser || !client) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveCloudProgress, 550);
  }
  async function saveCloudProgress() {
    if (!currentUser || !client) return;
    const payload = {
      user_id: currentUser.id,
      tree_done: done,
      challenge_done: challengeDone,
      profile_seal: profileSeal,
      updated_at: new Date().toISOString()
    };
    const { error } = await client.from('atlas_progress').upsert(payload, { onConflict: 'user_id' });
    if (error) {
      console.error('No se pudo sincronizar el progreso:', error);
      if (typeof showToast === 'function') showToast('No se pudo sincronizar. Comprueba la conexión.');
    }
  }
  async function enterApp(session) {
    currentUser = session.user;
    // Refresh app metadata after an administrator role has been granted in Supabase.
    const { data: userData } = await client.auth.getUser();
    if (userData?.user) currentUser = userData.user;
    const isAdmin = currentUser.app_metadata?.role === 'admin';
    try {
      await loadCloudProgress();
    } catch (error) {
      console.error(error);
      currentUser = null;
      await client.auth.signOut();
      authMessage('No se pudo cargar tu progreso desde Supabase. Comprueba que has ejecutado supabase/schema.sql y vuelve a intentarlo.');
      return;
    }
    $('accountName').textContent = currentUser.user_metadata?.username || currentUser.email?.split('@')[0] || 'Jugador';
    $('accountChip').hidden = false;
    $('adminTab').hidden = !isAdmin;
    $('authScreen').style.display = 'none';
    $('atlasApp').style.visibility = 'visible';
    if (isAdmin) loadAdmin();
  }
  async function signOut() {
    if (currentUser) await saveCloudProgress();
    await client.auth.signOut();
    currentUser = null;
    $('accountChip').hidden = true;
    $('adminTab').hidden = true;
    $('atlasApp').style.visibility = 'hidden';
    $('authScreen').style.display = 'grid';
    $('authPassword').value = '';
    $('authConfirm').value = '';
    $('authUsername').value = '';
    isRegisterMode = false;
    renderAuthMode();
    authMessage('Sesión cerrada.', 'success');
  }

  function openPasswordModal(mode, target = null) {
    passwordMode = mode;
    passwordTarget = target;
    const reset = mode === 'admin-reset';
    $('passwordModalTitle').textContent = reset ? `Restablecer contraseña de ${target.username}` : 'Cambiar mi contraseña';
    $('passwordModalDesc').textContent = reset
      ? 'Escribe una contraseña temporal nueva y entrégasela al jugador por un canal privado. La contraseña anterior no se puede consultar.'
      : 'Elige una contraseña nueva que no uses en ninguna otra cuenta.';
    $('passwordNew').value = '';
    $('passwordConfirm').value = '';
    $('passwordModal').classList.remove('hidden');
  }
  function closePasswordModal() { $('passwordModal').classList.add('hidden'); passwordTarget = null; }
  async function savePassword() {
    const password = $('passwordNew').value;
    const confirm = $('passwordConfirm').value;
    if (password.length < 10) return showToast('Usa al menos 10 caracteres.');
    if (password !== confirm) return showToast('Las contraseñas no coinciden.');
    const button = $('passwordSave'); button.disabled = true; button.textContent = 'Guardando…';
    try {
      if (passwordMode === 'admin-reset') {
        const { data, error } = await client.functions.invoke('admin-tools', {
          body: { action: 'reset-password', userId: passwordTarget.user_id, newPassword: password }
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        showToast('Contraseña restablecida. Entrégala al jugador de forma privada.');
      } else {
        const { error } = await client.auth.updateUser({ password });
        if (error) throw error;
        showToast('Tu contraseña se ha actualizado.');
      }
      closePasswordModal();
    } catch (error) {
      showToast(friendlyAuthError(error.message));
    } finally {
      button.disabled = false; button.textContent = 'Guardar contraseña';
    }
  }

  function countDone(treeDone) {
    let completed = 0;
    for (const tree of trees) for (const node of tree.nodes) if (treeDone?.[tree.id]?.[node.id]) completed++;
    return completed;
  }
  function countAllNodes() { return trees.reduce((sum, tree) => sum + tree.nodes.length, 0); }
  function countChallenges(chDone) { return Array.isArray(window.atlasChallengeIds) ? window.atlasChallengeIds.filter(id => !!chDone?.[id]).length : Object.keys(chDone || {}).length; }
  function safeDate(value) {
    if (!value) return 'Sin actividad';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? 'Sin actividad' : d.toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
  }
  async function invokeAdmin(action, payload = {}) {
    const { data, error } = await client.functions.invoke('admin-tools', { body: { action, ...payload } });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data;
  }
  async function loadAdmin() {
    if (!currentUser || currentUser.app_metadata?.role !== 'admin') return;
    $('adminStatus').textContent = 'Actualizando…';
    try {
      const data = await invokeAdmin('list-users');
      adminUsers = data.users || [];
      adminEvidence = data.evidence || [];
      renderAdmin();
      $('adminStatus').textContent = 'Actualizado ' + new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    } catch (error) {
      console.error(error);
      $('adminStatus').textContent = 'Error al cargar los datos';
      showToast(friendlyAuthError(error.message));
    }
  }
  function renderAdmin() {
    const body = $('adminUsersBody');
    body.innerHTML = '';
    const totalNodes = countAllNodes();
    let sumPct = 0;
    $('adminUserCount').textContent = adminUsers.length;
    if (!adminUsers.length) body.innerHTML = '<tr><td colspan="5">No hay perfiles registrados.</td></tr>';
    for (const entry of adminUsers) {
      const p = entry.progress || {};
      const doneCount = countDone(p.tree_done || {});
      const pct = totalNodes ? Math.round(doneCount / totalNodes * 100) : 0;
      sumPct += pct;
      const chCount = countChallenges(p.challenge_done || {});
      const tr = document.createElement('tr');
      tr.innerHTML = `<td><b>${esc(entry.username)}</b>${entry.is_admin ? ' <small>· ADMIN</small>' : ''}</td><td>${pct}% <small>(${doneCount}/${totalNodes})</small></td><td>${chCount}/90</td><td>${safeDate(p.updated_at || entry.created_at)}</td><td><button type="button" data-action="inspect" data-id="${esc(entry.user_id)}">Ver progreso</button><button type="button" class="danger" data-action="reset" data-id="${esc(entry.user_id)}" data-name="${esc(entry.username)}">Restablecer contraseña</button></td>`;
      body.appendChild(tr);
    }
    $('adminAverage').textContent = adminUsers.length ? Math.round(sumPct / adminUsers.length) + '%' : '0%';
    const pending = adminEvidence.filter(e => e.status === 'pending');
    $('adminEvidenceCount').textContent = pending.length;
    renderEvidence();
  }
  function renderEvidence() {
    const body = $('adminEvidenceBody'); body.innerHTML = '';
    if (!adminEvidence.length) { body.innerHTML = '<tr><td colspan="5">Todavía no hay evidencias cargadas.</td></tr>'; return; }
    for (const ev of adminEvidence) {
      const tr = document.createElement('tr');
      const status = ev.status === 'approved' ? 'Verificada' : ev.status === 'rejected' ? 'Rechazada' : 'Pendiente';
      tr.innerHTML = `<td>${esc(ev.username || 'Jugador')}</td><td>${esc(ev.challenge_title || ev.challenge_id)}</td><td>${safeDate(ev.submitted_at)}</td><td>${status}</td><td><button data-evidence="open" data-id="${esc(ev.id)}">Ver captura</button>${ev.status === 'pending' ? `<button data-evidence="approve" data-id="${esc(ev.id)}">Aprobar</button><button class="danger" data-evidence="reject" data-id="${esc(ev.id)}">Rechazar</button>` : ''}</td>`;
      body.appendChild(tr);
    }
  }
  function inspectUser(userId) {
    const entry = adminUsers.find(u => u.user_id === userId);
    if (!entry) return;
    lastSelectedAdmin = userId;
    const progress = entry.progress || {};
    const treeRoot = $('adminTreeDetails'); treeRoot.innerHTML = '';
    const list = document.createElement('div'); list.className = 'tree-progress-list';
    for (const tree of trees) {
      const completed = tree.nodes.filter(n => progress.tree_done?.[tree.id]?.[n.id]).length;
      const pct = Math.round(completed / tree.nodes.length * 100);
      const row = document.createElement('div'); row.className = 'tree-progress-row';
      row.innerHTML = `<div><b>${esc(tree.title)}</b><small>${completed}/${tree.nodes.length} · ${pct}%</small></div><div class="progressbar"><span style="width:${pct}%"></span></div>`;
      list.appendChild(row);
    }
    treeRoot.appendChild(list);
    const ch = challenges.filter(c => progress.challenge_done?.[c.id]);
    $('adminChallengeDetails').innerHTML = `<h3 class="admin-subheading">Desafíos completados (${ch.length}/90)</h3><div class="challenge-admin-list">${ch.length ? ch.map(c => `<span class="challenge-admin-pill">${esc(c.id)} · ${esc(c.title)}</span>`).join('') : '<span class="admin-detail-empty">Todavía no hay desafíos completados.</span>'}</div>`;
    $('adminUserDetails').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  async function reviewEvidence(id, status) {
    try {
      await invokeAdmin('review-evidence', { evidenceId: id, status });
      showToast(status === 'approved' ? 'Evidencia verificada.' : 'Evidencia rechazada.');
      await loadAdmin();
    } catch (error) { showToast(friendlyAuthError(error.message)); }
  }
  async function openEvidence(id) {
    try {
      const data = await invokeAdmin('evidence-url', { evidenceId: id });
      if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
      else showToast('No se pudo generar el enlace de la captura.');
    } catch (error) { showToast(friendlyAuthError(error.message)); }
  }
  async function submitEvidence() {
    const file = $('challengeEvidenceFile').files?.[0];
    if (!file || !activeChallengeForEvidence || !currentUser) return showToast('Selecciona primero una captura.');
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return showToast('Usa PNG, JPG o WEBP.');
    if (file.size > 8 * 1024 * 1024) return showToast('La captura no puede superar los 8 MB.');
    const status = $('evidenceStatus'); status.textContent = 'Subiendo captura…'; status.classList.remove('success');
    $('submitEvidenceBtn').disabled = true;
    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-70) || 'captura.png';
      const objectPath = `${currentUser.id}/${activeChallengeForEvidence.id}/${Date.now()}-${safeName}`;
      const { error: uploadError } = await client.storage.from('atlas-evidence').upload(objectPath, file, { upsert: false, contentType: file.type });
      if (uploadError) throw uploadError;
      const { error: insertError } = await client.from('atlas_evidence').insert({
        user_id: currentUser.id,
        challenge_id: activeChallengeForEvidence.id,
        challenge_title: activeChallengeForEvidence.title,
        object_path: objectPath
      });
      if (insertError) throw insertError;
      status.textContent = 'Captura enviada. Está pendiente de revisión por xfriskxev.';
      status.classList.add('success');
      $('challengeEvidenceFile').value = '';
      showToast('Evidencia enviada al administrador.');
    } catch (error) {
      console.error(error);
      status.textContent = 'No se pudo enviar. Comprueba que el SQL y el bucket estén configurados.';
      showToast(friendlyAuthError(error.message));
    } finally { $('submitEvidenceBtn').disabled = false; }
  }

  function showEvidenceInChallengeModal(challenge) {
    activeChallengeForEvidence = challenge;
    $('challengeEvidenceFile').value = '';
    $('evidenceStatus').textContent = 'La captura solo será visible para el administrador.';
    $('evidenceStatus').classList.remove('success');
  }

  function bindCloudUi() {
    $('authSubmit').addEventListener('click', handleAuthSubmit);
    $('authSwitch').addEventListener('click', () => { isRegisterMode = !isRegisterMode; renderAuthMode(); });
    $('authPassword').addEventListener('keydown', (e) => { if (e.key === 'Enter') handleAuthSubmit(); });
    $('authConfirm').addEventListener('keydown', (e) => { if (e.key === 'Enter' && isRegisterMode) handleAuthSubmit(); });
    $('logoutBtn').addEventListener('click', signOut);
    $('changePasswordBtn').addEventListener('click', () => openPasswordModal('self'));
    $('passwordSave').addEventListener('click', savePassword);
    $('passwordModalClose').addEventListener('click', closePasswordModal);
    $('passwordCancel').addEventListener('click', closePasswordModal);
    $('passwordModal').addEventListener('click', (e) => { if (e.target.id === 'passwordModal') closePasswordModal(); });
    $('adminRefresh').addEventListener('click', loadAdmin);
    $('adminUsersBody').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]'); if (!btn) return;
      if (btn.dataset.action === 'inspect') inspectUser(btn.dataset.id);
      if (btn.dataset.action === 'reset') openPasswordModal('admin-reset', { user_id: btn.dataset.id, username: btn.dataset.name });
    });
    $('adminEvidenceBody').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-evidence]'); if (!btn) return;
      if (btn.dataset.evidence === 'open') openEvidence(btn.dataset.id);
      if (btn.dataset.evidence === 'approve') reviewEvidence(btn.dataset.id, 'approved');
      if (btn.dataset.evidence === 'reject') reviewEvidence(btn.dataset.id, 'rejected');
    });
    $('submitEvidenceBtn').addEventListener('click', submitEvidence);
    const oldShowChallengeModal = window.showChallengeModal;
    // Wrap the existing modal through the globally declared function binding.
    if (typeof showChallengeModal === 'function') {
      const original = showChallengeModal;
      showChallengeModal = function(challenge, proof) {
        original(challenge, proof);
        showEvidenceInChallengeModal(challenge);
      };
    }
  }

  async function init() {
    bindCloudUi();
    renderAuthMode();
    if (!config.SUPABASE_URL || !config.SUPABASE_ANON_KEY || config.SUPABASE_URL.includes('TU-PROYECTO') || config.SUPABASE_ANON_KEY.includes('TU_')) {
      authMessage('Falta configurar config.js con la URL y la publishable/anon key de tu proyecto Supabase. Sigue el README.', 'error');
      $('authSubmit').disabled = true;
      $('authSwitch').disabled = true;
      return;
    }
    if (!window.supabase?.createClient) {
      authMessage('No se pudo cargar el SDK de Supabase. Comprueba tu conexión e inténtalo de nuevo.');
      return;
    }
    client = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    const { data, error } = await client.auth.getSession();
    if (error) authMessage(error.message);
    if (data?.session) await enterApp(data.session);
  }

  window.atlasCloud = {
    queueSave,
    loadAdmin,
    get currentUser() { return currentUser; }
  };
  window.addEventListener('atlas:challenge-modal', (event) => showEvidenceInChallengeModal(event.detail));
  document.addEventListener('DOMContentLoaded', init);
})();
