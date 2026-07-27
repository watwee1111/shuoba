(function () {
  'use strict';

  const projectUrl = 'https://ofnuyswjjucnmfqzvqpw.supabase.co';
  const publishableKey = 'sb_publishable_vNDuaaPR3I5OOemZznqOxQ_ch1KhmNn';
  if (publishableKey.startsWith('__')) return;

  function createCloudClient(baseUrl, apiKey) {
    const sessionKey = 'shuoba-cloud-session';
    const listeners = [];
    let session = (() => { try { return JSON.parse(localStorage.getItem(sessionKey) || 'null'); } catch { return null; } })();

    async function request(path, options = {}) {
      const headers = {
        apikey: apiKey,
        Authorization: `Bearer ${session?.access_token || apiKey}`,
        ...options.headers
      };
      if (options.body !== undefined) headers['Content-Type'] = 'application/json';
      const response = await fetch(`${baseUrl}${path}`, {
        method: options.method || 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body)
      });
      const text = await response.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }
      if (!response.ok) {
        const error = new Error(data?.message || data?.msg || data?.error_description || data?.error || `请求失败（${response.status}）`);
        error.status = response.status;
        throw error;
      }
      return data;
    }

    function saveSession(next) {
      session = next?.access_token ? next : null;
      if (session) localStorage.setItem(sessionKey, JSON.stringify(session));
      else localStorage.removeItem(sessionKey);
      listeners.forEach(listener => listener(session ? 'SIGNED_IN' : 'SIGNED_OUT', session));
    }

    class Query {
      constructor(table) {
        this.table = table;
        this.method = 'GET';
        this.params = new URLSearchParams();
        this.body = undefined;
        this.headers = {};
        this.singleMode = '';
      }
      select(columns = '*') { this.params.set('select', columns); return this; }
      insert(value) { this.method = 'POST'; this.body = value; this.headers.Prefer = 'return=representation'; return this; }
      update(value) { this.method = 'PATCH'; this.body = value; this.headers.Prefer = 'return=representation'; return this; }
      delete() { this.method = 'DELETE'; this.headers.Prefer = 'return=representation'; return this; }
      eq(column, value) { this.params.append(column, `eq.${value}`); return this; }
      ilike(column, value) { this.params.append(column, `ilike.${value}`); return this; }
      order(column, options = {}) { this.params.set('order', `${column}.${options.ascending === false ? 'desc' : 'asc'}`); return this; }
      limit(value) { this.params.set('limit', String(value)); return this; }
      single() { this.singleMode = 'single'; this.headers.Accept = 'application/vnd.pgrst.object+json'; return this; }
      maybeSingle() { this.singleMode = 'maybe'; this.headers.Accept = 'application/vnd.pgrst.object+json'; return this; }
      async execute() {
        try {
          const query = this.params.toString();
          const data = await request(`/rest/v1/${this.table}${query ? `?${query}` : ''}`, { method: this.method, headers: this.headers, body: this.body });
          return { data, error: null };
        } catch (error) {
          if (this.singleMode === 'maybe' && error.status === 406) return { data: null, error: null };
          return { data: null, error };
        }
      }
      then(resolve, reject) { return this.execute().then(resolve, reject); }
    }

    return {
      from: table => new Query(table),
      rpc: async (name, args) => {
        try { return { data: await request(`/rest/v1/rpc/${name}`, { method: 'POST', body: args }), error: null }; }
        catch (error) { return { data: null, error }; }
      },
      auth: {
        getSession: async () => ({ data: { session } }),
        signUp: async ({ email, password, options }) => {
          try {
            const data = await request('/auth/v1/signup', { method: 'POST', body: { email, password, data: options?.data || {} } });
            const next = data?.access_token ? data : data?.session;
            if (next) saveSession(next);
            return { data: { user: data?.user || null, session: next || null }, error: null };
          } catch (error) { return { data: null, error }; }
        },
        signInWithPassword: async ({ email, password }) => {
          try {
            const data = await request('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
            saveSession(data);
            return { data: { user: data.user, session: data }, error: null };
          } catch (error) { return { data: null, error }; }
        },
        signOut: async () => {
          try {
            if (session?.access_token) {
              await request('/auth/v1/logout', { method: 'POST' });
            }
          } catch (error) {
            // 即使网络中断，也必须清除本机登录状态。
          }
          saveSession(null);
          return { error: null };
        },
        onAuthStateChange: callback => { listeners.push(callback); return { data: { subscription: { unsubscribe() {} } } }; }
      }
    };
  }

  const cloud = createCloudClient(projectUrl, publishableKey);
  window.shuobaCloud = cloud;
  window.shuobaCloudProfiles = [];
  window.shuobaCloudUser = null;

  const byId = id => document.getElementById(id);
  const cloudPostIds = new Set();
  const localAccountsKey = 'shuoba-local-accounts-v2';
  const localCurrentKey = 'shuoba-local-current-v2';
  window.shuobaLocalUser = null;

  function readLocalAccounts() {
    try { return JSON.parse(localStorage.getItem(localAccountsKey) || '[]'); } catch { return []; }
  }

  async function passwordDigest(password, salt) {
    const bytes = new TextEncoder().encode(`${salt}:${password}`);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map(value => value.toString(16).padStart(2, '0')).join('');
  }

  function setLocalIdentity(account) {
    window.shuobaLocalUser = account;
    isAuthenticated = true;
    localStorage.setItem(localCurrentKey, account.username);
    localStorage.setItem('shuoba-authenticated', 'true');
    localStorage.setItem('shuoba-session', `local-${account.username}`);
    localStorage.setItem('shuoba-nickname', account.nickname);
    localStorage.setItem('shuoba-avatar-text', account.nickname.slice(0, 1));
    const profileName = document.querySelector('#myProfileHead .profile-copy h2');
    if (profileName) profileName.textContent = account.nickname;
    if (typeof applyAccountAppearance === 'function') applyAccountAppearance();
    if (typeof setAuthUI === 'function') setAuthUI();
  }

  function restoreLocalSession() {
    const username = localStorage.getItem(localCurrentKey);
    const account = readLocalAccounts().find(item => item.username === username);
    if (!account) return false;
    setLocalIdentity(account);
    return true;
  }

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
    const profileName = document.querySelector('#myProfileHead .profile-copy h2');
    if (profileName) profileName.textContent = profile.nickname;
    if (typeof applyAccountAppearance === 'function') applyAccountAppearance();
  }

  function clearLegacyDemoLogin() {
    window.shuobaCloudUser = null;
    window.shuobaLocalUser = null;
    isAuthenticated = false;
    localStorage.removeItem('shuoba-session');
    localStorage.removeItem('shuoba-authenticated');
    localStorage.removeItem('shuoba-nickname');
    localStorage.removeItem('shuoba-avatar-text');
    const profileName = document.querySelector('#myProfileHead .profile-copy h2');
    if (profileName) profileName.textContent = '尚未登录';
    if (byId('authEntry')) byId('authEntry').textContent = '登录 / 注册';
    if (typeof setAuthUI === 'function') setAuthUI();
  }

  function ensureNicknameEditor() {
    if (byId('changeNickname')) return;
    const avatarButton = byId('changeAvatar');
    if (!avatarButton) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn small';
    button.id = 'changeNickname';
    button.textContent = '修改昵称';
    avatarButton.insertAdjacentElement('beforebegin', button);
    const logoutButton = document.createElement('button');
    logoutButton.type = 'button';
    logoutButton.className = 'btn small';
    logoutButton.id = 'logoutAccount';
    logoutButton.textContent = '退出登录';
    avatarButton.insertAdjacentElement('afterend', logoutButton);
  }

  async function loadProfiles() {
    const { data, error } = await cloud.from('profiles').select('id,nickname,avatar_url,bio,is_anonymous,show_following,show_followers');
    if (error) throw error;
    window.shuobaCloudProfiles = data || [];
    const { data: follows, error: followsError } = await cloud.from('follows').select('follower_id,following_id');
    if (followsError) throw followsError;
    window.shuobaCloudFollowStats = {};
    (follows || []).forEach(item => {
      const follower = window.shuobaCloudFollowStats[item.follower_id] ||= { following: 0, followers: 0 };
      const following = window.shuobaCloudFollowStats[item.following_id] ||= { following: 0, followers: 0 };
      follower.following += 1;
      following.followers += 1;
    });
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
    } else {
      clearLegacyDemoLogin();
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
    if (accountLabel) accountLabel.textContent = '账号名';
    if (passwordLabel) passwordLabel.textContent = '密码';
    account.type = 'text';
    account.inputMode = 'text';
    account.maxLength = 20;
    account.placeholder = '设置4至20位账号名';
    password.type = 'password';
    password.inputMode = 'text';
    password.maxLength = 72;
    password.placeholder = '至少6位密码';
    if (sendCode) sendCode.classList.add('hidden');
    let confirmField = byId('confirmPasswordField');
    if (!confirmField) {
      confirmField = document.createElement('div');
      confirmField.className = 'field hidden';
      confirmField.id = 'confirmPasswordField';
      confirmField.style.marginTop = '12px';
      confirmField.innerHTML = '<label for="confirmPasswordInput">确认密码</label><input id="confirmPasswordInput" type="password" maxlength="72" placeholder="请再次输入密码">';
      password.closest('.field').insertAdjacentElement('afterend', confirmField);
    }
    const note = document.querySelector('.rule-note');
    if (note) note.textContent = '账号和文章会同步到所有内测设备。请记住账号名和密码；昵称不可与其他用户重复。';
    document.querySelector('.auth-divider')?.classList.add('hidden');
    document.querySelector('.social-auth')?.classList.add('hidden');
    document.querySelectorAll('[data-auth-tab]').forEach(button => button.addEventListener('click', () => {
      setTimeout(() => confirmField.classList.toggle('hidden', authMode !== 'register'), 0);
    }));
  }

  document.addEventListener('submit', async event => {
    if (event.target?.id === 'authForm') {
      event.preventDefault();
      event.stopImmediatePropagation();
      const username = byId('phoneInput').value.trim();
      const password = byId('codeInput').value;
      const confirmPassword = byId('confirmPasswordInput')?.value || '';
      const nickname = byId('nicknameInput').value.trim();
      if (!/^[A-Za-z0-9_-]{4,20}$/.test(username)) return showCloudToast('账号名需要4至20位，只能使用字母、数字、下划线或短横线');
      if (password.length < 6) return showCloudToast('密码至少需要6位');
      try {
        const email = `${username.toLowerCase()}@accounts.shuoba.app`;
        if (authMode === 'register') {
          if (nickname.length < 2 || nickname.length > 12) return showCloudToast('昵称需要2至12个字');
          if (password !== confirmPassword) return showCloudToast('两次输入的密码不一致');
          const { data: existing, error: nicknameError } = await cloud.from('profiles').select('id').ilike('nickname', nickname).limit(1);
          if (nicknameError) throw nicknameError;
          if (existing?.length) return showCloudToast('这个昵称已经有人使用，请换一个名字');
          const { data, error } = await cloud.auth.signUp({
            email,
            password,
            options: { data: { nickname, username } }
          });
          if (error) throw error;
          if (!data?.session) throw new Error('账号已建立，但自动登录未开启，请联系内测管理员检查邮箱确认设置');
        } else {
          const { data, error } = await cloud.auth.signInWithPassword({ email, password });
          if (error) throw error;
          if (!data?.session) throw new Error('登录没有完成，请稍后重试');
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
      if (window.shuobaLocalUser && !window.shuobaCloudUser) return;
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
    const logoutButton = event.target.closest('#logoutAccount');
    if (logoutButton) {
      event.preventDefault();
      await cloud.auth.signOut();
      localStorage.removeItem(localCurrentKey);
      localStorage.removeItem('shuoba-session');
      localStorage.removeItem('shuoba-authenticated');
      localStorage.removeItem('shuoba-nickname');
      localStorage.removeItem('shuoba-avatar-text');
      window.shuobaCloudUser = null;
      isAuthenticated = false;
      if (byId('authEntry')) byId('authEntry').textContent = '登录 / 注册';
      if (typeof setAuthUI === 'function') setAuthUI();
      if (typeof switchSection === 'function') switchSection('all');
      showCloudToast('已退出登录，可以注册或登录其他内测账号');
      return;
    }

    const nicknameButton = event.target.closest('#changeNickname');
    if (nicknameButton) {
      event.preventDefault();
      if (window.shuobaLocalUser && !window.shuobaCloudUser) {
        const oldNickname = window.shuobaLocalUser.nickname;
        const nextNickname = window.prompt('输入新的昵称（2至12个字）', oldNickname)?.trim();
        if (!nextNickname || nextNickname === oldNickname) return;
        if (nextNickname.length < 2 || nextNickname.length > 12) return showCloudToast('昵称需要2至12个字');
        if (!/^[\u4e00-\u9fa5A-Za-z0-9_-]+$/.test(nextNickname)) return showCloudToast('昵称只使用中文、字母、数字、下划线或短横线');
        if (/(官方|管理员|客服|站长|微信|QQ|vx|电话|1\d{10}|傻|蠢|垃圾|去死|色情|赌博|仇恨)/i.test(nextNickname)) return showCloudToast('昵称包含冒充、联系方式、攻击或违规表达，请重新命名');
        const accounts = readLocalAccounts();
        if (accounts.some(item => item.username !== window.shuobaLocalUser.username && item.nickname.toLowerCase() === nextNickname.toLowerCase())) return showCloudToast('这个昵称已经有人使用，请换一个名字');
        const account = accounts.find(item => item.username === window.shuobaLocalUser.username);
        account.nickname = nextNickname;
        localStorage.setItem(localAccountsKey, JSON.stringify(accounts));
        storedUserPosts.forEach(post => { if (!post.is_anonymous && post.author === oldNickname) post.author = nextNickname; });
        posts.forEach(post => { if (post.owner && post.author === oldNickname) post.author = nextNickname; });
        localStorage.setItem('shuoba-user-posts', JSON.stringify(storedUserPosts));
        setLocalIdentity(account);
        if (typeof renderFeed === 'function') renderFeed();
        showCloudToast('昵称修改成功');
        return;
      }
      if (!window.shuobaCloudUser) return showCloudToast('请先登录再修改昵称');
      const currentProfile = window.shuobaCloudProfiles.find(item => item.id === window.shuobaCloudUser.id);
      const nextNickname = window.prompt('输入新的昵称（2至12个字）', currentProfile?.nickname || '')?.trim();
      if (!nextNickname || nextNickname === currentProfile?.nickname) return;
      if (nextNickname.length < 2 || nextNickname.length > 12) return showCloudToast('昵称需要2至12个字');
      if (!/^[\u4e00-\u9fa5A-Za-z0-9_-]+$/.test(nextNickname)) return showCloudToast('昵称只使用中文、字母、数字、下划线或短横线');
      if (/(官方|管理员|客服|站长|微信|QQ|vx|电话|1\d{10}|傻|蠢|垃圾|去死|色情|赌博|仇恨)/i.test(nextNickname)) return showCloudToast('昵称包含冒充、联系方式、攻击或违规表达，请重新命名');
      const { data: existing, error: searchError } = await cloud.from('profiles').select('id').ilike('nickname', nextNickname).limit(1);
      if (searchError) return showCloudToast(friendlyError(searchError));
      if (existing?.some(item => item.id !== window.shuobaCloudUser.id)) return showCloudToast('这个昵称已经有人使用，请换一个名字');
      const { error } = await cloud.from('profiles').update({ nickname: nextNickname, updated_at: new Date().toISOString() }).eq('id', window.shuobaCloudUser.id);
      if (error) return showCloudToast(friendlyError(error));
      localStorage.setItem('shuoba-nickname', nextNickname);
      localStorage.setItem('shuoba-avatar-text', nextNickname.slice(0, 1));
      await loadCloudPosts();
      setCloudIdentity(window.shuobaCloudProfiles.find(item => item.id === window.shuobaCloudUser.id));
      showCloudToast('昵称修改成功，已同步到你的文章和主页');
      return;
    }

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
    if (followButton) {
      if (window.shuobaLocalUser && !window.shuobaCloudUser) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!window.shuobaCloudUser) {
        if (typeof openAuth === 'function') openAuth();
        return showCloudToast('登录后才能关注其他用户');
      }
      const profileTitle = byId('publicProfileTitle')?.textContent || '';
      const nickname = followButton.dataset.personFollow || profileTitle.replace(/的主页$/, '');
      const target = window.shuobaCloudProfiles.find(item => item.nickname === nickname);
      if (!target || target.id === window.shuobaCloudUser.id) return;
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
    if (friendButton) {
      if (window.shuobaLocalUser && !window.shuobaCloudUser) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!window.shuobaCloudUser) {
        if (typeof openAuth === 'function') openAuth();
        return showCloudToast('登录后才能发送好友申请');
      }
      const nickname = (byId('publicProfileTitle')?.textContent || '').replace(/的主页$/, '');
      const target = window.shuobaCloudProfiles.find(item => item.nickname === nickname);
      if (!target || target.id === window.shuobaCloudUser.id) return;
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
  ensureNicknameEditor();
  clearLegacyDemoLogin();
  cloud.auth.onAuthStateChange(() => setTimeout(refreshSession, 0));
  refreshSession().catch(error => showCloudToast(`共享数据连接失败：${friendlyError(error)}`));
})();
