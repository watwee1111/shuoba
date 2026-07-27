(function () {
  'use strict';

  const projectUrl = 'https://ofnuyswjjucnmfqzvqpw.supabase.co';
  const publishableKey = 'sb_publishable_vNDuaaPR3I5OOemZznqOxQ_ch1KhmNn';
  if (!window.supabase || publishableKey.startsWith('__')) return;

  const cloud = window.supabase.createClient(projectUrl, publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  window.shuobaCloud = cloud;
  window.shuobaCloudProfiles = [];
  window.shuobaCloudUser = null;

  const byId = id => document.getElementById(id);
  const cloudPostIds = new Set();

  function friendlyError(error) {
    const message = String(error?.message || error || '操作失败');
    if (/duplicate key|profiles_nickname_unique/i.test(message)) return '这个昵称已经有人使用，请换一个名字';
    if (/already registered/i.test(message)) return '这个邮箱已经注册，请直接登录';
    if (/invalid login credentials/i.test(message)) return '邮箱或密码不正确';
    if (/password/i.test(message) && /least|short|characters/i.test(message)) return '密码至少需要6位';
    if (/email/i.test(message) && /invalid/i.test(message)) return '请输入正确的邮箱地址';
    return message;
  }

  function showCloudToast(message) {
    if (typeof showToast === 'function') showToast(message);
  }

  function setCloudIdentity(profile) {
    if (!profile) return;
    localStorage.setItem('shuoba-nickname', profile.nickname);
    localStorage.setItem('shuoba-avatar-text', (profile.nickname || '说').slice(0, 1));
    if (typeof applyAccountAppearance === 'function') applyAccountAppearance();
  }

  async function loadProfiles() {
    const { data, error } = await cloud.from('profiles').select('id,nickname,avatar_url,bio,is_anonymous,show_following,show_followers');
    if (error) throw error;
    window.shuobaCloudProfiles = data || [];
    return window.shuobaCloudProfiles;
  }

  function mapCloudPost(row, profile) {
    const anonymous = row.is_anonymous || profile?.is_anonymous;
    const nickname = anonymous ? '匿名用户' : (profile?.nickname || '说吧用户');
    const type = row.section === 'vent' ? 'complaint' : row.section === 'gratitude' ? 'gratitude' : 'share';
    const content = String(row.content || '');
    return {
      id: row.id,
      cloud: true,
      owner: window.shuobaCloudUser?.id === row.author_id,
      authorId: row.author_id,
      type,
      category: row.category,
      sub: row.subcategory || '其他',
      leaf: row.subcategory || '其他',
      author: nickname,
      role: anonymous ? '身份已隐藏' : '说吧内测用户',
      avatar: anonymous ? '匿' : nickname.slice(0, 1),
      color: anonymous ? '#68736e' : '#176b4d',
      time: new Date(row.created_at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
      title: row.title,
      body: content.slice(0, 180),
      detail: content.split(/\n{2,}/).map(part => `<p>${escapeHtml(part).replace(/\n/g, '<br>')}</p>`).join(''),
      image: row.image_url || undefined,
      likes: 0,
      comments: 0
    };
  }

  async function loadCloudPosts() {
    await loadProfiles();
    const { data, error } = await cloud.from('posts').select('*').order('created_at', { ascending: false }).limit(200);
    if (error) throw error;
    for (let i = posts.length - 1; i >= 0; i--) {
      if (posts[i].cloud) posts.splice(i, 1);
    }
    cloudPostIds.clear();
    (data || []).reverse().forEach(row => {
      const profile = window.shuobaCloudProfiles.find(item => item.id === row.author_id);
      const mapped = mapCloudPost(row, profile);
      posts.unshift(mapped);
      cloudPostIds.add(String(mapped.id));
    });
    if (typeof renderFeed === 'function') renderFeed();
    if (byId('profilePage') && !byId('profilePage').classList.contains('hidden') && typeof renderProfile === 'function') renderProfile('posts');
  }

  async function refreshSession() {
    const { data } = await cloud.auth.getSession();
    window.shuobaCloudUser = data.session?.user || null;
    if (window.shuobaCloudUser) {
      isAuthenticated = true;
      localStorage.setItem('shuoba-authenticated', 'true');
      localStorage.setItem('shuoba-session', data.session.access_token);
      const { data: profile } = await cloud.from('profiles').select('*').eq('id', window.shuobaCloudUser.id).single();
      setCloudIdentity(profile);
    }
    if (typeof setAuthUI === 'function') setAuthUI();
    await loadCloudPosts();
    await renderFriendRequests();
  }

  function prepareAuthForm() {
    const account = byId('phoneInput');
    const password = byId('codeInput');
    const sendCode = byId('sendCode');
    if (!account || !password) return;
    const accountLabel = document.querySelector('label[for="phoneInput"]');
    const passwordLabel = document.querySelector('label[for="codeInput"]');
    if (accountLabel) accountLabel.textContent = '邮箱';
    if (passwordLabel) passwordLabel.textContent = '密码';
    account.type = 'email';
    account.inputMode = 'email';
    account.maxLength = 80;
    account.placeholder = '请输入常用邮箱';
    password.type = 'password';
    password.inputMode = 'text';
    password.maxLength = 72;
    password.placeholder = '至少6位密码';
    if (sendCode) sendCode.classList.add('hidden');
    const note = document.querySelector('.rule-note');
    if (note) note.textContent = '内测阶段使用邮箱和密码注册。注册信息会加密保存，请勿与他人共用密码。';
  }

  document.addEventListener('submit', async event => {
    if (event.target?.id === 'authForm') {
      event.preventDefault();
      event.stopImmediatePropagation();
      const email = byId('phoneInput').value.trim();
      const password = byId('codeInput').value;
      const nickname = byId('nicknameInput').value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showCloudToast('请输入正确的邮箱地址');
      if (password.length < 6) return showCloudToast('密码至少需要6位');
      try {
        if (authMode === 'register') {
          if (nickname.length < 2 || nickname.length > 12) return showCloudToast('昵称需要2至12个字');
          const { data: existing } = await cloud.from('profiles').select('id').ilike('nickname', nickname).limit(1);
          if (existing?.length) return showCloudToast('这个昵称已经有人使用，请换一个名字');
          const { data, error } = await cloud.auth.signUp({ email, password, options: { data: { nickname } } });
          if (error) throw error;
          if (!data.session) {
            showCloudToast('注册信息已提交，请到邮箱点击确认链接后再登录');
            return;
          }
        } else {
          const { error } = await cloud.auth.signInWithPassword({ email, password });
          if (error) throw error;
        }
        await refreshSession();
        if (typeof closeAuth === 'function') closeAuth();
        showCloudToast(authMode === 'register' ? '注册成功，欢迎来到说吧' : '登录成功');
      } catch (error) {
        showCloudToast(friendlyError(error));
      }
      return;
    }

    if (event.target?.id === 'publishForm') {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!window.shuobaCloudUser) return showCloudToast('请先登录再发布');
      const title = byId('postTitle').value.trim();
      const content = byId('postContent').value.trim();
      const errorText = typeof moderate === 'function' ? moderate(title, content, publishType) : '';
      if (errorText) {
        byId('moderationBox').textContent = errorText;
        byId('moderationBox').classList.add('show');
        return;
      }
      const section = publishType === 'complaint' ? 'vent' : publishType;
      const payload = {
        author_id: window.shuobaCloudUser.id,
        section,
        category: byId('majorCategory').value,
        subcategory: byId('leafCategory').value || byId('subCategory').value || '其他',
        title,
        content,
        is_anonymous: byId('anonymousToggle').checked || profilePrivate
      };
      try {
        const { error } = await cloud.from('posts').insert(payload);
        if (error) throw error;
        event.target.reset();
        if (typeof closePublish === 'function') closePublish();
        await loadCloudPosts();
        if (typeof switchSection === 'function') switchSection(publishType);
        showCloudToast('发布成功，其他内测人员刷新后就能看到');
      } catch (error) {
        showCloudToast(friendlyError(error));
      }
    }
  }, true);

  document.addEventListener('click', async event => {
    const deleteButton = event.target.closest('[data-my-post-delete]');
    if (deleteButton && cloudPostIds.has(String(deleteButton.dataset.myPostDelete))) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const post = posts.find(item => String(item.id) === String(deleteButton.dataset.myPostDelete));
      if (!post?.owner) return showCloudToast('只能删除自己发布的文章');
      if (!window.confirm(`确定删除《${post.title}》吗？删除后无法恢复。`)) return;
      const { error } = await cloud.from('posts').delete().eq('id', post.id);
      if (error) return showCloudToast(friendlyError(error));
      await loadCloudPosts();
      showCloudToast('文章已删除');
      return;
    }

    const followButton = event.target.closest('[data-person-follow],#profileFollowUser');
    if (followButton && window.shuobaCloudUser) {
      const nickname = followButton.dataset.personFollow || byId('publicProfileTitle')?.textContent;
      const target = window.shuobaCloudProfiles.find(item => item.nickname === nickname);
      if (!target || target.id === window.shuobaCloudUser.id) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const { data: current } = await cloud.from('follows').select('follower_id').eq('follower_id', window.shuobaCloudUser.id).eq('following_id', target.id).maybeSingle();
      const query = current
        ? cloud.from('follows').delete().eq('follower_id', window.shuobaCloudUser.id).eq('following_id', target.id)
        : cloud.from('follows').insert({ follower_id: window.shuobaCloudUser.id, following_id: target.id });
      const { error } = await query;
      if (error) return showCloudToast(friendlyError(error));
      showCloudToast(current ? `已取消关注${nickname}` : `已关注${nickname}`);
      return;
    }

    const friendButton = event.target.closest('#profileFriendRequest');
    if (friendButton && window.shuobaCloudUser) {
      const nickname = byId('publicProfileTitle')?.textContent;
      const target = window.shuobaCloudProfiles.find(item => item.nickname === nickname);
      if (!target || target.id === window.shuobaCloudUser.id) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const { error } = await cloud.from('friend_requests').insert({ sender_id: window.shuobaCloudUser.id, receiver_id: target.id });
      if (error) return showCloudToast(friendlyError(error));
      friendButton.disabled = true;
      friendButton.textContent = '等待对方同意';
      showCloudToast('好友申请已发送');
      await renderFriendRequests();
      return;
    }

    const acceptButton = event.target.closest('[data-accept-cloud-friend]');
    if (acceptButton) {
      event.preventDefault();
      const { error } = await cloud.rpc('accept_friend_request', { request_id: acceptButton.dataset.acceptCloudFriend });
      if (error) return showCloudToast(friendlyError(error));
      showCloudToast('已同意好友申请');
      await renderFriendRequests();
    }
  }, true);

  async function renderFriendRequests() {
    let panel = byId('cloudFriendRequests');
    const profileHead = byId('myProfileHead');
    if (!profileHead) return;
    if (!panel) {
      panel = document.createElement('section');
      panel.id = 'cloudFriendRequests';
      panel.className = 'cloud-friend-panel';
      profileHead.insertAdjacentElement('afterend', panel);
    }
    if (!window.shuobaCloudUser) {
      panel.innerHTML = '';
      return;
    }
    const { data } = await cloud.from('friend_requests').select('id,sender_id,status,created_at').eq('receiver_id', window.shuobaCloudUser.id).eq('status', 'pending').order('created_at', { ascending: false });
    const requests = data || [];
    panel.innerHTML = `<div class="cloud-friend-head"><strong>好友申请</strong><span>${requests.length ? `${requests.length} 条待处理` : '暂时没有新申请'}</span></div>${requests.map(item => {
      const sender = window.shuobaCloudProfiles.find(profile => profile.id === item.sender_id);
      return `<div class="cloud-friend-row"><span>${escapeHtml(sender?.nickname || '说吧用户')} 想加你为好友</span><button class="btn small primary" data-accept-cloud-friend="${item.id}">同意</button></div>`;
    }).join('')}`;
  }

  const style = document.createElement('style');
  style.textContent = '.cloud-friend-panel{margin:14px 0;padding:14px 16px;border:1px solid var(--line);border-radius:7px;background:var(--surface)}.cloud-friend-head,.cloud-friend-row{display:flex;align-items:center;justify-content:space-between;gap:12px}.cloud-friend-head span{color:var(--muted);font-size:12px}.cloud-friend-row{margin-top:12px;padding-top:12px;border-top:1px solid var(--line);font-size:13px}';
  document.head.appendChild(style);

  prepareAuthForm();
  cloud.auth.onAuthStateChange(() => setTimeout(refreshSession, 0));
  refreshSession().catch(error => showCloudToast(`共享数据连接失败：${friendlyError(error)}`));
})();
