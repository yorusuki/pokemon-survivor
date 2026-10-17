'use strict';
(async () => {
  const message=document.getElementById('oauth-status');
  const params=new URLSearchParams(location.search),state=params.get('state');
  history.replaceState(null,'','/oauth-result.html');
  if(params.has('error')) { message.textContent=params.get('error')==='cancelled'?'已取消 Google 驗證，遊戲帳號沒有變更。':'Google 驗證失敗，請回到遊戲重新操作。'; return; }
  if(!/^[a-f0-9]{64}$/.test(state||'')) {message.textContent='這個驗證連結無效或已過期，請回到遊戲重新操作。';return;}
  try {
    const r=await fetch('/api/auth/google/complete',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({state})});
    const data=await r.json();
    if(!r.ok) {
      const messages={'google-credential-in-use':'這個 Google 帳號已綁定另一個遊戲帳號。原有帳號與存檔沒有合併。','google-already-linked':'遊戲帳號已綁定另一個 Google 帳號，無法覆蓋原有綁定。','google-account-mismatch':'所選的 Google 帳號與目前遊戲帳號不同，帳號沒有刪除。','google-session-changed':'登入狀態已變更，請回到遊戲重新操作。','google-invalid-state':'驗證已過期或已使用，請回到遊戲重新操作。'};
      message.textContent=messages[data.error]||'暫時無法完成驗證，請回到遊戲重試。'; return;
    }
    if(!['/','/en/','/zh-TW/'].includes(data.returnTo)) throw new Error('invalid-return');
    if(data.deleted && /^[a-f0-9]{32}$/.test(data.uid)) {
      try {localStorage.removeItem('ps.cloud.'+data.uid);localStorage.removeItem('ps.recover.no.'+data.uid);} catch {message.textContent='帳號已刪除，但瀏覽器不允許清理本機副本。請清除本站儲存資料。';return;}
    }
    location.replace(data.returnTo);
  } catch {message.textContent='無法連上伺服器，請確認網路後回到遊戲重試。';}
})();
