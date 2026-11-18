import { firebaseConfig } from './gateway-config.js';

const el = id => document.getElementById(id);
const projectNames = new Map();
const scopes = [...el('scopes').querySelectorAll('input')];
const sdk = 'https://www.gstatic.com/firebasejs/12.7.0/';
const status = message => { el('status').textContent = message; };
function projectUrl(text) {
  const url = new URL(text);
  if (url.protocol !== 'https:' || url.username || url.password) throw Error('Enter an HTTPS application URL.');
  return url.href;
}
function card(project, access) {
  const item = document.createElement('article');
  item.className = 'card';
  const link = document.createElement('a');
  link.href = projectUrl(project.url);
  link.textContent = project.name;
  const note = document.createElement('small');
  note.textContent = access;
  item.append(link, note);
  return item;
}
async function start() {
  if (!firebaseConfig.apiKey || !firebaseConfig.authDomain || !firebaseConfig.projectId || !firebaseConfig.appId) {
    throw Error('Google sign-in has not been configured for this gateway.');
  }
  const [{ initializeApp }, { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut },
    { getFirestore, doc, collection, getDocFromServer, onSnapshot, setDoc, addDoc, runTransaction }] =
    await Promise.all(['firebase-app.js', 'firebase-auth.js', 'firebase-firestore.js'].map(file => import(sdk + file)));
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app), db = getFirestore(app);
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const members = collection(db, 'gatewayMembers'), projects = collection(db, 'gatewayProjects');
  let listeners = [], stopGrant = () => {}, session = 0, render = 0, selection = 0;
  let loadedGrant = null, owner = false;

  function resetGrant() {
    selection++;
    stopGrant(); stopGrant = () => {};
    loadedGrant = null;
    scopes.forEach(input => { input.checked = false; });
    el('scopes').disabled = el('saveAccess').disabled = el('revoke').disabled = true;
  }
  function selectGrant() {
    resetGrant();
    const email = el('employee').value.trim().toLowerCase(), key = el('project').value;
    if (!owner || !email || !el('employee').validity.valid || email.includes('/') || !key) {
      el('grantStatus').textContent = 'Select an employee and a project.'; return;
    }
    const current = selection, ref = doc(members, email, 'projects', key);
    el('grantStatus').textContent = 'Loading current access…';
    stopGrant = onSnapshot(ref, {includeMetadataChanges:true}, snapshot => {
      if (current !== selection || snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
      const edit = snapshot.exists() ? snapshot.data().edit : null;
      loadedGrant = { email, ref, edit };
      scopes.forEach(input => { input.checked = edit?.includes(input.value) ?? false; });
      el('scopes').disabled = el('saveAccess').disabled = false;
      el('revoke').disabled = !snapshot.exists();
      el('grantStatus').textContent = edit === null ? 'No project access.' : edit.length ? 'Editing access assigned.' : 'Read-only access assigned.';
    }, () => { if (current === selection) { resetGrant(); el('grantStatus').textContent = 'Could not read access. Select the account again.'; } });
  }
  async function saveGrant(remove) {
    const target = loadedGrant;
    if (!owner || !target) return;
    const checked = scopes.filter(input => input.checked).map(input => input.value);
    const current = selection;
    el('saveAccess').disabled = el('revoke').disabled = true;
    try {
      await runTransaction(db, async txn => {
        const snap = await txn.get(target.ref);
        if (JSON.stringify(snap.data()?.edit ?? null) !== JSON.stringify(target.edit)) throw Error('Access changed. Review the latest permissions.');
        if (remove) txn.delete(target.ref);
        else {
          txn.set(doc(members, target.email), { email: target.email });
          txn.set(target.ref, { edit: checked });
        }
      });
      if (current === selection) status(remove ? 'Project access revoked.' : 'Project access saved.');
    } catch { if (current === selection) status('Could not save. Review the latest access and try again.'); }
    finally { if (current === selection) selectGrant(); }
  }
  el('grantForm').onsubmit = event => { event.preventDefault(); void saveGrant(false); };
  el('revoke').onclick = () => void saveGrant(true);
  el('project').onchange = selectGrant;
  el('employee').oninput = selectGrant;
  el('projectForm').onsubmit = async event => {
    event.preventDefault();
    if (!owner) return;
    const button = event.submitter; button.disabled = true;
    try {
      const name = el('projectName').value.trim();
      if (!name) throw Error('Enter a project name.');
      await addDoc(projects, { name, url: projectUrl(el('projectUrl').value) });
      el('projectForm').reset(); status('Project added.');
    } catch { status('Could not add the project. Check the name and HTTPS address.'); }
    finally { button.disabled = false; }
  };
  function watchAdmin(epoch) {
    listeners.push(onSnapshot(projects, snap => {
      if (epoch !== session) return;
      const docs = [...snap.docs].sort((a,b) => a.data().name.localeCompare(b.data().name));
      const old = el('project').value;
      el('project').replaceChildren(new Option('Select project', ''));
      projectNames.clear();
      el('cards').replaceChildren(...docs.map(d => {
        const p = d.data(); projectNames.set(d.id,p.name);
        el('project').add(new Option(p.name,d.id)); return card(p,'Portal administrator');
      }));
      if (projectNames.has(old)) el('project').value = old;
      selectGrant();
    }, () => { if (epoch === session) status('Could not load projects.'); }));
    listeners.push(onSnapshot(members, snap => {
      if (epoch === session) el('employees').replaceChildren(...snap.docs.map(d => new Option(d.id,d.id)));
    }, () => { if (epoch === session) status('Could not load employees.'); }));
  }
  function watchEmployee(email,epoch) {
    listeners.push(onSnapshot(collection(members,email,'projects'), {includeMetadataChanges:true}, async snap => {
      if (epoch !== session || snap.metadata.fromCache) return;
      const current = ++render;
      el('cards').replaceChildren();
      try {
        const cards = await Promise.all(snap.docs.map(async grant => {
          const project = await getDocFromServer(doc(projects, grant.id));
          if (!project.exists()) return null;
          const edit = grant.data().edit;
          return card(project.data(),edit.length ? 'Editing permissions · ' + edit.join(', ') : 'Read only');
        }));
        if (epoch === session && current === render) {
          el('cards').replaceChildren(...cards.filter(Boolean));
          status(cards.some(Boolean) ? '' : 'Your account is signed in. No projects have been assigned yet.');
        }
      } catch { if (epoch === session && current === render) status('Could not load assigned projects.'); }
    }, () => { if (epoch === session) { render++; el('cards').replaceChildren(); status('Project access is unavailable.'); } }));
  }
  el('login').onclick = async () => {
    try { el('login').disabled = true; await signInWithPopup(auth,provider); }
    catch (error) { el('loginStatus').textContent = error.code === 'auth/popup-closed-by-user' ? 'Sign-in cancelled.' : 'Google sign-in could not be completed. Please try again.'; }
    finally { el('login').disabled = false; }
  };
  el('logout').onclick = () => signOut(auth).catch(() => status('Could not sign out. Try again.'));
  onAuthStateChanged(auth, async user => {
    const epoch = ++session;
    listeners.forEach(stop => stop()); listeners = [];
    owner = false; resetGrant(); projectNames.clear();
    el('cards').replaceChildren(); el('employees').replaceChildren(); el('project').replaceChildren();
    el('employee').value = ''; el('admin').hidden = true; status('');
    document.body.classList.toggle('signed-in', !!user);
    el('landing').hidden = !!user; el('account').hidden = el('portal').hidden = !user;
    el('login').disabled = false; el('loginStatus').textContent = ''; el('email').textContent = user?.email ?? '';
    if (!user) return;
    try {
      const email = user.email?.toLowerCase();
      if (!user.emailVerified || !email || !user.providerData.some(p => p.providerId === 'google.com')) throw Error();
      await setDoc(doc(members,email),{email});
      const role = await getDocFromServer(doc(db,'gatewayAdmins',user.uid));
      if (epoch !== session) return;
      owner = role.data()?.enabled === true;
      if (owner) {
        const ref = doc(projects,'promina-south');
        await runTransaction(db, async txn => {
          if (!(await txn.get(ref)).exists()) txn.set(ref,{name:'Promina South',url:'https://promina-field-gps.kirilzhegov.chatgpt.site/'});
        });
        if (epoch !== session) return;
        el('admin').hidden = false; watchAdmin(epoch);
      } else watchEmployee(email,epoch);
    } catch { if (epoch === session) status('The project directory could not be opened. Verify your connection and portal configuration.'); }
  });
}
start().catch(error => { el('loginStatus').textContent = error.message.includes('has not been configured') ? error.message : 'Google sign-in is unavailable. Reload to try again.'; });
