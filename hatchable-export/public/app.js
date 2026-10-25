(function(){
const A=window.hatchable&&window.hatchable.auth;
const modal=document.getElementById('modal');
const form=document.getElementById('loginForm');
const emailInput=document.getElementById('emailInput');
const codeInput=document.getElementById('codeInput');
const codeWrap=document.getElementById('codeWrap');
const submit=document.getElementById('loginSubmit');
const message=document.getElementById('modalMessage');
const changeEmail=document.getElementById('changeEmail');
let step='email',selectedRole='victim',hasPasskey=false;
const $=id=>document.getElementById(id);
function toast(t){const el=$('toast');if(!el)return;el.textContent=t;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),3200)}
function showModal(role){selectedRole=role||'victim';modal.hidden=false;message.textContent='';message.className='modal-message';step='email';codeWrap.hidden=true;changeEmail.hidden=true;emailInput.hidden=false;if(emailInput.previousElementSibling)emailInput.previousElementSibling.hidden=false;submit.disabled=false;submit.innerHTML='Continue with email <span>→</span>';const helper=selectedRole==='volunteer';$('modalSymbol').textContent=helper?'♡':'✚';$('modalEyebrow').textContent=helper?'VOLUNTEER ACCESS':'EMERGENCY ASSISTANCE';$('modalTitle').textContent=helper?'Join the response network':'Let’s get you connected';$('modalDesc').textContent=helper?'Sign in securely to offer support and review appropriate help requests.':'Sign in securely to request assistance and keep track of your requests.';emailInput.focus()}
function hideModal(){modal.hidden=true}
function safeRole(role){return role==='volunteer'?'volunteer':'victim'}
function goApp(role){location.href='/app.html?role='+encodeURIComponent(safeRole(role))}
async function currentUser(){if(!A)return null;try{const s=await window.hatchable.auth.getSession();return s&&s.user||null}catch(e){return null}}
async function beginRole(role){selectedRole=safeRole(role);const user=await currentUser();if(user){goApp(selectedRole);return}showModal(selectedRole)}
document.querySelectorAll('[data-role]').forEach(b=>b.addEventListener('click',()=>beginRole(b.dataset.role)));
$('heroHelp').addEventListener('click',()=>beginRole('victim'));
$('heroVolunteer').addEventListener('click',()=>beginRole('volunteer'));
$('loginBtn').addEventListener('click',()=>showModal('victim'));
$('closeModal').addEventListener('click',hideModal);
modal.addEventListener('click',e=>{if(e.target===modal)hideModal()});
$('accountBtn').addEventListener('click',async()=>{if(A)await A.signOut();$('accountBtn').hidden=true;$('loginBtn').hidden=false;toast('You have signed out.')});
changeEmail.addEventListener('click',()=>{step='email';codeWrap.hidden=true;changeEmail.hidden=true;emailInput.hidden=false;if(emailInput.previousElementSibling)emailInput.previousElementSibling.hidden=false;submit.innerHTML='Continue with email <span>→</span>';message.textContent='';emailInput.focus()});
form.addEventListener('submit',async e=>{
 e.preventDefault();if(!A){message.textContent='Secure sign-in is unavailable. Please refresh and try again.';message.className='modal-message error';return}
 submit.disabled=true;message.className='modal-message';message.textContent='';
 try{
  const email=emailInput.value.trim();
  if(step==='email'){
   const result=await A.startLogin({email});hasPasskey=!!(result&&result.has_passkey);
   if(hasPasskey&&A.supportsPasskeys&&A.supportsPasskeys()){try{const p=await A.signInWithPasskey({email});if(p&&p.user){goApp(selectedRole);return}}catch(e){}}
   step='code';emailInput.hidden=true;if(emailInput.previousElementSibling)emailInput.previousElementSibling.hidden=true;codeWrap.hidden=false;changeEmail.hidden=false;submit.innerHTML='Verify and continue <span>→</span>';message.textContent='A sign-in code has been sent to '+email+'.';codeInput.focus();
  }else{
   const result=await A.verifyCode({email:emailInput.value.trim(),code:codeInput.value.trim()});
   if(result&&result.user){goApp(selectedRole);return}
   throw new Error('That code could not be verified. Please try again.')
  }
 }catch(err){message.textContent=err&&err.status===429?'Too many attempts. Please wait a moment and try again.':(err&&err.message||'Something went wrong. Please try again.');message.className='modal-message error'}
 finally{submit.disabled=false}
});
$('year').textContent=new Date().getFullYear();
currentUser().then(user=>{if(user){$('loginBtn').hidden=true;$('accountBtn').hidden=false;$('accountBtn').textContent=(user.email||'U').charAt(0).toUpperCase()}});
if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}))}
})();