const $ = (selector) => document.querySelector(selector);
let activeUser = null;
let generation = 0;
let savedProfile = null;

function showProfile(profile) {
  savedProfile = profile;
  $('#profileForm').hidden = !!profile;
  $('#profileSaved').hidden = !profile;
  if (profile) {
    $('#profileUsernameValue').textContent = profile.username;
    $('#profileGradeValue').textContent = profile.grade;
    $('#profileAgeValue').textContent = String(profile.age);
  }
}

export async function loadProfile(user) {
  activeUser = user;
  const request = ++generation;
  savedProfile = null;
  $('#profileSection').hidden = !user;
  $('#profileForm').reset();
  $('#profileForm').hidden = true;
  $('#profileSaved').hidden = true;
  $('#profileUsernameValue').textContent = '';
  $('#profileGradeValue').textContent = '';
  $('#profileAgeValue').textContent = '';
  $('#profileRetry').hidden = true;
  if (!user) return;
  $('#profileStatus').textContent = 'Loading profile…';
  try {
    const response = await fetch('/api/profile', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000) });
    const result = await response.json();
    if (request !== generation) return;
    if (!response.ok) throw new Error(result.error || 'Could not load profile.');
    showProfile(result.profile);
    $('#profileFields').disabled = false;
    $('#profileStatus').textContent = '';
  } catch (error) {
    if (request !== generation) return;
    $('#profileStatus').textContent = error.message;
    $('#profileRetry').hidden = false;
  }
}
$('#profileRetry').addEventListener('click', () => loadProfile(activeUser));
$('#profileForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!activeUser || savedProfile || $('#profileFields').disabled) return;
  if (!$('#profileForm').reportValidity()) return;
  const request = generation;
  const profile = { username: $('#profileUsername').value.trim(), grade: $('#profileGrade').value.trim(), age: Number($('#profileAge').value) };
  if (profile.username.length < 2 || !profile.grade) { $('#profileStatus').textContent = 'Enter a username and grade.'; return; }
  $('#profileFields').disabled = true;
  $('#profileStatus').textContent = 'Saving…';
  try {
    const response = await fetch('/api/profile', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profile), signal: AbortSignal.timeout(15000) });
    const result = await response.json();
    if (request !== generation) return;
    if (!response.ok && !(response.status === 409 && result.profile)) throw new Error(result.error || 'Could not save profile.');
    showProfile(result.profile);
    $('#profileForm').reset();
    $('#profileStatus').textContent = 'Saved';
    $('#profileSaved').focus();
  } catch (error) {
    if (request === generation) $('#profileStatus').textContent = error.message;
  } finally {
    if (request === generation) $('#profileFields').disabled = false;
  }
});
